/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome, TestResult } from '../../pipeline/report';
import type { BisectTarget, TargetObservation } from './types';

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

export class BisectTargetModel {
  private constructor(
    private target: BisectTarget,
    private readonly orderedCommits: readonly string[],
  ) {}

  static from(target: BisectTarget, orderedCommits: readonly string[]): BisectTargetModel {
    return new BisectTargetModel(target, orderedCommits);
  }

  isActive(): boolean {
    return this.target.status === 'active';
  }

  hasValidSearchRange(): boolean {
    return this.target.goodIndex < this.target.badIndex;
  }

  middleCommitIndex(): number {
    return Math.floor((this.target.goodIndex + this.target.badIndex) / 2);
  }

  needsObservationAt(commitSha: string, commitIndex: number): boolean {
    return this.isActive()
      && this.searchRangeContains(commitIndex)
      && !this.hasObservationAt(commitSha);
  }

  recalculateSearchRangeFromCachedObservations(
    commitIndexes: ReadonlyMap<string, number>,
  ): BisectTargetModel {
    if (!this.isActive()) return this;

    let goodIndex = this.target.goodIndex;
    let badIndex = this.target.badIndex;
    for (const observation of Object.values(this.target.observations)) {
      const commitIndex = commitIndexes.get(observation.commitSha);
      if (!this.cachedObservationCanNarrowSearchRange(commitIndex)) continue;

      if (observation.present) badIndex = Math.min(badIndex, commitIndex);
      else goodIndex = Math.max(goodIndex, commitIndex);
    }

    this.target = { ...this.target, goodIndex, badIndex };
    return this.markFirstBadCommitWhenLocated();
  }

  recordObservationAndUpdateSearchBoundary(
    observation: TargetObservation,
    commitIndex: number,
  ): BisectTargetModel {
    if (!this.isActive()) return this;

    this.target = {
      ...this.target,
      observations: {
        ...this.target.observations,
        [observation.commitSha]: observation,
      },
      ...(observation.present ? { badIndex: commitIndex } : { goodIndex: commitIndex }),
    };
    return this.markFirstBadCommitWhenLocated();
  }

  toTarget(): BisectTarget {
    return this.target;
  }

  private searchRangeContains(commitIndex: number): boolean {
    return this.target.goodIndex <= commitIndex && commitIndex <= this.target.badIndex;
  }

  private hasObservationAt(commitSha: string): boolean {
    return this.target.observations[commitSha] !== undefined;
  }

  private cachedObservationCanNarrowSearchRange(
    commitIndex: number | undefined,
  ): commitIndex is number {
    return commitIndex !== undefined && this.searchRangeContains(commitIndex);
  }

  private markFirstBadCommitWhenLocated(): BisectTargetModel {
    if (this.target.badIndex - this.target.goodIndex !== 1) return this;

    this.target = {
      ...this.target,
      status: 'found',
      firstBadSha: this.orderedCommits[this.target.badIndex],
    };
    return this;
  }
}
