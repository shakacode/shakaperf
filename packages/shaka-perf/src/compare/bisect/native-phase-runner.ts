/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { NativeGitBisectDriver } from './git';
import type { PhaseTransitionEvent } from './phase-transition';
import { PhaseStore } from './phase-store';
import {
  BisectInterruptedError,
  CandidateEvaluationError,
  CandidateEvaluator,
  type CandidateEvaluationPlan,
  type CandidateResult,
} from './run-candidate';
import { BisectRunEnvironment } from './run-environment';
import {
  candidatePlanForGroup,
  createInitialTargetGroup,
  partitionTargetGroup,
} from './search';
import { TargetGroupQueue } from './target-group-queue';
import type {
  BisectSearchPhase,
  BisectTargetGroup,
  CommitAttempt,
  CommitRun,
} from './types';

/** Owns one complete native-bisect phase lifecycle. */
export class NativeBisectPhaseRunner {
  private attemptNumber = 0;
  private groupNumber = 0;

  constructor(
    private readonly phaseStore: PhaseStore,
    private readonly git: NativeGitBisectDriver,
    private readonly candidates: CandidateEvaluator,
    private readonly environment: BisectRunEnvironment,
  ) {}

  async run(): Promise<BisectSearchPhase> {
    let phase = initializeGroups(this.phaseStore.current());
    this.initializeIds(phase);
    phase = {
      ...phase,
      status: 'running',
      startedAt: phase.startedAt ?? this.environment.now(),
    };
    await this.commit('phase-started', phase);

    while (true) {
      const group = new TargetGroupQueue(phase.groups).next();
      if (!group) {
        phase = {
          ...phase,
          status: 'complete',
          activeGroupId: undefined,
          finishedAt: this.environment.now(),
        };
        await this.commit('phase-completed', phase);
        return phase;
      }

      phase = updateGroup(phase, { ...group, status: 'running' });
      phase = { ...phase, activeGroupId: group.id };
      await this.commit('group-started', phase, {
        groupId: group.id,
        goodSha: group.goodSha,
        badSha: group.badSha,
      });

      let primaryError: unknown;
      try {
        let step = await this.git.start(currentGroup(phase, group.id));
        while (!step.complete) {
          const candidateSha = step.candidateSha;
          if (!candidateSha) {
            throw new Error(`Native Git bisect did not provide a candidate for ${group.id}`);
          }
          const classification = await this.classifyCandidate(phase, group.id, candidateSha);
          phase = classification.phase;
          step = await this.git.mark(classification.verdict);
        }

        if (!step.firstBadSha) {
          throw new Error(`Native Git bisect completed ${group.id} without a first bad commit`);
        }
        phase = completeGroup(phase, group.id, step.firstBadSha);
        await this.commit('group-completed', phase, {
          groupId: group.id,
          firstBadSha: step.firstBadSha,
        });
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try {
          await this.git.reset();
        } catch (resetError) {
          if (primaryError === undefined) throw resetError;
          throw new AggregateError(
            [primaryError, resetError],
            `Native bisect phase ${phase.id} failed and Git bisect reset also failed`,
          );
        }
      }
    }
  }

  private async classifyCandidate(
    phase: BisectSearchPhase,
    groupId: string,
    candidateSha: string,
  ): Promise<{ phase: BisectSearchPhase; verdict: 'good' | 'bad' }> {
    const group = currentGroup(phase, groupId);
    const work = candidatePlanForGroup(group, phase.targets, candidateSha);
    if (work.targetIds.length === 0) {
      const partition = this.partitionTargetGroup({
        phaseId: phase.id,
        group,
        targets: phase.targets,
        sha: candidateSha,
        evaluations: [],
      });
      const classified = applyPartition(phase, groupId, partition);
      await this.commit(transitionForPartition(partition.queuedGroups.length), classified, {
        sha: candidateSha,
        verdict: partition.verdict,
        cached: true,
      });
      return { phase: classified, verdict: partition.verdict };
    }

    const attempt = this.runningAttempt(phase, work);
    let runningPhase = { ...phase, attempts: [...phase.attempts, attempt] };
    await this.commit('attempt-started', runningPhase, {
      attemptId: attempt.id,
      sha: candidateSha,
      categories: work.categories,
      tests: work.tests,
      targetIds: work.targetIds,
      group: {
        id: group.id,
        goodSha: group.goodSha,
        badSha: group.badSha,
      },
    });

    let result: CandidateResult;
    let partition: ReturnType<typeof partitionTargetGroup>;
    try {
      const targets = runningPhase.targets.filter((target) => work.targetIds.includes(target.id));
      const plan: CandidateEvaluationPlan = { ...work, targets };
      result = await this.candidates.evaluate(plan);
      if (result.commitRun.infrastructureError) {
        throw new Error(
          `Cannot classify ${candidateSha}: ${result.commitRun.infrastructureError}`,
        );
      }
      partition = this.partitionTargetGroup({
        phaseId: phase.id,
        group: currentGroup(runningPhase, groupId),
        targets: runningPhase.targets,
        sha: candidateSha,
        evaluations: result.targetEvaluations,
      });
    } catch (error) {
      const evaluationError = error instanceof CandidateEvaluationError ? error : undefined;
      const incomplete = this.incompleteAttempt(attempt, error);
      runningPhase = {
        ...runningPhase,
        attempts: replaceAttempt(runningPhase.attempts, incomplete),
      };
      await this.commit(
        'attempt-incomplete',
        runningPhase,
        { attemptId: attempt.id, sha: candidateSha, error: errorMessage(error) },
        evaluationError?.commitRun,
      );
      if (evaluationError?.originalError instanceof BisectInterruptedError) {
        throw evaluationError.originalError;
      }
      throw evaluationError ?? error;
    }

    const completed = this.completedAttempt(attempt, result);
    const classified = applyPartition({
      ...runningPhase,
      attempts: replaceAttempt(runningPhase.attempts, completed),
    }, groupId, partition);
    await this.commit(
      transitionForPartition(partition.queuedGroups.length),
      classified,
      {
        attemptId: attempt.id,
        sha: candidateSha,
        verdict: partition.verdict,
        queuedGroupIds: partition.queuedGroups.map(({ id }) => id),
      },
      result.commitRun,
    );
    return { phase: classified, verdict: partition.verdict };
  }

