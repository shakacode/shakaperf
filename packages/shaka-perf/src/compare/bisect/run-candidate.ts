import type { TestResult } from '../../pipeline/report';
import { assertNoPipelineErrors, evaluateTargetsAtCommitFromTestResults } from './analyze';
import type {
  BisectCategory,
  BisectTestSelection,
  BisectTarget,
  CommitRun,
  TargetEvaluationAtCommit,
} from './types';

export type RefreshMode = CommitRun['refreshMode'];

export interface CompareRunRequest {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
}

export interface CompareRunResult {
  testResults: readonly TestResult[];
  compareResultsPath?: string;
}

export interface RefreshRequest {
  sha: string;
  preferredMode: RefreshMode;
}

export interface RefreshResult {
  mode: RefreshMode;
  usedFallback: boolean;
}

export interface SyncCandidateFilesRequest {
  previouslySyncedSha: string | null;
  candidateSha: string;
}

export type CandidateRunProgressEvent =
  | 'checkout-completed'
  | 'candidate-files-synced'
  | 'experiment-refreshed'
  | 'comparison-completed'
  | 'candidate-run-failed';

export interface CandidateDependencies {
  checkout(sha: string): Promise<void>;
  syncCandidateFilesToExperimentVolume(request: SyncCandidateFilesRequest): Promise<void>;
  refresh(request: RefreshRequest): Promise<RefreshResult>;
  compare(request: CompareRunRequest): Promise<CompareRunResult>;
  now(): string;
}

export interface RunCandidateOptions {
  sha: string;
  previouslySyncedSha: string | null;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  targets: readonly BisectTarget[];
  preferredMode: RefreshMode;
  dependencies: CandidateDependencies;
  recordCandidateRunProgress(event: CandidateRunProgressEvent, commitRun: CommitRun): void;
  checkCancellation(): void;
}

export interface CandidateResult {
  commitRun: CommitRun;
  testResults: readonly TestResult[];
  targetEvaluations: readonly TargetEvaluationAtCommit[];
  refresh: RefreshResult;
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
    refreshMode: options.preferredMode,
    usedFallback: false,
    startedAt: options.dependencies.now(),
  };
  let commitRun = baseRun;

  try {
    await options.dependencies.checkout(options.sha);
    options.recordCandidateRunProgress('checkout-completed', commitRun);
    options.checkCancellation();

    await options.dependencies.syncCandidateFilesToExperimentVolume({
      previouslySyncedSha: options.previouslySyncedSha,
      candidateSha: options.sha,
    });
    options.recordCandidateRunProgress('candidate-files-synced', commitRun);
    options.checkCancellation();

    const refresh = await options.dependencies.refresh({
      sha: options.sha,
      preferredMode: options.preferredMode,
    });
    commitRun = {
      ...commitRun,
      refreshMode: refresh.mode,
      usedFallback: refresh.usedFallback,
    };
    options.recordCandidateRunProgress('experiment-refreshed', commitRun);
    options.checkCancellation();

    const compare = await options.dependencies.compare({
      sha: options.sha,
      categories: options.categories,
      tests: options.tests,
    });
    commitRun = {
      ...commitRun,
      compareCompleted: true,
      compareResultsPath: compare.compareResultsPath,
      finishedAt: options.dependencies.now(),
    };
    options.recordCandidateRunProgress('comparison-completed', commitRun);
    options.checkCancellation();
    assertNoPipelineErrors(compare.testResults, options.sha);

    const targetEvaluations = options.targets.length === 0
      ? []
      : evaluateTargetsAtCommitFromTestResults(compare.testResults, options.targets, options.sha);
    return {
      commitRun,
      testResults: compare.testResults,
      targetEvaluations,
      refresh,
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
