/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CandidateResult, ExperimentReloadMode } from './run-candidate';
import { runCheckpointedAttempt } from './attempt';
import {
  candidatePlanForGroup,
  coalesceTargetGroups,
  createInitialTargetGroup,
  narrowTargetSearchRangesUsingRecordedEvaluations,
  recordTargetEvaluationsAndNarrowSearchRanges,
  nextCandidate,
  partitionTargetGroup,
  type BisectSearchInput,
  type CandidateMeasurementPlan,
} from './search';
import type {
  BisectSearchPhase,
  BisectTargetGroup,
  CommitRun,
  TargetEvaluationAtCommit,
} from './types';
import type { NativeBisectStep, NativeBisectVerdict } from './git';

export interface RunSearchPhaseOptions {
  phase: BisectSearchPhase;
  preferredExperimentReloadMode: ExperimentReloadMode;
  nextAttemptId(): string;
  now(): string;
  /**
   * The session's commit runs as of *now*. Read through a getter because
   * `measure` records a run mid-flight, and
   * `recordTargetEvaluationsAndNarrowSearchRanges` must see the
   * resulting `infrastructureError` to refuse the evaluations it produced.
   */
  commitRuns(): Record<string, CommitRun>;
  checkpoint(phase: BisectSearchPhase): void;
  afterCheckpoint?(phase: BisectSearchPhase): void;
  measure(work: CandidateMeasurementPlan): Promise<CandidateResult>;
}

export interface NativeBisectPhaseDriver {
  start(group: BisectTargetGroup): Promise<NativeBisectStep>;
  mark(verdict: NativeBisectVerdict): Promise<NativeBisectStep>;
  reset(): Promise<void>;
}

export interface RunNativeSearchPhaseOptions extends RunSearchPhaseOptions {
  nativeBisect: NativeBisectPhaseDriver;
  nextGroupId(): string;
}

export async function runNativeSearchPhase(
  options: RunNativeSearchPhaseOptions,
): Promise<BisectSearchPhase> {
  let phase = initializeNativeGroups(options.phase);
  phase = {
    ...phase,
    status: 'running',
    startedAt: phase.startedAt ?? options.now(),
  };
  checkpointNativePhase(options, phase);

  while (true) {
    const group = nextNativeGroup(phase);
    if (!group) {
      phase = {
        ...phase,
        status: 'complete',
        activeGroupId: undefined,
        finishedAt: options.now(),
      };
      checkpointNativePhase(options, phase);
      return phase;
    }

    phase = updateGroup(phase, { ...group, status: 'running' });
    phase = { ...phase, activeGroupId: group.id };
    checkpointNativePhase(options, phase);

    let started = false;
    let primaryError: unknown;
    try {
      let step = await options.nativeBisect.start(currentGroup(phase, group.id));
      started = true;
      while (!step.complete) {
        const candidateSha = step.candidateSha;
        if (!candidateSha) throw new Error(`Native Git bisect did not provide a candidate for ${group.id}`);
        const activeGroup = currentGroup(phase, group.id);
        const work = candidatePlanForGroup(activeGroup, phase.targets, candidateSha);
        let partition: ReturnType<typeof partitionTargetGroup>;

        if (work.targetIds.length === 0) {
          partition = partitionTargetGroup({
            group: activeGroup,
            targets: phase.targets,
            sha: candidateSha,
            evaluations: [],
            nextGroupId: options.nextGroupId,
          });
          phase = applyPartition(phase, activeGroup.id, partition);
          checkpointNativePhase(options, phase);
        } else {
          let preMeasurePhase = phase;
          let completedPartition: ReturnType<typeof partitionTargetGroup> | undefined;
          await runCheckpointedAttempt({
            attempts: phase.attempts,
            work,
            preferredExperimentReloadMode: options.preferredExperimentReloadMode,
            nextAttemptId: options.nextAttemptId,
            now: options.now,
            checkpointRunning(attempts) {
              preMeasurePhase = { ...phase, attempts };
              phase = preMeasurePhase;
              options.checkpoint(phase);
            },
            checkpointComplete(attempts, result) {
              const infrastructureError = options.commitRuns()[candidateSha]?.infrastructureError;
              if (infrastructureError) {
                throw new Error(`Cannot record target evaluations for ${candidateSha}: ${infrastructureError}`);
              }
              completedPartition = partitionTargetGroup({
                group: currentGroup(preMeasurePhase, group.id),
                targets: preMeasurePhase.targets,
                sha: candidateSha,
                evaluations: result.targetEvaluations,
                nextGroupId: options.nextGroupId,
              });
              phase = applyPartition({ ...preMeasurePhase, attempts }, group.id, completedPartition);
              options.checkpoint(phase);
            },
            checkpointIncomplete(attempts) {
              phase = { ...preMeasurePhase, attempts };
              options.checkpoint(phase);
            },
            afterCheckpoint() {
              options.afterCheckpoint?.(phase);
            },
            measure: () => options.measure(work),
          });
          if (!completedPartition) throw new Error(`Candidate ${candidateSha} completed without a partition`);
          partition = completedPartition;
        }

        step = await options.nativeBisect.mark(partition.verdict);
      }

      const firstBadSha = step.firstBadSha;
      if (!firstBadSha) throw new Error(`Native Git bisect completed ${group.id} without a first bad commit`);
      phase = completeNativeGroup(phase, group.id, firstBadSha);
      checkpointNativePhase(options, phase);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (started) {
        try {
          await options.nativeBisect.reset();
        } catch (resetError) {
          if (primaryError === undefined) throw resetError;
        }
      }
    }
  }
}

