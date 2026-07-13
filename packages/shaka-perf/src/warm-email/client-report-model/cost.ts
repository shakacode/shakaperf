/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportStatus } from '../client-report-renderer';
import type { PerfProblemKind, ScoreBadgePolicy } from './perf';

/**
 * Published performance and accessibility lines.
 * Sources: https://web.dev/articles/lcp, https://web.dev/articles/cls,
 * https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint,
 * https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time,
 * and https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html.
 */
export const BENCHMARK_LINES = {
  lcpMs: { good: 2500, poor: 4000 },
  // Published raw CLS units; audit consumers must normalize the stored /100 value.
  cls: { good: 0.10, poor: 0.25 },
  fcpMs: { good: 1800, poor: 3000 },
  tbtMs: { good: 200, poor: 600 },
  contrast: 4.5,
} as const;

export const MAX_MISSING_AI_TEXT_SHARE_FOR_ZERO = 0.10;

interface DecimalFraction {
  numerator: bigint;
  denominator: bigint;
}

function decimalFraction(value: number): DecimalFraction {
  const [mantissa, exponentLabel] = value.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const numerator = BigInt(`${integer}${fraction}`);
  const exponent = Number(exponentLabel ?? 0) - fraction.length;
  if (exponent >= 0) {
    return { numerator: numerator * (10n ** BigInt(exponent)), denominator: 1n };
  }
  return { numerator, denominator: 10n ** BigInt(-exponent) };
}

/**
 * Floors a multiple from raw operands. Use this when no formatted value is
 * printed alongside the result.
 */
export function benchmarkMultiple(measured: number, good: number): string | undefined {
  if (!Number.isFinite(measured) || !Number.isFinite(good) || measured <= 0 || good <= 0 || measured <= good) {
    return undefined;
  }

  const measuredFraction = decimalFraction(measured);
  const goodFraction = decimalFraction(good);
  const tenths = (
    measuredFraction.numerator
    * goodFraction.denominator
    * 10n
  ) / (
    measuredFraction.denominator
    * goodFraction.numerator
  );
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return decimal === 0n ? `${whole}x` : `${whole}.${decimal}x`;
}

/**
 * Floors a multiple from the one-decimal seconds a reader sees, never from
 * higher-precision milliseconds. This keeps every printed derivation
 * reproducible from its printed operands.
 */
export function benchmarkMultipleFromDisplayedSeconds(measuredMs: number, goodMs: number): string | undefined {
  if (!Number.isFinite(measuredMs) || !Number.isFinite(goodMs)) return undefined;
  const displayedMeasuredSeconds = Number((measuredMs / 1000).toFixed(1));
  const displayedGoodSeconds = Number((goodMs / 1000).toFixed(1));
  return benchmarkMultiple(displayedMeasuredSeconds, displayedGoodSeconds);
}

export type CostZone = 'good' | 'mid' | 'poor';

export function benchmarkZone(measured: number, line: { good: number; poor: number }): CostZone {
  if (measured <= line.good) return 'good';
  if (measured > line.poor) return 'poor';
  return 'mid';
}

export interface CostGap {
  metricLabel: string;
  measuredLabel: string;
  goodLabel: string;
  poorLabel: string;
  multipleLabel?: string;
  zone: CostZone;
  lineOwner: string;
  lineUrl: string;
}

export interface BenchmarkScaleGeometry {
  axisMaxMs: number;
  axisMaxSeconds: number;
  zones: {
    green: number;
    amber: number;
    red: number;
  };
  goodLinePercent: number;
  poorLinePercent: number;
  markerPercent: number;
}

/** Returns data-derived geometry for the C benchmark scale. */
export function benchmarkScaleGeometry(
  valueMs: number,
  line: { good: number; poor: number },
): BenchmarkScaleGeometry | undefined {
  if (
    !Number.isFinite(valueMs)
    || valueMs < 0
    || !Number.isFinite(line.good)
    || !Number.isFinite(line.poor)
    || line.good <= 0
    || line.poor <= line.good
  ) {
    return undefined;
  }

  const axisMaxMs = Math.max(4000, Math.ceil((valueMs * 1.25) / 500) * 500);
  if (line.poor > axisMaxMs) return undefined;
  const percent = (value: number): number => (value / axisMaxMs) * 100;
  const goodLinePercent = percent(line.good);
  const poorLinePercent = percent(line.poor);
  return {
    axisMaxMs,
    axisMaxSeconds: axisMaxMs / 1000,
    zones: {
      green: goodLinePercent,
      amber: poorLinePercent - goodLinePercent,
      red: 100 - poorLinePercent,
    },
    goodLinePercent,
    poorLinePercent,
    markerPercent: percent(valueMs),
  };
}

