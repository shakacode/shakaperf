/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExactCheckout } from './git';
import {
  type CandidateEvaluationPlan,
  type CandidateResult,
} from './run-candidate';

/** Owns the refresh-and-compare lifecycle for explicitly positioned endpoints. */
export interface EndpointMeasurements {
  evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult>;
}

export class EndpointRestoreError extends Error {
  constructor(
    readonly result: CandidateResult,
    readonly restoreError: unknown,
  ) {
    super(`Endpoint ${result.commitRun.sha} was measured but its original checkout could not be restored: ${errorMessage(restoreError)}`, {
      cause: restoreError,
    });
    this.name = 'EndpointRestoreError';
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
      if (result) throw new EndpointRestoreError(result, restoreError);
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
