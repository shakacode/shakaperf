/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CandidateResult, ExperimentReloadMode } from './run-candidate';
import { runCheckpointedAttempt } from './attempt';
import {
  narrowTargetSearchRangesUsingRecordedEvaluations,
  recordTargetEvaluationsAndNarrowSearchRanges,
  nextCandidate,
  type BisectSearchInput,
  type CandidateMeasurementPlan,
} from './search';
import type {
  BisectSearchPhase,
  CommitRun,
  TargetEvaluationAtCommit,
} from './types';

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
