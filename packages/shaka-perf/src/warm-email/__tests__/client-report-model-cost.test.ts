/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  BENCHMARK_LINES,
  BENCHMARK_SCALE_POLICIES,
  FCP_HERO_METRIC,
  MATERIALITY_FLOOR_USD_PER_MONTH,
  RECOVERY_BANDS,
  benchmarkScaleGeometry,
  benchmarkMultiple,
  benchmarkZone,
  computeRecoveryRange,
  dimSeverityRank,
  heroMetricCountedZeroLine,
  heroMetricGapSubLines,
} from '../client-report-model/cost';
import { summarizeA11yRuleFamilies, type A11yRuleFamilyViolation, type A11yStrongPageGroup } from '../client-report-model/a11y';
import { scoreBadgeStatus } from '../client-report-model/perf';

describe('benchmarkMultiple', () => {
  it.each([
    [10_300, 2500, '4.1x'],
    [12_500, 2500, '5x'],
    [12_499, 2500, '4.9x'],
    [12_499.999, 2500, '4.9x'],
    [0.3, 0.1, '3x'],
    [0.29, 0.1, '2.9x'],
    [1.09, 0.1, '10.9x'],
    [3421.7, 1800, '1.9x'],
    [3560, 1800, '1.9x'],
  ])('floors %s / %s to %s', (measured, good, expected) => {
    expect(benchmarkMultiple(measured, good)).toBe(expected);
  });

  it.each([
    [2400, 2500],
    [2500, 2500],
    [Number.NaN, 2500],
    [2501, Number.POSITIVE_INFINITY],
    [0, 2500],
    [2501, 0],
  ])('returns undefined for invalid or under-line inputs', (measured, good) => {
    expect(benchmarkMultiple(measured, good)).toBeUndefined();
  });
});

describe('benchmarkZone', () => {
  const line = BENCHMARK_LINES.lcpMs;

  it.each([
    [2400, 'good'],
    [2500, 'good'],
    [2501, 'mid'],
    [3999, 'mid'],
    [4000, 'mid'],
    [4001, 'poor'],
    [10_300, 'poor'],
  ] as const)('classifies %s as %s', (measured, expected) => {
    expect(benchmarkZone(measured, line)).toBe(expected);
  });

  it('keeps published decimal boundaries in the middle zone', () => {
    expect(benchmarkZone(0.25, BENCHMARK_LINES.cls)).toBe('mid');
    expect(benchmarkZone(0.26, BENCHMARK_LINES.cls)).toBe('poor');
  });
});

describe('benchmarkScaleGeometry', () => {
  it('uses the data-driven axis and zone widths that sum to 100%', () => {
    const geometry = benchmarkScaleGeometry(3421.7, BENCHMARK_LINES.fcpMs, BENCHMARK_SCALE_POLICIES.fcpMs);

    expect(geometry).toMatchObject({ axisMaxDisplay: 4.5, goodLinePercent: 40 });
    expect(geometry?.zones.amber).toBeCloseTo(26.666666666666668);
    expect(geometry?.zones.red).toBeCloseTo(33.333333333333336);
    expect(Object.values(geometry?.zones ?? {}).reduce((sum, width) => sum + width, 0)).toBeCloseTo(100);
    expect(geometry?.markerPercent).toBeCloseTo(76.03777777777778);
  });

  it('keeps the minimum four-second axis for a three-second first-content result', () => {
    expect(benchmarkScaleGeometry(3030, BENCHMARK_LINES.fcpMs, BENCHMARK_SCALE_POLICIES.fcpMs)?.axisMaxDisplay).toBe(4);
  });

  it('rejects thresholds that do not fit within the calculated axis', () => {
    expect(benchmarkScaleGeometry(3030, { good: 1800, poor: 4500 }, BENCHMARK_SCALE_POLICIES.fcpMs)).toBeUndefined();
  });

  it('uses each performance metric policy for a visible, native-unit scale', () => {
    const lcp = benchmarkScaleGeometry(24_700, BENCHMARK_LINES.lcpMs, BENCHMARK_SCALE_POLICIES.lcpMs);
    const tbt = benchmarkScaleGeometry(738, BENCHMARK_LINES.tbtMs, BENCHMARK_SCALE_POLICIES.tbtMs);
    const cls = benchmarkScaleGeometry(0.32, BENCHMARK_LINES.cls, BENCHMARK_SCALE_POLICIES.cls);

    expect(lcp).toMatchObject({ axisMaxDisplay: 31 });
    expect(lcp?.goodLinePercent).toBeCloseTo(8.064516129032258);
    expect(lcp?.markerPercent).toBeCloseTo(79.6774193548387);

    expect(tbt).toMatchObject({ axisMaxDisplay: 1 });
    expect(tbt?.goodLinePercent).toBe(20);
    expect(tbt?.poorLinePercent).toBe(60);
    expect(tbt?.markerPercent).toBeCloseTo(73.8);

    expect(cls).toMatchObject({ axisMaxDisplay: 0.4 });
    expect(cls?.goodLinePercent).toBe(25);
    expect(cls?.poorLinePercent).toBe(62.5);
    expect(cls?.markerPercent).toBe(80);
  });
});

