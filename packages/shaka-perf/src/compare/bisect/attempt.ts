/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CandidateResult, ExperimentReloadMode } from './run-candidate';
import type { CandidateMeasurementPlan } from './search';
import type { CommitAttempt } from './types';

export interface RunCheckpointedAttemptOptions {
  attempts: readonly CommitAttempt[];
  work: CandidateMeasurementPlan;
  preferredExperimentReloadMode: ExperimentReloadMode;
  nextAttemptId(): string;
  now(): string;
  checkpointRunning(attempts: CommitAttempt[]): void;
  checkpointComplete(attempts: CommitAttempt[], result: CandidateResult): void;
  checkpointIncomplete(attempts: CommitAttempt[], error: unknown): void;
  afterCheckpoint?(): void;
  measure(): Promise<CandidateResult>;
}

export async function runCheckpointedAttempt(
  options: RunCheckpointedAttemptOptions,
): Promise<CandidateResult> {
  const attempt: CommitAttempt = {
    id: options.nextAttemptId(),
    sha: options.work.sha,
    status: 'running',
    requestedCategories: [...options.work.categories],
    requestedTests: [...options.work.tests],
    experimentReloadMode: options.preferredExperimentReloadMode,
    usedFallback: false,
    startedAt: options.now(),
  };
  const runningAttempts = [...options.attempts, attempt];
  options.checkpointRunning(runningAttempts);
  options.afterCheckpoint?.();

  let result: CandidateResult;
  try {
    result = await options.measure();
    const completedAttempt: CommitAttempt = {
      ...attempt,
      status: 'complete',
      experimentReloadMode: result.experimentReload.mode,
      usedFallback: result.experimentReload.usedFallback,
      finishedAt: result.commitRun.finishedAt ?? options.now(),
      ...(result.commitRun.compareResultsPath
        ? { compareResultsPath: result.commitRun.compareResultsPath }
        : {}),
    };
    options.checkpointComplete(
      replaceAttempt(runningAttempts, completedAttempt),
      result,
    );
  } catch (error) {
    const incompleteAttempt: CommitAttempt = {
      ...attempt,
      status: 'incomplete',
      finishedAt: options.now(),
      error: error instanceof Error ? error.message : String(error),
    };
    options.checkpointIncomplete(
      replaceAttempt(runningAttempts, incompleteAttempt),
      error,
    );
    options.afterCheckpoint?.();
    throw error;
  }

  options.afterCheckpoint?.();
  return result;
}

function replaceAttempt(
  attempts: readonly CommitAttempt[],
  replacement: CommitAttempt,
): CommitAttempt[] {
  return attempts.map((attempt) => (
    attempt.id === replacement.id ? replacement : attempt
  ));
}