  private runningAttempt(
    phase: BisectSearchPhase,
    plan: Pick<CandidateEvaluationPlan, 'sha' | 'categories' | 'tests'>,
  ): CommitAttempt {
    return {
      id: `${phase.id}-attempt-${++this.attemptNumber}`,
      sha: plan.sha,
      status: 'running',
      requestedCategories: [...plan.categories],
      requestedTests: [...plan.tests],
      experimentReloadMode: this.candidates.preferredReloadMode(),
      usedFallback: false,
      startedAt: this.environment.now(),
    };
  }

  private completedAttempt(attempt: CommitAttempt, result: CandidateResult): CommitAttempt {
    return {
      ...attempt,
      status: 'complete',
      experimentReloadMode: result.experimentReload.mode,
      usedFallback: result.experimentReload.usedFallback,
      finishedAt: result.commitRun.finishedAt ?? this.environment.now(),
      ...(result.commitRun.compareResultsPath
        ? { compareResultsPath: result.commitRun.compareResultsPath }
        : {}),
    };
  }

  private incompleteAttempt(attempt: CommitAttempt, error: unknown): CommitAttempt {
    return {
      ...attempt,
      status: 'incomplete',
      finishedAt: this.environment.now(),
      error: errorMessage(error),
    };
  }

  private partitionTargetGroup(
    options: Omit<Parameters<typeof partitionTargetGroup>[0], 'queuedGroupId'> & {
      phaseId: string;
    },
  ): ReturnType<typeof partitionTargetGroup> {
    const { phaseId, ...partitionOptions } = options;
    const partition = partitionTargetGroup({
      ...partitionOptions,
      queuedGroupId: `${phaseId}-group-${this.groupNumber + 1}`,
    });
    if (partition.queuedGroups.length > 0) this.groupNumber += 1;
    return partition;
  }

  private initializeIds(phase: BisectSearchPhase): void {
    this.attemptNumber = phase.attempts.length;
    this.groupNumber = Math.max(0, ...phase.groups.map((group) => {
      const suffix = Number(group.id.match(/-(\d+)$/)?.[1]);
      return Number.isSafeInteger(suffix) ? suffix : 0;
    }));
  }

  private commit(
    event: PhaseTransitionEvent,
    phase: BisectSearchPhase,
    details?: Record<string, unknown>,
    commitRun?: CommitRun,
  ): Promise<void> {
    return this.phaseStore.commit({ event, phase, details, commitRun });
  }
}

function initializeGroups(phase: BisectSearchPhase): BisectSearchPhase {
  if (phase.groups.length > 0) return phase;
  const activeTargets = phase.targets.filter((target) => target.status === 'active');
  return {
    ...phase,
    groups: activeTargets.length === 0 ? [] : [createInitialTargetGroup(
      `${phase.id}-group-1`,
      phase.goodSha,
      phase.badSha,
      activeTargets,
    )],
  };
}

function currentGroup(phase: BisectSearchPhase, groupId: string): BisectTargetGroup {
  const group = phase.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown native bisect target group: ${groupId}`);
  return group;
}

function updateGroup(phase: BisectSearchPhase, group: BisectTargetGroup): BisectSearchPhase {
  return {
    ...phase,
    groups: phase.groups.map((candidate) => candidate.id === group.id ? group : candidate),
  };
}

function applyPartition(
  phase: BisectSearchPhase,
  groupId: string,
  partition: ReturnType<typeof partitionTargetGroup>,
): BisectSearchPhase {
  const groups = phase.groups.map((group) => (
    group.id === groupId ? partition.continuingGroup : group
  ));
  const queue = new TargetGroupQueue(groups);
  queue.addAll(partition.queuedGroups);
  return { ...phase, targets: partition.targets, groups: queue.values() };
}

function completeGroup(
  phase: BisectSearchPhase,
  groupId: string,
  firstBadSha: string,
): BisectSearchPhase {
  const group = currentGroup(phase, groupId);
  const targetIds = new Set(group.targetIds);
  return {
    ...phase,
    activeGroupId: undefined,
    groups: phase.groups.map((candidate) => candidate.id === groupId
      ? { ...candidate, status: 'complete' as const, firstBadSha }
      : candidate),
    targets: phase.targets.map((target) => targetIds.has(target.id)
      ? { ...target, status: 'found' as const, firstBadSha }
      : target),
  };
}

function transitionForPartition(queuedCount: number): PhaseTransitionEvent {
  return queuedCount > 0 ? 'group-split' : 'candidate-classified';
}

function replaceAttempt(
  attempts: readonly CommitAttempt[],
  replacement: CommitAttempt,
): CommitAttempt[] {
  return attempts.map((attempt) => attempt.id === replacement.id ? replacement : attempt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