function initializeNativeGroups(phase: BisectSearchPhase): BisectSearchPhase {
  if (phase.groups && phase.groups.length > 0) return phase;
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

function nextNativeGroup(phase: BisectSearchPhase): BisectTargetGroup | undefined {
  return phase.groups?.find((group) => group.status === 'running')
    ?? phase.groups?.find((group) => group.status === 'pending');
}

function currentGroup(phase: BisectSearchPhase, groupId: string): BisectTargetGroup {
  const group = phase.groups?.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown native bisect target group: ${groupId}`);
  return group;
}

function updateGroup(phase: BisectSearchPhase, group: BisectTargetGroup): BisectSearchPhase {
  return {
    ...phase,
    groups: (phase.groups ?? []).map((candidate) => candidate.id === group.id ? group : candidate),
  };
}

function applyPartition(
  phase: BisectSearchPhase,
  groupId: string,
  partition: ReturnType<typeof partitionTargetGroup>,
): BisectSearchPhase {
  const groups = (phase.groups ?? []).map((group) => (
    group.id === groupId ? partition.continuingGroup : group
  ));
  return {
    ...phase,
    targets: partition.targets,
    groups: coalesceTargetGroups([...groups, ...partition.queuedGroups]),
  };
}

function completeNativeGroup(
  phase: BisectSearchPhase,
  groupId: string,
  firstBadSha: string,
): BisectSearchPhase {
  const group = currentGroup(phase, groupId);
  const targetIds = new Set(group.targetIds);
  return {
    ...phase,
    activeGroupId: undefined,
    groups: (phase.groups ?? []).map((candidate) => candidate.id === groupId
      ? { ...candidate, status: 'complete' as const, firstBadSha }
      : candidate),
    targets: phase.targets.map((target) => targetIds.has(target.id)
      ? { ...target, status: 'found' as const, firstBadSha }
      : target),
  };
}

function checkpointNativePhase(
  options: RunNativeSearchPhaseOptions,
  phase: BisectSearchPhase,
): void {
  options.checkpoint(phase);
  options.afterCheckpoint?.(phase);
}

export async function runSearchPhase(
  options: RunSearchPhaseOptions,
): Promise<BisectSearchPhase> {
  const searchInput = (phase: BisectSearchPhase): BisectSearchInput => ({
    orderedCommits: phase.orderedCommits,
    targets: phase.targets,
    commitRuns: options.commitRuns(),
  });
  const narrowPhaseSearchRangesUsingRecordedEvaluations = (
    phase: BisectSearchPhase,
  ): BisectSearchPhase => ({
    ...phase,
    targets: narrowTargetSearchRangesUsingRecordedEvaluations(searchInput(phase)).targets,
  });

  let phase = narrowPhaseSearchRangesUsingRecordedEvaluations({
    ...options.phase,
    status: 'running',
    startedAt: options.phase.startedAt ?? options.now(),
  });
  options.checkpoint(phase);
  options.afterCheckpoint?.(phase);

  while (true) {
    const work = nextCandidate(
      narrowTargetSearchRangesUsingRecordedEvaluations(searchInput(phase)),
    );
    if (!work) {
      phase = {
        ...phase,
        status: 'complete',
        finishedAt: options.now(),
      };
      options.checkpoint(phase);
      options.afterCheckpoint?.(phase);
      return phase;
    }

    let preMeasurePhase = phase;
    await runCheckpointedAttempt({
      attempts: phase.attempts,
      work,
      preferredExperimentReloadMode: options.preferredExperimentReloadMode,
      nextAttemptId: options.nextAttemptId,
      now: options.now,
      checkpointRunning(attempts) {
        preMeasurePhase = { ...phase, attempts };
        phase = preMeasurePhase;
        options.checkpoint(phase);
      },
      checkpointComplete(attempts, result) {
        const targetEvaluations = new Map<string, TargetEvaluationAtCommit>(
          result.targetEvaluations.map((evaluation) => [evaluation.targetId, evaluation]),
        );
        const updated = recordTargetEvaluationsAndNarrowSearchRanges(
          searchInput(preMeasurePhase),
          work.sha,
          targetEvaluations,
        );
        phase = narrowPhaseSearchRangesUsingRecordedEvaluations({
          ...preMeasurePhase,
          targets: updated.targets,
          attempts,
        });
        options.checkpoint(phase);
      },
      checkpointIncomplete(attempts) {
        phase = { ...preMeasurePhase, attempts };
        options.checkpoint(phase);
      },
      afterCheckpoint() {
        options.afterCheckpoint?.(phase);
      },
      measure: () => options.measure(work),
    });
  }
}
