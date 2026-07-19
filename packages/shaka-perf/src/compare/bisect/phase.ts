/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CandidateResult, RefreshMode } from './run-candidate';
import { runCheckpointedAttempt } from './attempt';
import {
  applyCachedObservations,
  applyObservations,
  nextCandidate,
  type BisectSearchInput,
  type CandidateWork,
} from './search';
import type {
  BisectSearchPhase,
  CommitRun,
  TargetObservation,
} from './types';

export interface RunSearchPhaseOptions {
  phase: BisectSearchPhase;
  preferredRefreshMode: RefreshMode;
  nextAttemptId(): string;
  now(): string;
  /**
   * The session's commit runs as of *now*. Read through a getter because
   * `measure` records a run mid-flight, and `applyObservations` must see the
   * resulting `infrastructureError` to refuse the observations it produced.
   */
  commitRuns(): Record<string, CommitRun>;
  checkpoint(phase: BisectSearchPhase): void;
  afterCheckpoint?(phase: BisectSearchPhase): void;
  measure(work: CandidateWork): Promise<CandidateResult>;
}

export async function runSearchPhase(
  options: RunSearchPhaseOptions,
): Promise<BisectSearchPhase> {
  const searchInput = (phase: BisectSearchPhase): BisectSearchInput => ({
    orderedCommits: phase.orderedCommits,
    targets: phase.targets,
    commitRuns: options.commitRuns(),
  });
  const normalizePhase = (phase: BisectSearchPhase): BisectSearchPhase => ({
    ...phase,
    targets: applyCachedObservations(searchInput(phase)).targets,
  });

  let phase = normalizePhase({
    ...options.phase,
    status: 'running',
    startedAt: options.phase.startedAt ?? options.now(),
  });
  options.checkpoint(phase);
  options.afterCheckpoint?.(phase);

  while (true) {
    const work = nextCandidate(applyCachedObservations(searchInput(phase)));
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
      preferredRefreshMode: options.preferredRefreshMode,
      nextAttemptId: options.nextAttemptId,
      now: options.now,
      checkpointRunning(attempts) {
        preMeasurePhase = { ...phase, attempts };
        phase = preMeasurePhase;
        options.checkpoint(phase);
      },
      checkpointComplete(attempts, result) {
        const observations = new Map<string, TargetObservation>(
          result.observations.map((observation) => [observation.targetId, observation]),
        );
        const updated = applyObservations(searchInput(preMeasurePhase), work.sha, observations);
        phase = normalizePhase({
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
