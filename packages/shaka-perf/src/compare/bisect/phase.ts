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
  type CandidateWork,
} from './search';
import type {
  BisectCategory,
  BisectSearchPhase,
  BisectSession,
  CommitAttempt,
  TargetObservation,
} from './types';

export interface RunSearchPhaseOptions {
  phase: BisectSearchPhase;
  preferredRefreshMode: RefreshMode;
  nextAttemptId(): string;
  now(): string;
  checkpoint(phase: BisectSearchPhase): void;
  measure(work: CandidateWork): Promise<CandidateResult>;
}

export async function runSearchPhase(
  options: RunSearchPhaseOptions,
): Promise<BisectSearchPhase> {
  let phase = normalizePhase({
    ...options.phase,
    status: 'running',
    startedAt: options.phase.startedAt ?? options.now(),
  });
  options.checkpoint(phase);

  while (true) {
    const work = nextCandidate(applyCachedObservations(toLegacySession(phase)));
    if (!work) {
      phase = {
        ...phase,
        status: 'complete',
        finishedAt: options.now(),
      };
      options.checkpoint(phase);
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

    try {
      const result = await options.measure(work);
      const observations = new Map<string, TargetObservation>(
        result.observations.map((observation) => [observation.targetId, observation]),
      );
      const updated = applyObservations(toLegacySession(phase), work.sha, observations);
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
      phase = normalizePhase({
        ...phase,
        targets: updated.targets,
        attempts: replaceAttempt(phase.attempts, completedAttempt),
      });
      options.checkpoint(phase);
    } catch (error) {
      const incompleteAttempt: CommitAttempt = {
        ...attempt,
        status: 'incomplete',
        finishedAt: options.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      phase = {
        ...phase,
        attempts: replaceAttempt(phase.attempts, incompleteAttempt),
      };
      options.checkpoint(phase);
      throw error;
    }
  }
}

function normalizePhase(phase: BisectSearchPhase): BisectSearchPhase {
  const normalized = applyCachedObservations(toLegacySession(phase));
  return { ...phase, targets: normalized.targets };
}

function toLegacySession(phase: BisectSearchPhase): BisectSession {
  return {
    version: 1,
    status: 'running',
    goodSha: phase.goodSha,
    badSha: phase.badSha,
    originalExperiment: { sha: phase.badSha, branch: null },
    commitSubjects: phase.commitSubjects,
    selectedCategories: unique(phase.targets.map((target) => target.category)),
    orderedCommits: phase.orderedCommits,
    targets: phase.targets,
    commitRuns: {},
    startedAt: phase.startedAt ?? '',
  };
}

function replaceAttempt(
  attempts: readonly CommitAttempt[],
  replacement: CommitAttempt,
): CommitAttempt[] {
  return attempts.map((attempt) => (
    attempt.id === replacement.id ? replacement : attempt
  ));
}

function unique(values: BisectCategory[]): BisectCategory[] {
  return [...new Set(values)];
}
