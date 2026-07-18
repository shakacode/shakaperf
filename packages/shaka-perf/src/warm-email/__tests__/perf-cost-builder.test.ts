/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildPerfCost,
  type BuildPerfCostInput,
  type PerfCostPage,
} from '../client-report-model/cost-performance';
import type { Problem } from '../client-report-model/perf';
import type { PagePerf } from '../synthesis';

function page(name: string, startingPath: string, metrics: Record<string, number>): PagePerf {
  return {
    id: name.toLowerCase(),
    name,
    startingPath,
    chips: [],
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([label, value]) => [label, { value, display: String(value) }]),
    ),
  };
}

function perfPage(pageValue: PagePerf, lead: Problem = { kind: 'late-paint', status: 'fair', severity: 0, headline: '', chip: '' }): PerfCostPage {
  return {
    page: pageValue,
    lead,
  };
}

function input(overrides: Partial<BuildPerfCostInput> = {}): BuildPerfCostInput {
  const measured = [
    perfPage(page('Home', '/', {
      LCP: 4200, FCP: 3030, CLS: 2, TBT: 80, js: 900, downloads: 1100, 'downloads-before-LCP': 900,
    })),
    perfPage(page('Platform', '/platform', {
      LCP: 3200, FCP: 3421.7, CLS: 2, TBT: 80, js: 700, downloads: 2200, 'downloads-before-LCP': 1200,
    })),
    perfPage(page('About', '/about', {
      LCP: 2200, FCP: 1700, CLS: 1, TBT: 50, js: 300, downloads: 900, 'downloads-before-LCP': 500,
    })),
  ];
  return {
    hasPerf: true,
    perfCouldNotMeasure: false,
    perfStatus: 'fair',
    measured,
    rankedCarded: measured,
    siteUrl: 'https://example.com',
    throttleProfile: 'Slow-4G',
    promptCtx: {
      host: 'example.com',
      date: 'July 10, 2026',
      viewportLabel: 'phone',
      throttleProfile: 'Slow-4G',
    },
    pageUrl: (pageValue: PagePerf) => `https://example.com${pageValue.startingPath}`,
    copyPromptForPage: () => undefined,
    sameAsPsiDefaultProfile: (profile: string | undefined) => profile === 'Slow-4G',
    ...overrides,
  };
}

describe('buildPerfCost', () => {
  it('builds the FCP cost block from hand-built page facts with reproducible displayed multiples', () => {
    const result = buildPerfCost(input());

    expect(result.perfCost).toMatchObject({
      state: 'measured',
      headline: 'nothing for the first 3.0s',
      gap: {
        measuredLabel: '3.0s',
        goodLabel: '1.8s',
        multipleLabel: '1.6x',
        lineOwner: "Google's Lighthouse benchmark - first contentful paint",
      },
      scale: { axisMaxSeconds: 4, markerPercent: 75 },
      calculator: { inquiryNoun: 'inquiry' },
    });
    expect(result.perfCost?.gapSubLines).toEqual([
      'slowest page: Platform, 3.4s - 1.8x the line',
      'next slowest: Home, 3.0s - 1.6x the line',
      'site average: 2.7s - 1.5x the line',
      'the phone pulls 0.9 MB before the main content shows, 1.1 MB in total',
    ]);
  });

  it('omits optional handoff text when no complete prompt facts are available', () => {
    const incomplete = perfPage(page('Home', '/', { LCP: 2200, FCP: 3030, downloads: 1100 }));
    const result = buildPerfCost(input({ measured: [incomplete], rankedCarded: [incomplete] }));

    expect(result.perfCost?.sitePrompts).toBeUndefined();
    expect(result.perfCost?.gapSubLines).toEqual(['slowest page: Home, 3.0s - 1.6x the line']);
  });

  it('returns the honest zero state for good performance', () => {
    const good = perfPage(page('Home', '/', { LCP: 2400, FCP: 1700, CLS: 1, TBT: 50 }));
    const result = buildPerfCost(input({ perfStatus: 'good', measured: [good], rankedCarded: [good] }));

    expect(result.perfCost).toEqual({ tab: 'perf', state: 'zero' });
  });

  it('does not manufacture a cost block when performance could not be measured', () => {
    const result = buildPerfCost(input({ perfCouldNotMeasure: true, measured: [], rankedCarded: [] }));

    expect(result.perfCost).toBeUndefined();
  });

  it.each([
    {
      kind: 'slow-lcp' as const,
      metrics: { LCP: 24_700, FCP: 900, CLS: 2, TBT: 50 },
      scale: { axisMaxSeconds: 31, goodLinePercent: 8.064516129032258, markerPercent: 79.6774193548387 },
    },
    {
      kind: 'layout-shift' as const,
      metrics: { LCP: 1800, FCP: 900, CLS: 32, TBT: 50 },
      scale: { axisMaxSeconds: 0.4, goodLinePercent: 25, markerPercent: 80 },
    },
    {
      kind: 'sluggish' as const,
      metrics: { LCP: 1800, FCP: 900, CLS: 2, TBT: 738 },
      scale: { axisMaxSeconds: 1, goodLinePercent: 20, markerPercent: 73.8 },
    },
  ])('adds a scale for a $kind branch-3 problem', ({ kind, metrics, scale }) => {
    const measured = perfPage(
      page('Home', '/', metrics),
      { kind, status: 'poor', severity: 1, headline: '', chip: kind },
    );
    const result = buildPerfCost(input({ perfStatus: 'poor', measured: [measured], rankedCarded: [measured] }));

    expect(result.perfCost?.scale).toMatchObject(scale);
  });

  it('keeps an FCP fallback in branch 3 free of a new scale', () => {
    const lcp = perfPage(
      page('Home', '/', { LCP: 12_000, FCP: 900, CLS: 2, TBT: 50 }),
      { kind: 'slow-lcp', status: 'poor', severity: 1, headline: '', chip: 'slow-lcp' },
    );
    const fcp = perfPage(
      page('Platform', '/platform', { LCP: 1800, FCP: 3030, CLS: 2, TBT: 50 }),
      { kind: 'late-paint', status: 'fair', severity: 0.4, headline: '', chip: 'late-paint' },
    );

    const result = buildPerfCost(input({ perfStatus: 'poor', measured: [lcp, fcp], rankedCarded: [fcp] }));

    expect(result.perfCost?.gap?.metricLabel).toBe('First content');
    expect(result.perfCost?.scale).toBeUndefined();
  });
});
