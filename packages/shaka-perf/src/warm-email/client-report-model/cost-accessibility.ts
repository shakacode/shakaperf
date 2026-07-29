/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import { BENCHMARK_LINES, benchmarkMultiple, type CostGap } from './cost-benchmarks';

export interface A11yFindingScan {
  violations: readonly {
    ruleId: string;
    failureSummary?: string;
    nodes?: readonly { failureSummary?: string }[];
  }[];
}

function countFindingPages(scans: readonly A11yFindingScan[], matches: (ruleId: string) => boolean): number {
  return scans.filter((scan) => scan.violations.some((violation) => matches(violation.ruleId))).length;
}

const a11yPageCount = (count: number): string => `${count} ${count === 1 ? 'page' : 'pages'}`;

export function a11yFixText(scans: readonly A11yFindingScan[]): string | undefined {
  const findings = [
    [
      countFindingPages(scans, (ruleId) => ruleId === 'color-contrast'),
      (count: number) => `contrast below the 4.5:1 WCAG line on ${a11yPageCount(count)}`,
    ],
    [
      countFindingPages(scans, (ruleId) => /^(button-name|link-name|label|select-name|aria-input-field-name)$/.test(ruleId)),
      (count: number) => `unlabeled controls on ${a11yPageCount(count)}`,
    ],
    [
      countFindingPages(scans, (ruleId) => /^aria-/.test(ruleId) && ruleId !== 'aria-input-field-name'),
      (count: number) => `controls with accessibility markup screen readers cannot use on ${a11yPageCount(count)}`,
    ],
    [
      countFindingPages(scans, (ruleId) => /^(region|landmark)/.test(ruleId)),
      (count: number) => `unlabeled page sections on ${a11yPageCount(count)}`,
    ],
    [
      countFindingPages(scans, (ruleId) => /^(page-has-heading-one|empty-heading|heading)/.test(ruleId)),
      (count: number) => `heading structure that is harder to navigate on ${a11yPageCount(count)}`,
    ],
    [
      countFindingPages(scans, (ruleId) => /^(image-alt|svg-img-alt|input-image-alt)/.test(ruleId)),
      (count: number) => `images without text descriptions on ${a11yPageCount(count)}`,
    ],
  ] as const;
  const concrete = findings
    .filter(([count]) => count > 0)
    .slice(0, 2)
    .map(([count, label]) => label(count));
  return concrete.length ? `Fix the concrete findings we measured: ${concrete.join('; ')}.` : undefined;
}

export function worstContrastRatio(scans: readonly A11yFindingScan[]): number | undefined {
  const ratios: number[] = [];
  for (const scan of scans) {
    for (const violation of scan.violations) {
      if (violation.ruleId !== 'color-contrast') continue;
      const summaries = [
        violation.failureSummary,
        ...(violation.nodes ?? []).map((node) => node.failureSummary),
      ].filter((summary): summary is string => !!summary);
      for (const summary of summaries) {
        const matches = [
          ...summary.matchAll(/contrast(?: ratio)?\s*(?:of|:)\s*(\d+(?:\.\d+)?)(?:\s*:\s*1)?/gi),
          ...summary.matchAll(/\b(\d+(?:\.\d+)?)\s*:\s*1\b/g),
        ];
        for (const match of matches) {
          const value = Number(match[1]);
          if (Number.isFinite(value) && value > 0 && value < BENCHMARK_LINES.contrast) ratios.push(value);
        }
      }
    }
  }
  return ratios.length ? Math.min(...ratios) : undefined;
}

export function a11yContrastGap(ratio: number | undefined): CostGap | undefined {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return undefined;
  const multiple = benchmarkMultiple(BENCHMARK_LINES.contrast, ratio);
  return {
    metricLabel: 'Text contrast',
    measuredLabel: `${ratio.toFixed(2)}:1`,
    goodLabel: '4.50:1',
    poorLabel: 'below 4.50:1',
    ...(multiple ? { multipleLabel: `${multiple} below the line` } : {}),
    zone: ratio >= BENCHMARK_LINES.contrast ? 'good' : 'poor',
    lineOwner: 'WCAG AA',
    lineUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
  };
}
