/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipDescriptor } from '../../../pipeline/report';
import type { AuditMetric, AuditMetricGroup, AuditMetricLevel } from './stage';

interface PhaseSpec {
  group: AuditMetricGroup;
  // Lighthouse score (and a few others) get higher = better. Default is
  // higher = worse, so we only mark exceptions.
  higherIsBetter?: boolean;
  // Threshold values are in the metric's own unit (ms for timings,
  // /100 for CLS, /100 for LH score). When not provided, the metric
  // is shown without a colored level.
  thresholds?: { good: number; bad: number };
}

const PHASE_SPECS: Record<string, PhaseSpec> = {
  // Lighthouse / Web Vitals — thresholds taken from Google's official
  // Web Vitals docs (good <= bad < poor).
  FCP: { group: 'vitals', thresholds: { good: 1800, bad: 3000 } },
  LCP: { group: 'vitals', thresholds: { good: 2500, bad: 4000 } },
  TBT: { group: 'vitals', thresholds: { good: 200, bad: 600 } },
  TTFB: { group: 'vitals', thresholds: { good: 800, bad: 1800 } },
  'speed-index': { group: 'vitals', thresholds: { good: 3400, bad: 5800 } },
  // CLS arrives multiplied by 100 (see run-lighthouse.ts), so the
  // 0.1 / 0.25 thresholds become 10 / 25.
  CLS: { group: 'vitals', thresholds: { good: 10, bad: 25 } },
  'LH Score': { group: 'vitals', higherIsBetter: true, thresholds: { good: 90, bad: 50 } },
  // INP per Google Web Vitals: good ≤ 200ms, poor > 500ms.
  'interaction-to-next-paint': { group: 'vitals', thresholds: { good: 200, bad: 500 } },
  // Resource weight in KB fetched before LCP. Vitals because it directly drives
  // LCP and TBT.
  'downloads-before-LCP': { group: 'vitals' },

  // Diagnostics — no objective thresholds, so they get the group
  // assignment but no level coloring.
  // Total page weight in KB — informational rather than a vital: cohort
  // norms vary wildly by app type, so a single threshold would be noisy.
  downloads: { group: 'diagnostics' },
  'downloads-count': { group: 'diagnostics' },
  js: { group: 'diagnostics' },
  'js-count': { group: 'diagnostics' },
  images: { group: 'diagnostics' },
  'images-count': { group: 'diagnostics' },
  fonts: { group: 'diagnostics' },
  'fonts-count': { group: 'diagnostics' },
  'downloads-count-before-LCP': { group: 'diagnostics' },
};

export function classifyMetric(label: string): {
  group: AuditMetricGroup;
  higherIsBetter: boolean;
} {
  const spec = PHASE_SPECS[label];
  return {
    group: spec?.group ?? 'diagnostics',
    higherIsBetter: spec?.higherIsBetter ?? false,
  };
}

export function levelForMetric(label: string, value: number): AuditMetricLevel | undefined {
  const spec = PHASE_SPECS[label];
  if (!spec?.thresholds) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const { good, bad } = spec.thresholds;
  if (spec.higherIsBetter) {
    if (value >= good) return 'good';
    if (value >= bad) return 'average';
    return 'bad';
  }
  if (value <= good) return 'good';
  if (value <= bad) return 'average';
  return 'bad';
}

// Source of truth for the level → palette mapping. Both the metric
// table cells and the worst-metric chips read from here so they stay
// visually consistent. The CSS-variable name lets the report shell
// keep its existing tokens for green/orange/red without us touching
// the global stylesheet — the audit components inline `color: var(...)`
// from this map.
export const METRIC_LEVEL_CSS_VAR: Record<AuditMetricLevel, string> = {
  good: 'var(--improvement)',
  average: 'var(--visual_change)',
  bad: 'var(--regression)',
};

export const METRIC_LEVEL_CHIP_COLOR: Record<AuditMetricLevel, ChipDescriptor['color']> = {
  good: 'green',
  average: 'yellow',
  bad: 'red',
};

// Aggregate "how bad is this run" score over the vitals + LH metrics.
// Each contributing metric is normalized to its own "good" threshold so
// a 200ms TBT contributes the same as a 1800ms FCP — both saturate the
// "good" threshold. LH Score is inverted (100 - score, scaled by /90) so
// higher = worse like everything else. Diagnostics aren't included since
// they have no thresholds.
//
// The result is monotonic in metric badness: a regression on any
// metric strictly increases the score. Used as the chip sortingWeight
// (negated, so worse tests sort first).
export function combinedBadness(metrics: readonly AuditMetric[]): number {
  let total = 0;
  for (const metric of metrics) {
    if (!Number.isFinite(metric.value)) continue;
    const spec = PHASE_SPECS[metric.label];
    if (spec?.group !== 'vitals' || !spec.thresholds) continue;
    if (spec.higherIsBetter) {
      // LH Score is 0–100; "good" boundary acts as the normalizer but
      // the inversion point is the 100 ceiling so a perfect score is 0.
      total += Math.max(0, 100 - metric.value) / spec.thresholds.good;
    } else {
      total += metric.value / spec.thresholds.good;
    }
  }
  return total;
}

// Worst level seen among any metric. 'bad' > 'average' > 'good'; ties
// fall back to the first higher-rank value found.
export function worstLevel(metrics: readonly AuditMetric[]): AuditMetricLevel | undefined {
  let worst: AuditMetricLevel | undefined;
  for (const metric of metrics) {
    if (metric.level === 'bad') return 'bad';
    if (metric.level === 'average') worst = 'average';
    else if (metric.level === 'good' && worst === undefined) worst = 'good';
  }
  return worst;
}