export interface CostStudy {
  text: string;
  publisher: string;
  date: string;
  url: string;
  method?: 'controlled test' | 'correlation';
}

export interface CostStakes {
  kind: 'at-risk' | 'no-material-loss';
  prose: string;
  studies?: readonly CostStudy[];
  expanderIntro?: string;
  expanderFooter?: string;
}

export interface CostFix {
  tone: 'primary' | 'secondary';
  text?: string;
}

export interface RecoveryBand {
  id: 'cautious' | 'middle' | 'ceiling';
  lo: number;
  hi: number;
}

/** Vodafone's 2021 controlled test caps the recovery estimate: https://web.dev/case-studies/vodafone */
export const RECOVERY_CAP = 0.15;

/** Recovery bands capped by Vodafone's 2021 result: https://web.dev/case-studies/vodafone */
export const RECOVERY_BANDS: readonly RecoveryBand[] = [
  { id: 'cautious', lo: 0.02, hi: 0.05 },
  { id: 'middle', lo: 0.05, hi: 0.10 },
  { id: 'ceiling', lo: 0.10, hi: RECOVERY_CAP },
];

/** Internal product-policy threshold with no external source. */
export const MATERIALITY_FLOOR_USD_PER_MONTH = 50;

export interface CostCalculatorConfig {
  mobileSharePrefill: number;
  bands: readonly RecoveryBand[];
  materialityFloorUsdPerMonth: number;
  inquiryNoun: string;
}

export interface RecoveryInputs {
  monthlyInquiries: number;
  valuePerInquiryUsd?: number;
  mobileShare: number;
  band: RecoveryBand;
}

export interface RecoveryRange {
  mobileInquiries: number;
  recoveredLo: number;
  recoveredHi: number;
  usdMonthLo?: number;
  usdMonthHi?: number;
  usdYearLo?: number;
  usdYearHi?: number;
  breakEvenUsdYear?: number;
  material: boolean;
}

export function computeRecoveryRange(i: RecoveryInputs): RecoveryRange | undefined {
  const { monthlyInquiries, valuePerInquiryUsd, mobileShare, band } = i;
  if (
    !Number.isFinite(monthlyInquiries)
    || monthlyInquiries <= 0
    || !Number.isFinite(mobileShare)
    || mobileShare < 0
    || mobileShare > 1
    || !Number.isFinite(band.lo)
    || !Number.isFinite(band.hi)
    || band.lo < 0
    || band.hi < band.lo
    || band.hi > RECOVERY_CAP
    || (valuePerInquiryUsd !== undefined && (!Number.isFinite(valuePerInquiryUsd) || valuePerInquiryUsd < 0))
  ) {
    return undefined;
  }

  const mobileInquiries = monthlyInquiries * mobileShare;
  const recoveredLo = mobileInquiries * band.lo;
  const recoveredHi = mobileInquiries * band.hi;
  if (![mobileInquiries, recoveredLo, recoveredHi].every(Number.isFinite)) return undefined;
  if (valuePerInquiryUsd === undefined) {
    return { mobileInquiries, recoveredLo, recoveredHi, material: recoveredHi > 0 };
  }

  const usdMonthLo = recoveredLo * valuePerInquiryUsd;
  const usdMonthHi = recoveredHi * valuePerInquiryUsd;
  const usdYearLo = usdMonthLo * 12;
  const usdYearHi = usdMonthHi * 12;
  const breakEvenUsdYear = valuePerInquiryUsd * 12;
  if (![usdMonthLo, usdMonthHi, usdYearLo, usdYearHi, breakEvenUsdYear].every(Number.isFinite)) return undefined;
  return {
    mobileInquiries,
    recoveredLo,
    recoveredHi,
    usdMonthLo,
    usdMonthHi,
    usdYearLo,
    usdYearHi,
    breakEvenUsdYear,
    material: usdMonthHi >= MATERIALITY_FLOOR_USD_PER_MONTH,
  };
}

export interface CostBlockExtras {
  gap?: CostGap;
  gapSubLines?: string[];
  bookingLine?: string;
  stakes?: CostStakes;
  fix?: CostFix;
  calculator?: CostCalculatorConfig;
  countedZeroLine?: string;
  // Filled only by later builder waves for the C renderer.
  sitePrompts?: CostSitePromptSlots;
  strongPageGroup?: StrongPageGroup;
  scoreBadgePolicy?: ScoreBadgePolicy;
}

