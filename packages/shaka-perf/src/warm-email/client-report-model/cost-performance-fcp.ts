/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportCostBlock } from '../client-report-renderer';
import { buildPerfSitePrompt } from '../copy-prompt';
import type { PagePerf } from '../synthesis';
import { metricVal, perfAffectsProse, SCORE_BADGE_POLICY, type ClientReportPerfProblemCandidate } from './perf';
import { BENCHMARK_LINES, benchmarkMultiple, benchmarkScaleGeometry, BENCHMARK_SCALE_POLICIES, type CostGap } from './cost-benchmarks';
import type { BuildPerfCostInput, PerfFactPage, PerfGapMetrics, PerfHeroMetric } from './cost-performance';
import {
  buildAtRiskPerfStakes,
  buildPerfCalculator,
  optionalCountedZeroLine,
} from './cost-performance-state';

type CompletePerfPromptFacts = {
  name: string;
  lcpMs: number | undefined;
  fcpMs: number;
  jsKb: number;
  downloadsBeforeLcpKb: number | undefined;
  downloadsKb: number;
};

export interface FcpPerfCostStateDependencies {
  heroMetric: PerfHeroMetric;
  heroMetricCountedZeroLine: (pages: readonly PerfFactPage[], hero: PerfHeroMetric) => string | undefined;
  heroMetricGapSubLines: (pages: readonly PerfFactPage[], anchor: PerfFactPage, hero: PerfHeroMetric) => string[];
  perfGap: (kind: 'blank', metrics: PerfGapMetrics) => CostGap | undefined;
  perfStakesProse: (kind: 'late-paint') => string;
}

function displayTimingMs(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Number((value / 1000).toFixed(1)) * 1000;
}

function displayFcpGapSubLines(
  pages: readonly PerfFactPage[],
  anchor: PerfFactPage,
  heroMetric: PerfHeroMetric,
  heroMetricGapSubLines: FcpPerfCostStateDependencies['heroMetricGapSubLines'],
): string[] {
  const lines = heroMetricGapSubLines(pages, anchor, heroMetric);
  const fcpValues = pages.map((page) => page.fcpMs).filter((value): value is number => value !== undefined);
  if (fcpValues.length < 2) return lines;
  const displayedAverageMs = displayTimingMs(fcpValues.reduce((sum, value) => sum + value, 0) / fcpValues.length);
  if (displayedAverageMs === undefined) return lines;
  const multiple = benchmarkMultiple(displayedAverageMs, heroMetric.goodMs);
  const suffix = multiple ? ` - ${multiple} the line` : '';
  const averageLine = `site average: ${(displayedAverageMs / 1000).toFixed(1)}s${suffix}`;
  return lines.map((line) => line.startsWith('site average: ') ? averageLine : line);
}

function hasCompletePerfPromptFacts(page: {
  name: string;
  lcpMs: number | undefined;
  fcpMs?: number;
  jsKb?: number;
  downloadsBeforeLcpKb: number | undefined;
  downloadsKb?: number;
}): page is CompletePerfPromptFacts {
  return page.fcpMs !== undefined
    && page.jsKb !== undefined
    && page.downloadsKb !== undefined;
}

