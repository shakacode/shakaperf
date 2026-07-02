/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PerfLowNoiseResult, PerfResult } from '../perf';

type PerfMeasurement = PerfResult | PerfLowNoiseResult;

export function hasRegressedPerfMetric(measurement: PerfMeasurement): boolean {
  return (measurement.regressedMetrics?.length ?? 0) > 0;
}

export function hasImprovedPerfMetric(measurement: PerfMeasurement): boolean {
  return (measurement.improvedMetrics?.length ?? 0) > 0;
}

export function perfViewportCount(measurement: PerfMeasurement | null | undefined): number {
  return measurement ? 1 : 0;
}
