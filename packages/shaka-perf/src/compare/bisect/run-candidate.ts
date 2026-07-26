/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestResult } from '../../pipeline/report';
import { assertNoPipelineErrors, evaluateTargetsAtCommitFromTestResults } from './analyze';
import type {
  BisectCategory,
  BisectTestSelection,
  BisectTarget,
  CommitRun,
  TargetEvaluationAtCommit,
} from './types';

export type ExperimentReloadMode = CommitRun['experimentReloadMode'];

export interface CompareRunRequest {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
}

export interface CompareRunResult {
  testResults: readonly TestResult[];
  compareResultsPath?: string;
}

export interface ExperimentReloadRequest {
  sha: string;
  preferredExperimentReloadMode: ExperimentReloadMode;
}

export interface ExperimentReloadResult {
  mode: ExperimentReloadMode;
  usedFallback: boolean;
}

export type CandidateRunProgressEvent =
  | 'checkout-completed'
  | 'experiment-reloaded'
  | 'comparison-completed'
  | 'candidate-run-failed';

export interface CandidateDependencies {
  checkout(sha: string): Promise<void>;
  reloadExperiment(request: ExperimentReloadRequest): Promise<ExperimentReloadResult>;
  runCandidateComparisons(request: CompareRunRequest): Promise<CompareRunResult>;
  now(): string;
}

export interface RunCandidateOptions {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  targets: readonly BisectTarget[];
  preferredExperimentReloadMode: ExperimentReloadMode;
  dependencies: CandidateDependencies;
  recordCandidateRunProgress(event: CandidateRunProgressEvent, commitRun: CommitRun): void;
  checkCancellation(): void;
}

export interface CandidateResult {
  commitRun: CommitRun;
  testResults: readonly TestResult[];
  targetEvaluations: readonly TargetEvaluationAtCommit[];
  experimentReload: ExperimentReloadResult;
}

export class BisectInterruptedError extends Error {
  constructor(readonly signal: NodeJS.Signals) {
    super(`Compare bisect interrupted by ${signal}`);
    this.name = 'BisectInterruptedError';
  }
}

export async function runCandidate(options: RunCandidateOptions): Promise<CandidateResult> {
  const baseRun: CommitRun = {
    sha: options.sha,
    compareCompleted: false,
    requestedCategories: [...options.categories],
    requestedTests: [...options.tests],
    experimentReloadMode: options.preferredExperimentReloadMode,
    usedFallback: false,
    startedAt: options.dependencies.now(),
  };
  let commitRun = baseRun;

  try {
    await options.dependencies.checkout(options.sha);
    options.recordCandidateRunProgress('checkout-completed', commitRun);
    options.checkCancellation();

    const experimentReload = await options.dependencies.reloadExperiment({
      sha: options.sha,
      preferredExperimentReloadMode: options.preferredExperimentReloadMode,
    });
    commitRun = {
      ...commitRun,
      experimentReloadMode: experimentReload.mode,
      usedFallback: experimentReload.usedFallback,
    };
    options.recordCandidateRunProgress('experiment-reloaded', commitRun);
    options.checkCancellation();

    const candidateComparisons = await options.dependencies.runCandidateComparisons({
      sha: options.sha,
      categories: options.categories,
      tests: options.tests,
    });
    commitRun = {
      ...commitRun,
      compareCompleted: true,
      compareResultsPath: candidateComparisons.compareResultsPath,
      finishedAt: options.dependencies.now(),
    };
    options.recordCandidateRunProgress('comparison-completed', commitRun);
    options.checkCancellation();
    assertNoPipelineErrors(candidateComparisons.testResults, options.sha);

    const targetEvaluations = options.targets.length === 0
      ? []
      : evaluateTargetsAtCommitFromTestResults(
        candidateComparisons.testResults,
        options.targets,
        options.sha,
      );
    return {
      commitRun,
      testResults: candidateComparisons.testResults,
      targetEvaluations,
      experimentReload,
    };
  } catch (error) {
    const failedRun: CommitRun = {
      ...commitRun,
      finishedAt: options.dependencies.now(),
      ...(error instanceof BisectInterruptedError
        ? {}
        : { infrastructureError: (error as Error).message }),
    };
    options.recordCandidateRunProgress('candidate-run-failed', failedRun);
    if (error instanceof BisectInterruptedError) throw error;
    throw new Error(`Candidate ${options.sha} failed: ${(error as Error).message}`, { cause: error });
  }
}