/** Optional C design handoff slots. They remain absent until a builder fills them. */
export interface CostSitePromptSlots {
  perf?: string;
  a11y?: string;
}

/** A quiet one-line group used instead of full cards for strong pages. */
export interface StrongPageGroup {
  label: string;
  pages: readonly {
    name: string;
    score: number;
  }[];
}

export function dimSeverityRank(status: ClientReportStatus, couldNotMeasure: boolean): number {
  if (couldNotMeasure) return 2;
  return { poor: 0, fair: 1, good: 3 }[status];
}

export type PerfGapKind = 'slow-lcp' | 'layout-shift' | 'blank' | 'late-paint' | 'sluggish';

export interface PerfGapMetrics {
  lcpMs?: number;
  cls?: number;
  fcpMs?: number;
  tbtMs?: number;
}

interface PerfGapSpec {
  metricLabel: string;
  line: { good: number; poor: number };
  lineOwner: string;
  lineUrl: string;
  label: (value: number) => string;
}

const PERF_GAP_SPECS: Record<PerfGapKind, PerfGapSpec> = {
  'slow-lcp': {
    metricLabel: 'Main content',
    line: BENCHMARK_LINES.lcpMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://web.dev/articles/lcp',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  'layout-shift': {
    metricLabel: 'Layout shift',
    line: BENCHMARK_LINES.cls,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://web.dev/articles/cls',
    label: (value) => value.toFixed(2),
  },
  blank: {
    metricLabel: 'First content',
    line: BENCHMARK_LINES.fcpMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  'late-paint': {
    metricLabel: 'First content',
    line: BENCHMARK_LINES.fcpMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  sluggish: {
    metricLabel: 'Tap delay',
    line: BENCHMARK_LINES.tbtMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
};

function finiteMetric(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function perfGapValue(kind: PerfGapKind, metrics: PerfGapMetrics): number | undefined {
  switch (kind) {
    case 'slow-lcp': return finiteMetric(metrics.lcpMs);
    case 'layout-shift': return finiteMetric(metrics.cls);
    case 'blank':
    case 'late-paint': return finiteMetric(metrics.fcpMs);
    case 'sluggish': return finiteMetric(metrics.tbtMs);
  }
}

export function perfGap(kind: PerfGapKind, metrics: PerfGapMetrics): CostGap | undefined {
  const value = perfGapValue(kind, metrics);
  if (value === undefined) return undefined;
  const spec = PERF_GAP_SPECS[kind];
  return {
    metricLabel: spec.metricLabel,
    measuredLabel: spec.label(value),
    goodLabel: spec.label(spec.line.good),
    poorLabel: spec.label(spec.line.poor),
    ...(benchmarkMultiple(value, spec.line.good) ? { multipleLabel: benchmarkMultiple(value, spec.line.good) } : {}),
    zone: benchmarkZone(value, spec.line),
    lineOwner: spec.lineOwner,
    lineUrl: spec.lineUrl,
  };
}

export interface PerfFactPage {
  name: string;
  lcpMs?: number;
  fcpMs?: number;
  tbtMs?: number;
  jsKb?: number;
  downloadsBeforeLcpKb?: number;
  downloadsKb?: number;
}

export interface PerfHeroMetric {
  valueKey: 'lcpMs' | 'fcpMs' | 'tbtMs';
  goodMs: number;
  poorMs: number;
  beforeContentKbKey?: 'downloadsBeforeLcpKb';
  contentLabel: string;
}

export const FCP_HERO_METRIC: PerfHeroMetric = {
  valueKey: 'fcpMs',
  goodMs: BENCHMARK_LINES.fcpMs.good,
  poorMs: BENCHMARK_LINES.fcpMs.poor,
  beforeContentKbKey: 'downloadsBeforeLcpKb',
  contentLabel: 'main content',
};

function mb(kb: number): string {
  return `${(kb / 1024).toFixed(1)} MB`;
}

function mbNumber(kb: number): string {
  return (kb / 1024).toFixed(1);
}

export function perfGapSubLines(pages: readonly PerfFactPage[], anchor: PerfFactPage): string[] {
  const lines: string[] = [];
  const lcpPages = pages.filter((page): page is PerfFactPage & { lcpMs: number } => finiteMetric(page.lcpMs) !== undefined);
  const slowest = [...lcpPages].sort((a, b) => b.lcpMs - a.lcpMs)[0];
  if (slowest) {
    const multiple = benchmarkMultiple(slowest.lcpMs, BENCHMARK_LINES.lcpMs.good);
    if (multiple) lines.push(`slowest page: ${slowest.name}, ${(slowest.lcpMs / 1000).toFixed(1)}s - ${multiple} the line`);
  }
  if (lcpPages.length > 1) {
    const average = lcpPages.reduce((sum, page) => sum + page.lcpMs, 0) / lcpPages.length;
    const multiple = benchmarkMultiple(average, BENCHMARK_LINES.lcpMs.good);
    if (multiple) lines.push(`site average: ${(average / 1000).toFixed(1)}s - ${multiple} the line`);
  }
  const before = finiteMetric(anchor.downloadsBeforeLcpKb);
  const total = finiteMetric(anchor.downloadsKb);
  if (before !== undefined && total !== undefined) {
    lines.push(`the phone pulls ${mb(before)} before the main content shows, ${mb(total)} in total`);
  }
  return lines;
}

function heroMetricValue(page: PerfFactPage, hero: PerfHeroMetric): number | undefined {
  return finiteMetric(page[hero.valueKey]);
}

function heroMetricLabel(valueMs: number): string {
  return `${(valueMs / 1000).toFixed(1)}s`;
}

function heroMetricMultiple(valueMs: number, hero: PerfHeroMetric): string | undefined {
  return benchmarkMultipleFromDisplayedSeconds(valueMs, hero.goodMs);
}

/**
 * Produces the performance detail lines from the same metric and good line as
 * the C block hero. The legacy LCP helper above remains for existing callers.
 */
export function heroMetricGapSubLines(
  pages: readonly PerfFactPage[],
  anchor: PerfFactPage,
  hero: PerfHeroMetric,
): string[] {
  const lines: string[] = [];
  const metricPages = pages
    .map((page) => ({ page, valueMs: heroMetricValue(page, hero) }))
    .filter((entry): entry is { page: PerfFactPage; valueMs: number } => entry.valueMs !== undefined)
    .sort((a, b) => b.valueMs - a.valueMs);
  const addPageLine = (prefix: string, entry: { page: PerfFactPage; valueMs: number }): void => {
    const multiple = heroMetricMultiple(entry.valueMs, hero);
    const suffix = multiple ? ` - ${multiple} the line` : '';
    lines.push(`${prefix}${entry.page.name}, ${heroMetricLabel(entry.valueMs)}${suffix}`);
  };

  if (metricPages[0]) addPageLine('slowest page: ', metricPages[0]);
  if (metricPages[1]) addPageLine('next slowest: ', metricPages[1]);
  if (metricPages.length > 1) {
    const averageMs = metricPages.reduce((sum, entry) => sum + entry.valueMs, 0) / metricPages.length;
    const multiple = heroMetricMultiple(averageMs, hero);
    const suffix = multiple ? ` - ${multiple} the line` : '';
    lines.push(`site average: ${heroMetricLabel(averageMs)}${suffix}`);
  }
  const before = hero.beforeContentKbKey ? finiteMetric(anchor[hero.beforeContentKbKey]) : undefined;
  const total = finiteMetric(anchor.downloadsKb);
  if (before !== undefined && total !== undefined) {
    lines.push(`the phone pulls ${mb(before)} before the ${hero.contentLabel} shows, ${mb(total)} in total`);
  }
  return lines;
}

const PERF_FIX_TARGET: Record<PerfProblemKind, string> = {
  'slow-lcp': 'The target: main content under 2.5 seconds on the same phone profile.',
  'layout-shift': 'The target: layout shift under 0.10 on the same phone profile.',
  blank: 'The target: something visible under 1.8 seconds on the same phone profile.',
  'late-paint': 'The target: something visible under 1.8 seconds on the same phone profile.',
  sluggish: 'The target: time spent blocking the main thread under 0.2 seconds on the same phone profile.',
};

const PERF_STAKES_PROSE: Record<PerfProblemKind, string> = {
  'slow-lcp': 'Waits like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up share for your pages.',
  'layout-shift': 'Layout shifts like this make visitors lose their place, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up share for your pages.',
  blank: 'Blank starts like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up share for your pages.',
  'late-paint': 'Slow starts like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up share for your pages.',
  sluggish: 'Slow interactions like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up share for your pages.',
};

export function perfFixText(pages: readonly PerfFactPage[], kind: PerfProblemKind = 'slow-lcp'): string {
  const jsValues = pages.map((page) => finiteMetric(page.jsKb)).filter((value): value is number => value !== undefined);
  const downloads = pages.map((page) => finiteMetric(page.downloadsKb)).filter((value): value is number => value !== undefined);
  const clauses: string[] = [];
  if (jsValues.length > 0) {
    const subject = jsValues.length === pages.length ? 'every page carries' : 'the pages with JavaScript data carry';
    clauses.push(`${subject} ${mbNumber(Math.min(...jsValues))}-${mbNumber(Math.max(...jsValues))} MB of JavaScript`);
  }
  if (downloads.length > 0) clauses.push(`the heaviest page moves ${mb(Math.max(...downloads))} in total`);
  const target = PERF_FIX_TARGET[kind];
  return clauses.length ? `${target} The dominant cause we measured: ${clauses.join(', and ')}.` : target;
}

export function perfStakesProse(kind: PerfProblemKind): string {
  return PERF_STAKES_PROSE[kind];
}

export function countedZeroLine(pages: readonly PerfFactPage[]): string | undefined {
  const nearLine = pages
    .filter((page): page is PerfFactPage & { lcpMs: number } => {
      const value = finiteMetric(page.lcpMs);
      return value !== undefined && value >= BENCHMARK_LINES.lcpMs.good * 0.8 && value <= BENCHMARK_LINES.lcpMs.good;
    })
    .map((page) => `${page.name} (${(page.lcpMs / 1000).toFixed(1)}s)`);
  if (nearLine.length === 0) return undefined;
  const verb = nearLine.length === 1 ? 'sits' : 'sit';
  const pronoun = nearLine.length === 1 ? 'It is' : 'They are';
  const slowPage = nearLine.length === 1 ? 'a slow page' : 'slow pages';
  return `Counted as zero above: ${nearLine.join(', ')} ${verb} close to the line. ${pronoun} included in the site average, but not counted as ${slowPage} above.`;
}

/**
 * Lists near-line pages using the C block hero metric and its good line. The
 * legacy LCP helper above remains for established callers.
 */
export function heroMetricCountedZeroLine(pages: readonly PerfFactPage[], hero: PerfHeroMetric): string | undefined {
  const nearLine = pages
    .map((page) => ({ page, valueMs: heroMetricValue(page, hero) }))
    .filter((entry): entry is { page: PerfFactPage; valueMs: number } => (
      entry.valueMs !== undefined
      && entry.valueMs >= hero.goodMs * 0.8
      && entry.valueMs <= hero.goodMs
    ))
    .map((entry) => `${entry.page.name} (${heroMetricLabel(entry.valueMs)})`);
  if (nearLine.length === 0) return undefined;
  const verb = nearLine.length === 1 ? 'sits' : 'sit';
  const pronoun = nearLine.length === 1 ? 'It is' : 'They are';
  const slowPage = nearLine.length === 1 ? 'a slow page' : 'slow pages';
  return `Counted as zero above: ${nearLine.join(', ')} ${verb} close to the line. ${pronoun} included in the site average, but not counted as ${slowPage} above.`;
}

export function moneyPage<T extends { name: string; startingPath: string; lcpMs?: number }>(
  pages: readonly T[],
  overridePath?: string,
): (T & { lcpMs: number }) | undefined {
  const normalizePath = (value: string): string => {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed === '/') return '/';
    return `/${trimmed.replace(/^\/+/, '')}`;
  };
  const normalizedOverride = overridePath === undefined ? undefined : normalizePath(overridePath);
  const matching = normalizedOverride
    ? pages.find((page) => normalizePath(page.startingPath) === normalizedOverride)
    : pages.find((page) => /\b(?:book(?:ing)?|appointments?|schedule|contact|locations?|reserve|reservations?|quote|inquir(?:y|ies))\b/i.test(`${page.name} ${page.startingPath}`));
  if (!matching) return undefined;
  const lcpMs = finiteMetric(matching.lcpMs);
  return lcpMs !== undefined && lcpMs > BENCHMARK_LINES.lcpMs.good
    ? { ...matching, lcpMs }
    : undefined;
}

export function bookingLine(page: { name: string; lcpMs: number }): string {
  return `${page.name} is the page where booking starts. It shows its main content after ${(page.lcpMs / 1000).toFixed(1)}s - a visitor who gives up here is an inquiry that never begins.`;
}

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
