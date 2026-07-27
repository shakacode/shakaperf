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
import type { CandidateMeasurementPlan } from './search';
import type { BisectRunEnvironment } from './run-environment';
import {
  BisectRepairTransactionError,
  createRepairEvidence,
  type BisectRepairExecutor,
} from './repair-runtime';

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

export interface CandidateResult {
  commitRun: CommitRun;
  testResults: readonly TestResult[];
  targetEvaluations: readonly TargetEvaluationAtCommit[];
  experimentReload: ExperimentReloadResult;
}

export interface CandidateEvaluationPlan extends CandidateMeasurementPlan {
  targets: readonly BisectTarget[];
  evaluationId?: string;
}

export interface CandidatePosition {
  assertAt(expectedSha: string): Promise<void>;
}

export interface BisectCandidateServer {
  refreshExperiment(request: ExperimentReloadRequest): Promise<ExperimentReloadResult>;
}

export interface CandidateComparison {
  run(request: CompareRunRequest): Promise<CompareRunResult>;
}

export class CandidateEvaluationError extends Error {
  constructor(
    readonly commitRun: CommitRun,
    readonly originalError: unknown,
  ) {
    super(`Candidate ${commitRun.sha} failed: ${errorMessage(originalError)}`, {
      cause: originalError,
    });
    this.name = 'CandidateEvaluationError';
  }
}

/**
 * Evaluates the candidate already selected by native Git. It deliberately has
 * no persistence API: the phase runner owns the attempt and classification
 * transition that consumes this result.
 */
export class CandidateEvaluator {
  constructor(
    private readonly position: CandidatePosition,
    private readonly server: BisectCandidateServer,
    private readonly comparison: CandidateComparison,
    private readonly environment: BisectRunEnvironment,
    private readonly reloadMode: ExperimentReloadMode,
    private readonly repairs: BisectRepairExecutor = NO_REPAIRS,
  ) {}

  preferredReloadMode(): ExperimentReloadMode {
    return this.reloadMode;
  }

  repairSelection(sha: string, evaluationId: string) {
    return this.repairs.selectionFor(sha, evaluationId);
  }

  async evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult> {
    const evaluationId = plan.evaluationId ?? `candidate:${plan.sha}`;
    let repairEvidence = this.repairs.selectionFor(plan.sha, evaluationId);
    let commitRun: CommitRun = {
      sha: plan.sha,
      compareCompleted: false,
      requestedCategories: [...plan.categories],
      requestedTests: [...plan.tests],
      experimentReloadMode: this.reloadMode,
      usedFallback: false,
      repairIds: repairEvidence.repairIds,
      repairSetFingerprint: repairEvidence.repairSetFingerprint,
      repairEvidence,
      startedAt: this.environment.now(),
    };

    try {
      await this.position.assertAt(plan.sha);
      this.environment.checkCancellation();

      const transaction = await this.repairs.withRepairs({
        sha: plan.sha,
        evaluationId,
        run: async ({ prepare }) => {
          const experimentReload = await this.server.refreshExperiment({
            sha: plan.sha,
            preferredExperimentReloadMode: this.reloadMode,
          });
          commitRun = {
            ...commitRun,
            experimentReloadMode: experimentReload.mode,
            usedFallback: experimentReload.usedFallback,
          };
          this.environment.checkCancellation();
          await prepare();
          this.environment.checkCancellation();

          const comparison = await this.comparison.run({
            sha: plan.sha,
            categories: plan.categories,
            tests: plan.tests,
          });
          commitRun = {
            ...commitRun,
            compareCompleted: true,
            compareResultsPath: comparison.compareResultsPath,
            finishedAt: this.environment.now(),
          };
          this.environment.checkCancellation();
          assertNoPipelineErrors(comparison.testResults, plan.sha);
          return { comparison, experimentReload };
        },
      });
      repairEvidence = transaction.evidence;
      commitRun = {
        ...commitRun,
        repairIds: repairEvidence.repairIds,
        repairSetFingerprint: repairEvidence.repairSetFingerprint,
        repairEvidence,
      };
      this.environment.checkCancellation();
      const { comparison, experimentReload } = transaction.value;

      return {
        commitRun,
        testResults: comparison.testResults,
        targetEvaluations: plan.targets.length === 0
          ? []
          : evaluateTargetsAtCommitFromTestResults(
            comparison.testResults,
            plan.targets,
            plan.sha,
          ),
        experimentReload,
      };
    } catch (error) {
      if (error instanceof BisectRepairTransactionError) {
        repairEvidence = error.evidence;
        error = error.originalError;
      }
      const failedRun: CommitRun = {
        ...commitRun,
        repairIds: repairEvidence.repairIds,
        repairSetFingerprint: repairEvidence.repairSetFingerprint,
        repairEvidence,
        finishedAt: this.environment.now(),
        ...(error instanceof BisectInterruptedError
          ? {}
          : { infrastructureError: errorMessage(error) }),
      };
      throw new CandidateEvaluationError(failedRun, error);
    }
  }
}

const NO_REPAIRS: BisectRepairExecutor = {
  selectionFor: (sha, evaluationId) => createRepairEvidence(sha, evaluationId, []),
  async withRepairs(options) {
    return {
      value: await options.run({ prepare: async () => undefined }),
      evidence: createRepairEvidence(options.sha, options.evaluationId, []),
    };
  },
};

export class BisectInterruptedError extends Error {
  constructor(readonly signal: NodeJS.Signals) {
    super(`Bisect interrupted by ${signal}`);
    this.name = 'BisectInterruptedError';
  }
}

export function findCandidateEvaluationError(
  error: unknown,
): CandidateEvaluationError | undefined {
  if (error instanceof CandidateEvaluationError) return error;
  if (error instanceof AggregateError) {
    return error.errors.map(findCandidateEvaluationError).find(Boolean);
  }
  return undefined;
}

export function containsBisectInterruption(error: unknown): boolean {
  if (error instanceof BisectInterruptedError) return true;
  if (error instanceof CandidateEvaluationError) {
    return containsBisectInterruption(error.originalError);
  }
  return error instanceof AggregateError
    && error.errors.some(containsBisectInterruption);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
