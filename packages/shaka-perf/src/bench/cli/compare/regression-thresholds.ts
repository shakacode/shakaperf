/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type PracticalDirection = "none" | "regression" | "improvement";
export type MetricSign = -1 | 1;

// Legacy report.json files did not carry `sign`. Use the name fallback only
// when no explicit metric sign is available.
const HIGHER_IS_BETTER = new Set(["lh score", "lighthouse score"]);

export function classifyDisplayDirection(
  phaseName: string,
  displayDeltaValue: number,
  isSignificant: boolean,
  sign?: MetricSign,
): PracticalDirection {
  if (!isSignificant || displayDeltaValue === 0) return "none";
  if (sign) {
    const internalDeltaValue = displayDeltaValue * -1;
    return internalDeltaValue * sign < 0 ? "regression" : "improvement";
  }

  const higherBetter = HIGHER_IS_BETTER.has(phaseName.toLowerCase());
  if (higherBetter) return displayDeltaValue > 0 ? "improvement" : "regression";
  return displayDeltaValue > 0 ? "regression" : "improvement";
}
