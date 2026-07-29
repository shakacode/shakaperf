/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportCostBlock, ClientReportStatus } from '../client-report-renderer';
import type { PagePerf } from '../synthesis';
import {
  compareClientReportPerfProblemCandidate,
  dominantPerfProblem,
  isPerfCostProblem,
  perfProblemMetric,
  perfProblemPhrase,
  selectPerfCostAnchor,
  type ClientReportPerfProblemCandidate,
  type PerfProblemKind,
  type Problem,
} from './perf';

import {
  BENCHMARK_LINES,
  BENCHMARK_SCALE_POLICIES,
  benchmarkMultiple,
  benchmarkScaleGeometry,
  benchmarkZone,
  type BenchmarkScalePolicy,
  type CostGap,
} from './cost-benchmarks';
import { buildFcpMeasuredPerfCost, type FcpPerfCostStateDependencies } from './cost-performance-fcp';
import { buildProblemMeasuredPerfCost, type ProblemPerfCostStateDependencies } from './cost-performance-problem';
import { buildZeroPerfCost } from './cost-performance-zero';

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
  value: (metrics: PerfGapMetrics) => number | undefined;
  scalePolicy?: BenchmarkScalePolicy;
  lineOwner: string;
  lineUrl: string;
  label: (value: number) => string;
}

