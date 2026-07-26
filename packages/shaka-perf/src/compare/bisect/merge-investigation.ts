/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { NativeGitBisectDriver, prepareChildGitRange, type PreparedChildGitRange } from './git';
import { NativeBisectPhaseRunner } from './native-phase-runner';
import { MergePhaseStore } from './phase-store';
import { CompareBisectSession } from './session-owner';
import { BisectRunEnvironment } from './run-environment';
import {
  BisectInterruptedError,
  CandidateEvaluator,
  findCandidateEvaluationError,
  type CandidateEvaluationPlan,
} from './run-candidate';
import { EndpointRestoreError, EndpointValidator } from './endpoint-validator';
import { testsForTargets } from './search';
import type {
  BisectCategory,
  BisectSearchPhase,
  BisectSession,
  BisectTarget,
  CommitAttempt,
  CommitRun,
  MergeInvestigation,
  MergeTargetResult,
} from './types';

export function buildMergeQueue(session: BisectSession): BisectSession {
  if (!session.primary) return session;
  const targetIdsByMerge = new Map<string, string[]>();
  for (const target of session.primary.targets) {
    if (target.status !== 'found' || !target.firstBadSha) continue;
    const parents = session.primary.commitParents[target.firstBadSha] ?? [];
    if (parents.length < 2) continue;
    const ids = targetIdsByMerge.get(target.firstBadSha) ?? [];
    ids.push(target.id);
    targetIdsByMerge.set(target.firstBadSha, ids);
  }
  const mergeQueue = session.primary.orderedCommits.filter((sha) => targetIdsByMerge.has(sha));
  const existing = session.mergeInvestigations ?? {};
  const mergeInvestigations = { ...existing };
  for (const mergeSha of mergeQueue) {
    if (mergeInvestigations[mergeSha]) continue;
    const parents = session.primary.commitParents[mergeSha] ?? [];
    const targetIds = targetIdsByMerge.get(mergeSha) ?? [];
    const octopus = parents.length > 2;
    mergeInvestigations[mergeSha] = {
      mergeSha,
      parents,
      status: octopus ? 'octopus-unsupported' : 'merge-uninvestigated',
      targetIds,
      targetResults: Object.fromEntries(targetIds.map((targetId) => [targetId, {
        kind: octopus ? 'octopus-unsupported' : 'merge-uninvestigated',
      } as MergeTargetResult])),
    };
  }
  return { ...session, mergeQueue, mergeInvestigations };
}

export interface MergeRangeSource {
  load(investigation: MergeInvestigation): Promise<PreparedChildGitRange>;
}

/** Owns loading and validating child topology from one experiment repository. */
export class GitMergeRangeSource implements MergeRangeSource {
  constructor(private readonly experimentDir: string) {}

  load(investigation: MergeInvestigation): Promise<PreparedChildGitRange> {
    return prepareChildGitRange({
      experimentDir: this.experimentDir,
      firstParent: investigation.parents[0],
      secondParent: investigation.parents[1],
    });
  }
}

/** Owns the queue, endpoint-attempt, and native child-phase lifecycle. */
export class MergeInvestigationRunner {
  constructor(
    private readonly owner: CompareBisectSession,
    private readonly ranges: MergeRangeSource,
    private readonly endpoints: EndpointValidator,
    private readonly nativeGit: NativeGitBisectDriver,
    private readonly candidates: CandidateEvaluator,
    private readonly environment: BisectRunEnvironment,
  ) {}

  async run(): Promise<BisectSession> {
    for (const mergeSha of this.owner.current().mergeQueue) {
      let investigation = this.owner.current().mergeInvestigations[mergeSha];
      if (!investigation || investigation.status === 'complete'
        || investigation.status === 'octopus-unsupported') continue;

      const primaryTargets = this.owner.current().primary.targets.filter((target) => (
        investigation!.targetIds.includes(target.id)
      ));
      let range: PreparedChildGitRange;
      try {
        range = await this.ranges.load(investigation);
      } catch (error) {
        await this.save({
          ...investigation,
          status: 'failed',
          failure: errorMessage(error),
        });
        continue;
      }

      investigation = await this.save({
        ...investigation,
        status: 'running',
        failure: undefined,
      });
      let phase = investigation.phase;
      const validationComplete = phase?.attempts.some((attempt) => (
        attempt.sha === range.secondParent && attempt.status === 'complete'
      )) === true;
      if (!validationComplete) {
        investigation = await this.validateSecondParent(investigation, range, primaryTargets);
        phase = investigation.phase;
      }
      if (!phase) throw new Error(`Merge investigation ${mergeSha} has no child phase`);

      const invalidTarget = range.mergeBase === range.secondParent
        ? phase.targets.find((target) => target.status === 'active')
        : undefined;
      if (invalidTarget) {
        const failure = `Cannot investigate merge source for ${mergeSha}: target `
          + `${invalidTarget.id} has no distinct good and bad commits`;
        await this.save({
          ...investigation,
          phase: { ...phase, status: 'failed', finishedAt: this.environment.now() },
          status: 'failed',
          failure,
        });
        continue;
      }

      if (phase.targets.length > 0 && phase.status !== 'complete') {
        phase = await new NativeBisectPhaseRunner(
          new MergePhaseStore(mergeSha, this.owner),
          this.nativeGit,
          this.candidates,
          this.environment,
        ).run();
        investigation = this.investigation(mergeSha);
      }

      const targetResults = { ...investigation.targetResults };
      for (const target of phase.targets) {
        if (!target.firstBadSha) continue;
        const nested = (phase.commitParents[target.firstBadSha] ?? []).length > 1;
        targetResults[target.id] = nested
          ? { kind: 'nested-merge', sourceSha: target.firstBadSha }
          : { kind: 'source-found', sourceSha: target.firstBadSha };
      }
      await this.save({ ...investigation, phase, status: 'complete', targetResults });
    }
    return this.owner.current();
  }

