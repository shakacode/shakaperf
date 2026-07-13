import type { TestResult } from '../../pipeline/report';
import { assertNoPipelineErrors, observeTargets } from './analyze';
import type {
  BisectCategory,
  BisectTestSelection,
  BisectTarget,
  CommitRun,
  TargetObservation,
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

export interface MaterializeRequest {
  previousSha: string | null;
  candidateSha: string;
}

export type CandidateCheckpoint = 'checkout' | 'materialize' | 'refresh' | 'compare' | 'failed';

export interface CandidateDependencies {
  checkout(sha: string): Promise<void>;
  materialize(request: MaterializeRequest): Promise<void>;
  refresh(request: RefreshRequest): Promise<RefreshResult>;
  compare(request: CompareRunRequest): Promise<CompareRunResult>;
  now(): string;
}

export interface RunCandidateOptions {
  sha: string;
  previousSha: string | null;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  targets: readonly BisectTarget[];
  preferredMode: RefreshMode;
  dependencies: CandidateDependencies;
  onCheckpoint(checkpoint: CandidateCheckpoint, commitRun: CommitRun): void;
  checkCancellation(): void;
}

export interface CandidateResult {
  commitRun: CommitRun;
  testResults: readonly TestResult[];
  observations: readonly TargetObservation[];
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
    requestedCategories: [...options.categories],
    requestedTests: [...options.tests],
    refreshMode: options.preferredMode,
    usedFallback: false,
    startedAt: options.dependencies.now(),
  };
  let commitRun = baseRun;

  try {
    await options.dependencies.checkout(options.sha);
    options.onCheckpoint('checkout', commitRun);
    options.checkCancellation();

    await options.dependencies.materialize({
      previousSha: options.previousSha,
      candidateSha: options.sha,
    });
    options.onCheckpoint('materialize', commitRun);
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
    options.onCheckpoint('refresh', commitRun);
    options.checkCancellation();

    const compare = await options.dependencies.compare({
      sha: options.sha,
      categories: options.categories,
      tests: options.tests,
    });
    commitRun = {
      ...commitRun,
      compareResultsPath: compare.compareResultsPath,
      finishedAt: options.dependencies.now(),
    };
    options.onCheckpoint('compare', commitRun);
    options.checkCancellation();
    assertNoPipelineErrors(compare.testResults, options.sha);

    const observations = options.targets.length === 0
      ? []
      : observeTargets(compare.testResults, options.targets, options.sha);
    return {
      commitRun,
      testResults: compare.testResults,
      observations,
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
    options.onCheckpoint('failed', failedRun);
    if (error instanceof BisectInterruptedError) throw error;
    throw new Error(`Candidate ${options.sha} failed: ${(error as Error).message}`, { cause: error });
  }
}