describe('hero metric panel helpers', () => {
  const pages = [
    { name: 'Homepage', lcpMs: 8900, fcpMs: 3030, downloadsBeforeLcpKb: 900, downloadsKb: 1100 },
    { name: 'Platform', lcpMs: 1200, fcpMs: 3421.7 },
    { name: 'Audience landing', lcpMs: 7000, fcpMs: 2000 },
    { name: 'Pricing', lcpMs: 6800, fcpMs: 2200 },
    { name: 'About', lcpMs: 6400, fcpMs: 1700 },
    { name: 'Contact', lcpMs: 6100, fcpMs: 1400 },
    { name: 'Careers', lcpMs: 5900, fcpMs: 1300 },
  ];

  it('floors hero multiples from raw measurements and keeps main-content bytes as an explicit exception', () => {
    expect(heroMetricGapSubLines(pages, pages[0], FCP_HERO_METRIC)).toEqual([
      'slowest page: Platform, 3.4s - 1.9x the line',
      'next slowest: Homepage, 3.0s - 1.6x the line',
      'site average: 2.2s - 1.1x the line',
      'the phone pulls 0.9 MB before the main content shows, 1.1 MB in total',
    ]);
  });

  it('keeps near-line pages on the FCP good line instead of LCP', () => {
    expect(heroMetricCountedZeroLine(pages, FCP_HERO_METRIC)).toBe(
      'Counted as zero above: About (1.7s) sits close to the line. It is included in the site average, but not counted as a slow page above.',
    );
  });
});