const PERF_GAP_SPECS: Record<PerfGapKind, PerfGapSpec> = {
  'slow-lcp': {
    metricLabel: 'Main content',
    line: BENCHMARK_LINES.lcpMs,
    value: (metrics) => finiteMetric(metrics.lcpMs),
    scalePolicy: BENCHMARK_SCALE_POLICIES.lcpMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://web.dev/articles/lcp',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  'layout-shift': {
    metricLabel: 'Layout shift',
    line: BENCHMARK_LINES.cls,
    value: (metrics) => finiteMetric(metrics.cls),
    scalePolicy: BENCHMARK_SCALE_POLICIES.cls,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://web.dev/articles/cls',
    label: (value) => value.toFixed(2),
  },
  blank: {
    metricLabel: 'First content',
    line: BENCHMARK_LINES.fcpMs,
    value: (metrics) => finiteMetric(metrics.fcpMs),
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  'late-paint': {
    metricLabel: 'First content',
    line: BENCHMARK_LINES.fcpMs,
    value: (metrics) => finiteMetric(metrics.fcpMs),
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
  sluggish: {
    metricLabel: 'Tap delay',
    line: BENCHMARK_LINES.tbtMs,
    value: (metrics) => finiteMetric(metrics.tbtMs),
    scalePolicy: BENCHMARK_SCALE_POLICIES.tbtMs,
    lineOwner: "Google's Core Web Vitals",
    lineUrl: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time',
    label: (value) => `${(value / 1000).toFixed(1)}s`,
  },
};

function finiteMetric(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

export function perfGap(kind: PerfGapKind, metrics: PerfGapMetrics): CostGap | undefined {
  const spec = PERF_GAP_SPECS[kind];
  const value = spec.value(metrics);
  if (value === undefined) return undefined;
  return {
    metricLabel: spec.metricLabel,
    measuredLabel: spec.label(value),
    goodLabel: spec.label(spec.line.good),
    poorLabel: spec.label(spec.line.poor),
    ...(benchmarkMultiple(value, spec.line.good) ? { multipleLabel: benchmarkMultiple(value, spec.line.good) } : {}),
    zone: benchmarkZone(value, spec.line),
    lineOwner: spec.lineOwner,
    lineUrl: spec.lineUrl,
    ...(spec.scalePolicy ? { scaleAxis: { unit: spec.scalePolicy.unit, precision: spec.scalePolicy.precision } } : {}),
  };
}

function perfGapScale(
  kind: PerfGapKind,
  metrics: PerfGapMetrics,
  gap: CostGap | undefined,
) {
  const spec = PERF_GAP_SPECS[kind];
  const value = spec.value(metrics);
  return gap && value !== undefined && spec.scalePolicy
    ? benchmarkScaleGeometry(value, spec.line, spec.scalePolicy)
    : undefined;
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
  /** An intentional LCP-bound resource lever alongside the hero timing metric. */
  beforeMainContentKbKey?: 'downloadsBeforeLcpKb';
  mainContentLabel: string;
}

export const FCP_HERO_METRIC: PerfHeroMetric = {
  valueKey: 'fcpMs',
  goodMs: BENCHMARK_LINES.fcpMs.good,
  poorMs: BENCHMARK_LINES.fcpMs.poor,
  beforeMainContentKbKey: 'downloadsBeforeLcpKb',
  mainContentLabel: 'main content',
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
  return benchmarkMultiple(valueMs, hero.goodMs);
}

/**
 * Produces timing detail lines from the C block hero metric and good line. Its
 * optional main-content byte line is an intentional LCP-bound resource lever.
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
  const before = hero.beforeMainContentKbKey ? finiteMetric(anchor[hero.beforeMainContentKbKey]) : undefined;
  const total = finiteMetric(anchor.downloadsKb);
  if (before !== undefined && total !== undefined) {
    lines.push(`the phone pulls ${mb(before)} before the ${hero.mainContentLabel} shows, ${mb(total)} in total`);
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
  'slow-lcp': 'Waits like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up number.',
  'layout-shift': 'Layout shifts like this make visitors lose their place, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up number.',
  blank: 'Blank starts like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up number.',
  'late-paint': 'Slow starts like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up number.',
  sluggish: 'Slow interactions like this are where visitors give up, and every study that has measured it points the same way. No study has measured a gap as wide as yours, so we do not print a made-up number.',
};

export function perfFixText(pages: readonly PerfFactPage[], kind: PerfProblemKind = 'slow-lcp'): string {
  const jsValues = pages.map((page) => finiteMetric(page.jsKb)).filter((value): value is number => value !== undefined);
  const downloads = pages.map((page) => finiteMetric(page.downloadsKb)).filter((value): value is number => value !== undefined);
  const clauses: string[] = [];
  if (jsValues.length > 0) {
    const subject = jsValues.length === pages.length ? 'every page carries' : 'the pages with JavaScript data carry';
    const minimum = mbNumber(Math.min(...jsValues));
    const maximum = mbNumber(Math.max(...jsValues));
    const jsWeight = minimum === maximum ? minimum : `${minimum}-${maximum}`;
    clauses.push(`${subject} ${jsWeight} MB of JavaScript`);
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

export interface PerfCostPromptContext {
  host: string;
  date: string;
  viewportLabel: string;
  throttleProfile: string;
}

export interface PerfCostPage {
  page: PagePerf;
  lead: Problem;
}

export interface PerfCostAssembly {
  perfCost?: ClientReportCostBlock;
  perfCostAnchor?: ClientReportPerfProblemCandidate;
  tilePerfProblem?: ClientReportPerfProblemCandidate;
  perfProblemTx?: string;
  perfProblemMetricTx?: string;
  rankedCarded: readonly PerfCostPage[];
}

export interface BuildPerfCostInput {
  hasPerf: boolean;
  perfCouldNotMeasure: boolean;
  perfStatus: ClientReportStatus;
  measured: readonly PerfCostPage[];
  rankedCarded: readonly PerfCostPage[];
  siteUrl: string;
  throttleProfile?: string;
  promptCtx: PerfCostPromptContext;
  moneyPage?: string;
  pageUrl: (page: PagePerf) => string;
  copyPromptForPage: (page: PagePerf) => string | undefined;
  sameAsPsiDefaultProfile: (profile: string | undefined) => boolean;
}

// Keep callbacks explicit so extracted state modules need only type back-imports.
const FCP_PERF_COST_STATE_DEPENDENCIES: FcpPerfCostStateDependencies = {
  heroMetric: FCP_HERO_METRIC,
  heroMetricCountedZeroLine,
  heroMetricGapSubLines,
  perfGap,
  perfStakesProse,
};

const PROBLEM_PERF_COST_STATE_DEPENDENCIES: ProblemPerfCostStateDependencies = {
  bookingLine,
  countedZeroLine,
  moneyPage,
  perfFixText,
  perfGap,
  perfGapScale,
  perfGapSubLines,
  perfStakesProse,
};

/**
 * Builds the performance cost treatment from already-read audit data. It does
 * no artifact reads or network work, making all cost-state branches directly
 * reusable and deterministic.
 */
export function buildPerfCost(input: BuildPerfCostInput): PerfCostAssembly {
  let siteDominantPerfProblem: ClientReportPerfProblemCandidate | undefined;
  for (const page of input.measured) {
    const candidate = dominantPerfProblem(page);
    if (!candidate) continue;
    if (!siteDominantPerfProblem || compareClientReportPerfProblemCandidate(siteDominantPerfProblem, candidate) > 0) siteDominantPerfProblem = candidate;
  }
  const rankedPerfCostCandidates = input.rankedCarded
    .map((page) => dominantPerfProblem(page))
    .filter((candidate): candidate is ClientReportPerfProblemCandidate => !!candidate && isPerfCostProblem(candidate.problem));
  const perfCostProblem = rankedPerfCostCandidates[0];
  const perfCostAnchor = selectPerfCostAnchor(rankedPerfCostCandidates, BENCHMARK_LINES.lcpMs.good);
  const tilePerfProblem = perfCostProblem ?? siteDominantPerfProblem;
  const perfProblemTx = tilePerfProblem ? perfProblemPhrase(tilePerfProblem.problem, tilePerfProblem.page) : undefined;
  const perfProblemMetricTx = tilePerfProblem ? perfProblemMetric(tilePerfProblem.problem, tilePerfProblem.page) : undefined;
  const fcpPerfCost = input.hasPerf
    ? buildFcpMeasuredPerfCost(input, siteDominantPerfProblem, FCP_PERF_COST_STATE_DEPENDENCIES)
    : undefined;
  const perfCost: ClientReportCostBlock | undefined = !input.hasPerf
    ? undefined
    : fcpPerfCost
      ?? (input.perfStatus === 'good'
        ? buildZeroPerfCost(input)
        : !input.perfCouldNotMeasure && perfCostAnchor && isPerfCostProblem(perfCostAnchor.problem)
          ? buildProblemMeasuredPerfCost(input, perfCostAnchor, perfCostProblem, PROBLEM_PERF_COST_STATE_DEPENDENCIES)
          : undefined);

  return { perfCost, perfCostAnchor, tilePerfProblem, perfProblemTx, perfProblemMetricTx, rankedCarded: input.rankedCarded };
}
