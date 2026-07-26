/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExactCheckout } from './git';
import type { CandidateEvaluationPlan, CandidateResult } from './run-candidate';

export interface EndpointMeasurementRunner {
  evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult>;
}

/**
 * Owns one temporary endpoint-checkout transaction. It cannot start or advance
 * a native bisect and always restores the checkout it observed on entry.
 */
export class EndpointValidator {
  constructor(
    private readonly checkout: ExactCheckout,
    private readonly measurements: EndpointMeasurementRunner,
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
