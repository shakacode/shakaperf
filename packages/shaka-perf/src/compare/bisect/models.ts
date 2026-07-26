/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome, TestResult } from '../../pipeline/report';
import type { BisectTarget } from './types';

type SuccessfulOutcome = ReportOutcome & { kind: 'ok'; measurement: unknown };

export class StageMeasurementModel<T> {
  constructor(
    readonly test: TestResult,
    readonly viewport: string,
    readonly measurement: T,
  ) {}

  matchesTarget(target: BisectTarget): boolean {
    return this.test.filePath === target.testFile
      && this.test.name === target.testName
      && this.viewport === target.viewport;
  }
}

class TestOutcomeModel {
  constructor(private readonly outcome: TestResult['outcomes'][number]) {}

  successfulMeasurementForStage<T>(
    stage: string,
    hasExpectedMeasurementShape: (measurement: unknown) => measurement is T,
  ): T | undefined {
    const successfulOutcome = this.successfulOutcomeForStage(stage);
    if (!successfulOutcome) return undefined;
    return hasExpectedMeasurementShape(successfulOutcome.measurement)
      ? successfulOutcome.measurement
      : undefined;
  }

  private successfulOutcomeForStage(stage: string): SuccessfulOutcome | undefined {
    return this.outcome.kind === 'ok' && this.outcome.stage === stage
      ? this.outcome as SuccessfulOutcome
      : undefined;
  }
}

export class TestResultsModel {
  constructor(private readonly testResults: readonly TestResult[]) {}

  successfulMeasurementsForStage<T>(
    stage: string,
    hasExpectedMeasurementShape: (measurement: unknown) => measurement is T,
  ): StageMeasurementModel<T>[] {
    return this.testResults.flatMap((test) => test.outcomes.flatMap((outcome) => {
      const measurement = new TestOutcomeModel(outcome)
        .successfulMeasurementForStage(stage, hasExpectedMeasurementShape);
      return measurement === undefined
        ? []
        : [new StageMeasurementModel(test, outcome.viewport.label, measurement)];
    }));
  }
}