describe('accessibility finding families', () => {
  const scans = [
    ['target-size', 'image-alt'],
    ['target-size', 'image-alt'],
    ['target-size', 'link-name'],
    ['target-size', 'list'],
    ['target-size', 'nested-interactive'],
    ['target-size'],
    ['target-size'],
  ].map((ruleIds) => ({
    violations: ruleIds.map((ruleId) => ({ ruleId, impact: 'serious' })),
  }));

  it('reconciles every counted family to the high-impact headline', () => {
    const summary = summarizeA11yRuleFamilies(scans);

    expect(summary.headlineCount).toBe(12);
    expect(summary.countedFamilies).toEqual([
      { id: 'target-size', label: 'touch targets too small to tap reliably', defectCount: 7, pageCount: 7 },
      { id: 'image-alt', label: 'images with no text description', defectCount: 2, pageCount: 2 },
      { id: 'unlabeled-controls', label: 'unlabeled controls', defectCount: 1, pageCount: 1 },
      { id: 'list', label: 'broken list markup', defectCount: 1, pageCount: 1 },
      { id: 'nested-interactive', label: 'controls nested inside controls', defectCount: 1, pageCount: 1 },
    ]);
    expect(summary.sharedDefects).toEqual([]);
    expect(summary.countedFamilies.reduce((total, family) => total + family.defectCount, 0)).toBe(summary.headlineCount);
  });

  it('counts distinct same-page rule-selector defects within visible families', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [
        { ruleId: 'image-alt', impact: 'serious', nodes: [{ target: ['img.logo'] }] },
        { ruleId: 'svg-img-alt', impact: 'serious', nodes: [{ target: ['svg.logo'] }] },
        { ruleId: 'button-name', impact: 'serious', nodes: [{ target: ['button.menu'] }] },
        { ruleId: 'link-name', impact: 'serious', nodes: [{ target: ['a.menu-link'] }] },
      ],
    }]);

    expect(summary.headlineCount).toBe(4);
    expect(summary.countedFamilies).toEqual([
      { id: 'image-alt', label: 'images with no text description', defectCount: 2, pageCount: 1 },
      { id: 'unlabeled-controls', label: 'unlabeled controls', defectCount: 2, pageCount: 1 },
    ]);
  });

  it('does not report a family as both counted and not counted on one page', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [
        { ruleId: 'html-has-lang', impact: 'serious' },
        { ruleId: 'region', impact: 'moderate' },
      ],
    }]);

    expect(summary).toMatchObject({
      headlineCount: 1,
      countedFamilies: [{ id: 'structure', label: 'page structure that is hard to navigate', pageCount: 1 }],
      notCountedExtras: [],
      smallerNotesCount: 0,
    });
  });

  it('does not report a counted family as a site-wide extra on another page', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [{ ruleId: 'html-has-lang', impact: 'serious' }] },
      { violations: [{ ruleId: 'region', impact: 'moderate' }] },
    ]);

    expect(summary).toMatchObject({
      headlineCount: 1,
      countedFamilies: [{ id: 'structure', label: 'page structure that is hard to navigate', pageCount: 1 }],
      notCountedExtras: [],
      smallerNotesCount: 0,
    });
  });

  it('groups unmatched rules into one plain-language fallback family', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [
        { ruleId: 'frame-title', impact: 'serious' },
        { ruleId: 'listitem', impact: 'serious' },
        { ruleId: 'meta-viewport', impact: 'serious' },
      ],
    }]);

    expect(summary.headlineCount).toBe(3);
    expect(summary.countedFamilies).toEqual([
      { id: 'other', label: 'other accessibility barrier', defectCount: 3, pageCount: 1 },
    ]);
  });

  const seriousViolation = (
    ruleId: string,
    target?: unknown,
  ): A11yRuleFamilyViolation => ({
    ruleId,
    impact: 'serious' as const,
    ...(target === undefined ? {} : { nodes: [{ target }] }),
  });

  it('counts a shared selector as one defect while retaining all page occurrences', () => {
    const summary = summarizeA11yRuleFamilies(Array.from({ length: 6 }, () => ({
      violations: [seriousViolation('target-size', ['.shared-scroll'])],
    })));

    expect(summary.headlineCount).toBe(1);
    expect(summary.countedFamilies).toEqual([
      { id: 'target-size', label: 'touch targets too small to tap reliably', defectCount: 1, pageCount: 6 },
    ]);
    expect(summary.sharedDefects).toEqual([
      { familyId: 'target-size', label: 'touch targets too small to tap reliably', pageCount: 6 },
    ]);
  });

  it('keeps a repeated selector set stable as more pages are audited', () => {
    const scanSet = (pageCount: number) => Array.from({ length: pageCount }, () => ({
      violations: [
        seriousViolation('target-size', ['.primary-nav .one']),
        seriousViolation('target-size', ['.primary-nav .two']),
        seriousViolation('target-size', ['.primary-nav .three']),
      ],
    }));

    const summaries = [1, 2, 6].map((pageCount) => summarizeA11yRuleFamilies(scanSet(pageCount)));

    expect(summaries.map((summary) => summary.headlineCount)).toEqual([3, 3, 3]);
    expect(summaries.map((summary) => summary.countedFamilies[0].defectCount)).toEqual([3, 3, 3]);
    expect(summaries.map((summary) => summary.countedFamilies[0].pageCount)).toEqual([1, 2, 6]);
  });

  it('counts each shared footer selector once instead of once per page', () => {
    const footerViolation: A11yRuleFamilyViolation = {
      ruleId: 'target-size',
      impact: 'serious',
      nodes: Array.from({ length: 40 }, (_, index) => ({ target: [`.footer-link-${index}`] })),
    };
    const summary = summarizeA11yRuleFamilies(Array.from({ length: 5 }, () => ({ violations: [footerViolation] })));

    expect(summary).toMatchObject({ headlineCount: 40 });
    expect(summary.countedFamilies).toEqual([
      { id: 'target-size', label: 'touch targets too small to tap reliably', defectCount: 40, pageCount: 5 },
    ]);
    expect(summary.sharedDefects).toHaveLength(40);
    expect(summary.sharedDefects.every((defect) => defect.pageCount === 5)).toBe(true);
  });

  it('counts the Vosyn selector shape as three distinct defects', () => {
    const sharedScroll = seriousViolation('scrollable-region-focusable', ['.vr-scroll']);
    const summary = summarizeA11yRuleFamilies([
      { violations: [sharedScroll, seriousViolation('color-contrast', ['.hero-copy'])] },
      { violations: [sharedScroll] },
      { violations: [sharedScroll] },
      { violations: [sharedScroll] },
      { violations: [sharedScroll] },
      { violations: [sharedScroll, seriousViolation('button-name', ['.newsletter-submit'])] },
    ]);

    expect(summary).toMatchObject({
      headlineCount: 3,
      countedFamilies: [
        { id: 'other', defectCount: 1, pageCount: 6 },
        { id: 'unlabeled-controls', defectCount: 1, pageCount: 1 },
        { id: 'contrast', defectCount: 1, pageCount: 1 },
      ],
      sharedDefects: [{ familyId: 'other', pageCount: 6 }],
    });
  });

  it('keeps different selector structures as distinct defects', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size', ['#a .b'])] },
      { violations: [seriousViolation('target-size', ['#a', '.b'])] },
    ]);

    expect(summary.headlineCount).toBe(2);
    expect(summary.sharedDefects).toEqual([]);
  });

  it('falls back to one occurrence per page when violations have no selectors', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size')] },
      { violations: [seriousViolation('target-size')] },
    ]);

    expect(summary).toMatchObject({ headlineCount: 2, sharedDefects: [] });
  });

  it('treats blank selector targets as unkeyed page occurrences', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size', [])] },
      { violations: [seriousViolation('target-size', ['   '])] },
    ]);

    expect(summary).toMatchObject({ headlineCount: 2, sharedDefects: [] });
  });

  it('treats malformed target values as unkeyed page occurrences', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size', [null])] },
      { violations: [seriousViolation('target-size', [42])] },
      { violations: [seriousViolation('target-size', [[null]])] },
      { violations: [seriousViolation('target-size', '.not-an-array')] },
    ]);

    expect(summary).toMatchObject({ headlineCount: 4, sharedDefects: [] });
  });

  it('treats a partially malformed target as unkeyed instead of merging it with a valid selector', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [seriousViolation('target-size', ['.valid-target', null])],
    }]);

    expect(summary).toMatchObject({
      headlineCount: 1,
      countedFamilies: [{ id: 'target-size', defectCount: 1, pageCount: 1 }],
      sharedDefects: [],
    });
  });

  it('counts unkeyed rules separately within one family on one page', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [seriousViolation('image-alt'), seriousViolation('svg-img-alt')],
    }]);

    expect(summary).toMatchObject({
      headlineCount: 2,
      countedFamilies: [{ id: 'image-alt', defectCount: 2, pageCount: 1 }],
    });
  });

  it('gives lower-impact families the same distinct-selector semantics', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [{
        ruleId: 'region',
        impact: 'moderate',
        nodes: [{ target: ['main'] }, { target: ['footer'] }],
      }],
    }]);

    expect(summary.notCountedExtras).toEqual([
      { id: 'structure', label: 'page structure that is hard to navigate', defectCount: 2, pageCount: 1 },
    ]);
  });

  it('counts hidden lower-impact notes by defects instead of page reach', () => {
    const scans = Array.from({ length: 8 }, (_, index) => ({
      violations: [
        {
          ruleId: 'button-name', impact: 'minor', nodes: [{ target: ['.shared-control'] }],
        },
        ...(index === 0 ? [{
          ruleId: 'color-contrast', impact: 'moderate', nodes: [
            { target: ['.contrast-one'] }, { target: ['.contrast-two'] }, { target: ['.contrast-three'] },
          ],
        }] : []),
        ...(index === 1 ? [{
          ruleId: 'region', impact: 'moderate', nodes: [{ target: ['main'] }, { target: ['footer'] }],
        }] : []),
      ],
    }));

    const summary = summarizeA11yRuleFamilies(scans);

    expect(summary.notCountedExtras.map((family) => family.id)).toEqual(['contrast', 'structure']);
    expect(summary.smallerNotesCount).toBe(1);
  });

  it('keeps a malformed node unkeyed when its violation also has a selector', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [{
        ruleId: 'target-size',
        impact: 'serious',
        nodes: [{ target: ['.valid-target'] }, { target: [null] }],
      }],
    }]);

    expect(summary).toMatchObject({ headlineCount: 2, sharedDefects: [] });
  });

  it('counts a shared selector plus a page-specific selector as two defects', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size', ['.shared']), seriousViolation('target-size', ['.only-a'])] },
      { violations: [seriousViolation('target-size', ['.shared'])] },
    ]);

    expect(summary).toMatchObject({ headlineCount: 2 });
    expect(summary.sharedDefects).toEqual([
      { familyId: 'target-size', label: 'touch targets too small to tap reliably', pageCount: 2 },
    ]);
  });

  it('does not combine matching selectors from separate rule families', () => {
    const summary = summarizeA11yRuleFamilies([
      { violations: [seriousViolation('target-size', ['.shared']), seriousViolation('image-alt', ['.shared'])] },
      { violations: [seriousViolation('target-size', ['.shared']), seriousViolation('image-alt', ['.shared'])] },
    ]);

    expect(summary).toMatchObject({ headlineCount: 2 });
    expect(summary.sharedDefects).toEqual([
      { familyId: 'target-size', label: 'touch targets too small to tap reliably', pageCount: 2 },
      { familyId: 'image-alt', label: 'images with no text description', pageCount: 2 },
    ]);
  });

  it('counts distinct selectors on one page as separate defects', () => {
    const summary = summarizeA11yRuleFamilies([{
      violations: [seriousViolation('target-size', ['.one']), seriousViolation('target-size', ['.two'])],
    }]);

    expect(summary).toMatchObject({ headlineCount: 2, sharedDefects: [] });
  });

  it('keeps type-only strong-page grouping and score badge policy ready for later waves', () => {
    const group: A11yStrongPageGroup = {
      label: 'Strong pages',
      pages: [{ name: 'Pricing', score: 97 }],
    };

    expect(group.pages).toHaveLength(1);
    expect(scoreBadgeStatus(87)).toBe('fair');
  });
});

