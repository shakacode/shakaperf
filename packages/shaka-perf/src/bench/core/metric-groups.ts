/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Resource breakdown metrics that belong in the "Diagnostics" group.
// Order determines display order in the summary.
const DIAGNOSTICS_METRICS = [
  'downloads',
  'downloads-count',
  'downloads-before-LCP',
  'downloads-count-before-LCP',
  'js',
  'js-count',
  'images',
  'images-count',
  'fonts',
  'fonts-count',
];

const DIAGNOSTICS_SET = new Set(DIAGNOSTICS_METRICS);

export function isDiagnosticMetric(phaseName: string): boolean {
  return DIAGNOSTICS_SET.has(phaseName);
}

export function diagnosticSortOrder(phaseName: string): number {
  const idx = DIAGNOSTICS_METRICS.indexOf(phaseName);
  return idx === -1 ? DIAGNOSTICS_METRICS.length : idx;
}