export function buildFcpMeasuredPerfCost(
  input: BuildPerfCostInput,
  siteDominantPerfProblem: ClientReportPerfProblemCandidate | undefined,
  dependencies: FcpPerfCostStateDependencies,
): ClientReportCostBlock | undefined {
  const {
    heroMetric,
    heroMetricCountedZeroLine,
    heroMetricGapSubLines,
    perfGap,
    perfStakesProse,
  } = dependencies;
  if (input.perfCouldNotMeasure || input.perfStatus === 'good') return undefined;

  const fcpCostCandidates = input.measured
    .map(({ page }) => ({ page, fcpMs: displayTimingMs(metricVal(page, 'FCP')) }))
    .filter((candidate): candidate is { page: PagePerf; fcpMs: number } => candidate.fcpMs !== undefined && candidate.fcpMs > heroMetric.goodMs)
    .sort((a, b) => b.fcpMs - a.fcpMs);
  // Prefer an eligible homepage, then keep the slowest measured candidate.
  const fcpCostAnchor = fcpCostCandidates.find((candidate) => candidate.page.startingPath === '/') ?? fcpCostCandidates[0];
  const fcpCostIsDominant = siteDominantPerfProblem?.problem.kind === 'blank'
    || siteDominantPerfProblem?.problem.kind === 'late-paint'
    || siteDominantPerfProblem === undefined;
  if (!fcpCostAnchor || !fcpCostIsDominant) return undefined;

  const anchorPage = fcpCostAnchor.page;
  const perfFactPages = input.measured.map(({ page }) => ({
    name: page.name,
    lcpMs: metricVal(page, 'LCP'),
    fcpMs: displayTimingMs(metricVal(page, 'FCP')),
    jsKb: metricVal(page, 'js'),
    downloadsBeforeLcpKb: metricVal(page, 'downloads-before-LCP'),
    downloadsKb: metricVal(page, 'downloads'),
  }));
  const anchorFacts = {
    name: anchorPage.name,
    lcpMs: metricVal(anchorPage, 'LCP'),
    fcpMs: displayTimingMs(metricVal(anchorPage, 'FCP')),
    jsKb: metricVal(anchorPage, 'js'),
    downloadsBeforeLcpKb: metricVal(anchorPage, 'downloads-before-LCP'),
    downloadsKb: metricVal(anchorPage, 'downloads'),
  };
  const heroFcpMs = fcpCostAnchor.fcpMs;
  const rawGap = perfGap('blank', { fcpMs: heroFcpMs });
  const gap = rawGap && {
    ...rawGap,
    lineOwner: "Google's Lighthouse benchmark - first contentful paint",
  };
  const pageUrls = input.measured.map(({ page }) => input.pageUrl(page));
  const completePromptPages = perfFactPages
    .map((facts, index) => ({ facts, page: input.measured[index].page, url: pageUrls[index] }))
    .filter((candidate): candidate is { facts: CompletePerfPromptFacts; page: PagePerf; url: string } => hasCompletePerfPromptFacts(candidate.facts));
  const promptHomepage = completePromptPages.find((candidate) => candidate.page.startingPath === '/');
  const perfSitePrompt = promptHomepage?.facts.downloadsBeforeLcpKb === undefined
    ? undefined
    : buildPerfSitePrompt({
      url: input.siteUrl,
      host: input.promptCtx.host,
      date: input.promptCtx.date,
      viewportLabel: input.promptCtx.viewportLabel,
      throttleProfile: input.promptCtx.throttleProfile,
      pageCount: completePromptPages.length,
      homepage: promptHomepage.facts,
      pages: completePromptPages.map((candidate) => candidate.facts),
      pageUrls: completePromptPages.map((candidate) => candidate.url),
    });
  const perfHandoff = perfSitePrompt ?? input.copyPromptForPage(anchorPage);
  const zeroLine = heroMetricCountedZeroLine(perfFactPages, heroMetric);
  const beforeContentKb = metricVal(anchorPage, 'downloads-before-LCP');
  const fixText = [
    beforeContentKb === undefined
      ? undefined
      : `Start where the wait is: ${anchorPage.name} pulls ${(beforeContentKb / 1024).toFixed(1)} MB before its main content shows.`,
    'The target: something visible under 1.8 seconds on the same phone profile.',
  ].filter((line): line is string => !!line).join(' ');

  return {
    tab: 'perf',
    state: 'measured',
    headline: gap ? `nothing for the first ${gap.measuredLabel}` : 'first content is slow on this page',
    chip: 'measured',
    affectsProse: perfAffectsProse({ kind: 'late-paint', status: 'fair', severity: 0, headline: '', chip: '' }),
    ...(perfHandoff ? { sitePrompts: { perf: perfHandoff } } : {}),
    ...(gap ? { gap } : {}),
    ...(gap && heroFcpMs !== undefined ? {
    scale: benchmarkScaleGeometry(heroFcpMs, BENCHMARK_LINES.fcpMs, BENCHMARK_SCALE_POLICIES.fcpMs),
    } : {}),
    gapSubLines: displayFcpGapSubLines(perfFactPages, anchorFacts, heroMetric, heroMetricGapSubLines),
    stakes: buildAtRiskPerfStakes(perfStakesProse('late-paint')),
    fix: { tone: 'primary', text: fixText },
    calculator: buildPerfCalculator(),
    ...optionalCountedZeroLine(zeroLine),
    scoreBadgePolicy: SCORE_BADGE_POLICY,
  };
}