  private async validateSecondParent(
    investigation: MergeInvestigation,
    range: PreparedChildGitRange,
    primaryTargets: readonly BisectTarget[],
  ): Promise<MergeInvestigation> {
    const plan = workForTargets(range.secondParent, primaryTargets);
    const phase = investigation.phase
      ? { ...investigation.phase, status: 'pending' as const, targets: [...primaryTargets] }
      : childPhase(investigation, range, primaryTargets);
    const attempt: CommitAttempt = {
      id: `${phase.id}-endpoint-${phase.attempts.length + 1}`,
      sha: plan.sha,
      status: 'running',
      requestedCategories: [...plan.categories],
      requestedTests: [...plan.tests],
      experimentReloadMode: this.candidates.preferredReloadMode(),
      usedFallback: false,
      startedAt: this.environment.now(),
    };
    const runningPhase = { ...phase, attempts: [...phase.attempts, attempt] };
    investigation = await this.save({ ...investigation, phase: runningPhase });

    let validation: Awaited<ReturnType<EndpointValidator['validate']>>;
    let restorationFailure: EndpointRestoreError | undefined;
    try {
      validation = await this.endpoints.validate(plan);
    } catch (error) {
      if (error instanceof EndpointRestoreError) {
        validation = error.result;
        restorationFailure = error;
      } else {
        const evaluationError = findCandidateEvaluationError(error);
        const incomplete: CommitAttempt = {
          ...attempt,
          status: 'incomplete',
          finishedAt: this.environment.now(),
          error: errorMessage(error),
        };
        await this.save({
          ...investigation,
          phase: {
            ...runningPhase,
            attempts: replaceAttempt(runningPhase.attempts, incomplete),
          },
        }, evaluationError?.commitRun);
        if (evaluationError?.originalError instanceof BisectInterruptedError) {
          throw evaluationError.originalError;
        }
        throw error;
      }
    }

    const completed: CommitAttempt = {
      ...attempt,
      status: 'complete',
      experimentReloadMode: validation.experimentReload.mode,
      usedFallback: validation.experimentReload.usedFallback,
      finishedAt: validation.commitRun.finishedAt ?? this.environment.now(),
      ...(validation.commitRun.compareResultsPath
        ? { compareResultsPath: validation.commitRun.compareResultsPath }
        : {}),
    };
    const evaluations = new Map(
      validation.targetEvaluations.map((value) => [value.targetId, value]),
    );
    const reproducing: BisectTarget[] = [];
    const targetResults = { ...investigation.targetResults };
    for (const target of primaryTargets) {
      const evaluation = evaluations.get(target.id);
      if (!evaluation?.regressionDetected) {
        targetResults[target.id] = { kind: 'merge-introduced' };
        continue;
      }
      reproducing.push({
        ...target,
        status: 'active',
        firstBadSha: undefined,
        invalidReason: undefined,
        recordedTargetEvaluations: { [range.secondParent]: evaluation },
      });
    }
    const saved = await this.save({
      ...investigation,
      phase: {
        ...runningPhase,
        targets: reproducing,
        attempts: replaceAttempt(runningPhase.attempts, completed),
      },
      targetResults,
    }, validation.commitRun);
    if (restorationFailure) throw restorationFailure;
    return saved;
  }

  private async save(
    investigation: MergeInvestigation,
    commitRun?: CommitRun,
  ): Promise<MergeInvestigation> {
    let next = updateInvestigation(this.owner.current(), investigation);
    if (commitRun) {
      next = {
        ...next,
        commitRuns: { ...next.commitRuns, [commitRun.sha]: commitRun },
      };
    }
    await this.owner.save(next);
    return this.investigation(investigation.mergeSha);
  }

  private investigation(mergeSha: string): MergeInvestigation {
    const investigation = this.owner.current().mergeInvestigations[mergeSha];
    if (!investigation) throw new Error(`Unknown merge investigation: ${mergeSha}`);
    return investigation;
  }
}

function childPhase(
  investigation: MergeInvestigation,
  range: PreparedChildGitRange,
  targets: readonly BisectTarget[],
): BisectSearchPhase {
  return {
    id: `merge:${investigation.mergeSha}`,
    status: 'pending',
    goodSha: range.mergeBase,
    badSha: range.secondParent,
    orderedCommits: range.orderedCommits,
    commitSubjects: range.commitSubjects,
    commitParents: range.commitParents,
    targets: [...targets],
    attempts: [],
  };
}

function workForTargets(sha: string, targets: readonly BisectTarget[]): CandidateEvaluationPlan {
  return {
    sha,
    targetIds: targets.map((target) => target.id),
    categories: unique(targets.map((target) => target.category)),
    tests: testsForTargets(targets),
    targets: [...targets],
  };
}

function updateInvestigation(
  session: BisectSession,
  investigation: MergeInvestigation,
): BisectSession {
  return {
    ...session,
    mergeInvestigations: {
      ...session.mergeInvestigations,
      [investigation.mergeSha]: investigation,
    },
  };
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

function unique(values: BisectCategory[]): BisectCategory[] {
  return [...new Set(values)];
}