describe('computeRecoveryRange', () => {
  it('computes exact inquiry and dollar ranges from owner inputs', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: 62,
      mobileShare: 0.52,
      band: RECOVERY_BANDS[0],
      valuePerInquiryUsd: 500,
    })).toEqual({
      mobileInquiries: 32.24,
      recoveredLo: 0.6448,
      recoveredHi: 1.612,
      usdMonthLo: 322.40000000000003,
      usdMonthHi: 806,
      usdYearLo: 3868.8,
      usdYearHi: 9672,
      breakEvenUsdYear: 6000,
      material: true,
    });
  });

  it('omits dollar fields and stays material until a value is entered', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: 62,
      mobileShare: 0.52,
      band: RECOVERY_BANDS[0],
    })).toEqual({
      mobileInquiries: 32.24,
      recoveredLo: 0.6448,
      recoveredHi: 1.612,
      material: true,
    });
  });

  it('treats zero mobile share as immaterial without needing a dollar value', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: 62,
      mobileShare: 0,
      band: RECOVERY_BANDS[0],
    })).toEqual({
      mobileInquiries: 0,
      recoveredLo: 0,
      recoveredHi: 0,
      material: false,
    });
  });

  it('marks dollar results below the monthly floor as immaterial', () => {
    const result = computeRecoveryRange({
      monthlyInquiries: 10,
      mobileShare: 0.5,
      band: RECOVERY_BANDS[0],
      valuePerInquiryUsd: 100,
    });

    expect(result?.usdMonthHi).toBe(25);
    expect(result?.usdMonthHi).toBeLessThan(MATERIALITY_FLOOR_USD_PER_MONTH);
    expect(result?.material).toBe(false);
  });

  it('rejects finite inputs whose derived dollar outputs overflow', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: Number.MAX_VALUE,
      mobileShare: 1,
      band: RECOVERY_BANDS[2],
      valuePerInquiryUsd: Number.MAX_VALUE,
    })).toBeUndefined();
  });

  it.each([
    { monthlyInquiries: 0, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: -1, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: Number.NaN, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: -0.01, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: 1.01, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: 0.5, band: { id: 'ceiling' as const, lo: 0.1, hi: 0.2 } },
    { monthlyInquiries: 10, mobileShare: 0.5, band: RECOVERY_BANDS[0], valuePerInquiryUsd: Number.NaN },
    { monthlyInquiries: 10, mobileShare: 0.5, band: RECOVERY_BANDS[0], valuePerInquiryUsd: -1 },
  ])('returns undefined for invalid inputs', (input) => {
    expect(computeRecoveryRange(input)).toBeUndefined();
  });
});

describe('dimSeverityRank', () => {
  it('orders poor, fair, could-not-measure, then good', () => {
    expect(dimSeverityRank('poor', false)).toBe(0);
    expect(dimSeverityRank('fair', false)).toBe(1);
    expect(dimSeverityRank('poor', true)).toBe(2);
    expect(dimSeverityRank('good', false)).toBe(3);
  });
});
