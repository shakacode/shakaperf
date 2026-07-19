/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CandidateResult, RefreshMode } from './run-candidate';
import {
  applyCachedObservations,
  applyObservations,
  nextCandidate,
  type BisectSearchInput,
  type CandidateWork,
} from './search';
import type {
  BisectSearchPhase,
  CommitAttempt,
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

    const attempt: CommitAttempt = {
      id: options.nextAttemptId(),
      sha: work.sha,
      status: 'running',
      requestedCategories: [...work.categories],
      requestedTests: [...work.tests],
      refreshMode: options.preferredRefreshMode,
      usedFallback: false,
      startedAt: options.now(),
    };
    phase = { ...phase, attempts: [...phase.attempts, attempt] };
    options.checkpoint(phase);
    options.afterCheckpoint?.(phase);
    const preMeasurePhase = phase;

    try {
      const result = await options.measure(work);
      const observations = new Map<string, TargetObservation>(
        result.observations.map((observation) => [observation.targetId, observation]),
      );
      const updated = applyObservations(searchInput(phase), work.sha, observations);
      const completedAttempt: CommitAttempt = {
        ...attempt,
        status: 'complete',
        refreshMode: result.refresh.mode,
        usedFallback: result.refresh.usedFallback,
        finishedAt: result.commitRun.finishedAt ?? options.now(),
        ...(result.commitRun.compareResultsPath
          ? { compareResultsPath: result.commitRun.compareResultsPath }
          : {}),
      };
      const completedPhase = normalizePhase({
        ...preMeasurePhase,
        targets: updated.targets,
        attempts: replaceAttempt(preMeasurePhase.attempts, completedAttempt),
      });
      options.checkpoint(completedPhase);
      phase = completedPhase;
    } catch (error) {
      const incompleteAttempt: CommitAttempt = {
        ...attempt,
        status: 'incomplete',
        finishedAt: options.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      phase = {
        ...preMeasurePhase,
        attempts: replaceAttempt(preMeasurePhase.attempts, incompleteAttempt),
      };
      options.checkpoint(phase);
      options.afterCheckpoint?.(phase);
      throw error;
    }
    options.afterCheckpoint?.(phase);
  }
}

function replaceAttempt(
  attempts: readonly CommitAttempt[],
  replacement: CommitAttempt,
): CommitAttempt[] {
  return attempts.map((attempt) => (
    attempt.id === replacement.id ? replacement : attempt
  ));
}
