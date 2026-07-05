/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type PracticalDirection = "none" | "regression" | "improvement";

// Metrics where a bigger value is a better result (e.g. Lighthouse score).
// Everything else (ms timings, CLS, bytes, counts) treats bigger = worse.
const HIGHER_IS_BETTER = new Set(["lh score", "lighthouse score"]);
const CLS_PHASE_NAME = "cls";
const CLS_GOOD_THRESHOLD = 10;
const CLS_POOR_THRESHOLD = 25;
const CLS_REGRESSION_DELTA_THRESHOLD = 5;

export interface ClassifyPracticalDeltaOptions {
  phaseName: string;
  directionDeltaValue: number;
  thresholdDeltaValue: number;
  unit: string;
  isSignificant: boolean;
  controlValue: number;
  experimentValue: number;
  regressionThreshold: number;
}

export function classifyDisplayDirection(
  phaseName: string,
  displayDeltaValue: number,
  isSignificant: boolean,
): PracticalDirection {
  if (!isSignificant || displayDeltaValue === 0) return "none";
  const higherBetter = HIGHER_IS_BETTER.has(phaseName.toLowerCase());
  if (higherBetter) return displayDeltaValue > 0 ? "improvement" : "regression";
  return displayDeltaValue > 0 ? "regression" : "improvement";
}

export function classifyPracticalDelta(
  opts: ClassifyPracticalDeltaOptions,
): PracticalDirection {
  const direction = classifyDisplayDirection(
    opts.phaseName,
    opts.directionDeltaValue,
    opts.isSignificant,
  );
  if (direction === "none") return direction;

  if (isClsMetric(opts.phaseName, opts.unit)) {
    return Math.abs(opts.thresholdDeltaValue) > CLS_REGRESSION_DELTA_THRESHOLD
      || crossesClsQualityThreshold(opts.controlValue, opts.experimentValue)
      ? direction
      : "none";
  }

  return Math.abs(opts.thresholdDeltaValue) > practicalRegressionThreshold(
    opts.unit,
    opts.regressionThreshold,
  )
    ? direction
    : "none";
}

export function isClsMetric(phaseName: string, unit: string): boolean {
  return unit === "/100" && phaseName.toLowerCase() === CLS_PHASE_NAME;
}

export function crossesClsQualityThreshold(
  controlValue: number,
  experimentValue: number,
): boolean {
  return [CLS_GOOD_THRESHOLD, CLS_POOR_THRESHOLD].some(
    (threshold) => (
      controlValue <= threshold && experimentValue > threshold
    ) || (
      controlValue > threshold && experimentValue <= threshold
    ),
  );
}

export function practicalRegressionThreshold(
  unit: string,
  timingRegressionThreshold: number,
): number {
  if (unit === "ms") return timingRegressionThreshold;
  if (unit === "KB") return 1;
  if (unit === "/100") return 1;
  return 0.5;
}
