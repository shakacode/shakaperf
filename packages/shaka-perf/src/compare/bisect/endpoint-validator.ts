/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExactCheckout } from './git';
import { assertNoPipelineErrors, evaluateTargetsAtCommitFromTestResults } from './analyze';
import type { BisectRunEnvironment } from './run-environment';
import {
  BisectInterruptedError,
  CandidateEvaluationError,
  type BisectCandidateServer,
  type CandidateComparison,
  type CandidateEvaluationPlan,
  type CandidateResult,
  type ExperimentReloadMode,
} from './run-candidate';
import type { CommitRun } from './types';

/** Owns the refresh-and-compare lifecycle for explicitly positioned endpoints. */
export interface EndpointMeasurements {
  evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult>;
}

export class EndpointMeasurementRunner implements EndpointMeasurements {
  constructor(
    private readonly server: BisectCandidateServer,
    private readonly comparison: CandidateComparison,
    private readonly environment: BisectRunEnvironment,
    private readonly reloadMode: ExperimentReloadMode,
  ) {}

  async evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult> {
    let commitRun: CommitRun = {
      sha: plan.sha,
      compareCompleted: false,
      requestedCategories: [...plan.categories],
      requestedTests: [...plan.tests],
      experimentReloadMode: this.reloadMode,
      usedFallback: false,
      startedAt: this.environment.now(),
    };

    try {
      this.environment.checkCancellation();
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
      throw new CandidateEvaluationError({
        ...commitRun,
        finishedAt: this.environment.now(),
        ...(error instanceof BisectInterruptedError
          ? {}
          : { infrastructureError: errorMessage(error) }),
      }, error);
    }
  }
}

/**
 * Owns one temporary endpoint-checkout transaction. It cannot start or advance
 * a native bisect and always restores the checkout it observed on entry.
 */
export class EndpointValidator {
  constructor(
    private readonly checkout: ExactCheckout,
    private readonly measurements: EndpointMeasurements,
  ) {}

  async validate(plan: CandidateEvaluationPlan): Promise<CandidateResult> {
    const original = await this.checkout.current();
    let result: CandidateResult | undefined;
    let primaryError: unknown;

    try {
      await this.checkout.position(plan.sha);
      await this.checkout.assertAt(plan.sha);
      result = await this.measurements.evaluate(plan);
    } catch (error) {
      primaryError = error;
    }

    try {
      await this.checkout.restore(original);
    } catch (restoreError) {
      if (primaryError !== undefined) {
        throw new AggregateError(
          [primaryError, restoreError],
          `Endpoint ${plan.sha} failed and its original checkout could not be restored`,
        );
      }
      throw restoreError;
    }

    if (primaryError !== undefined) throw primaryError;
    if (!result) throw new Error(`Endpoint ${plan.sha} completed without a measurement`);
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
