/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportCostBlock } from '../client-report-renderer';
import {
  isPerfCostProblem,
  metricVal,
  perfAffectsProse,
  perfCostCopyPromptEnabled,
  perfCostHeadline,
  perfProblemMetric,
  perfProblemPhrase,
  SCORE_BADGE_POLICY,
  type ClientReportPerfProblemCandidate,
} from './perf';
import type { CostGap } from './cost-benchmarks';
import type { BuildPerfCostInput, PerfFactPage, PerfGapKind, PerfGapMetrics } from './cost-performance';
import {
  buildAtRiskPerfStakes,
  buildPerfCalculator,
  optionalCountedZeroLine,
} from './cost-performance-state';

export interface ProblemPerfCostStateDependencies {
  bookingLine: (page: { name: string; lcpMs: number }) => string;
  countedZeroLine: (pages: readonly PerfFactPage[]) => string | undefined;
  moneyPage: (
    pages: readonly { name: string; startingPath: string; lcpMs?: number }[],
    overridePath?: string,
  ) => { name: string; startingPath: string; lcpMs: number } | undefined;
  perfFixText: (pages: readonly PerfFactPage[], kind: PerfGapKind) => string;
  perfGap: (kind: PerfGapKind, metrics: PerfGapMetrics) => CostGap | undefined;
  perfGapScale: (kind: PerfGapKind, metrics: PerfGapMetrics, gap: CostGap | undefined) => ClientReportCostBlock['scale'] | undefined;
  perfGapSubLines: (pages: readonly PerfFactPage[], anchor: PerfFactPage) => string[];
  perfStakesProse: (kind: PerfGapKind) => string;
}

export function buildProblemMeasuredPerfCost(
  input: BuildPerfCostInput,
  perfCostAnchor: ClientReportPerfProblemCandidate,
  perfCostProblem: ClientReportPerfProblemCandidate | undefined,
  dependencies: ProblemPerfCostStateDependencies,
): ClientReportCostBlock | undefined {
  if (!isPerfCostProblem(perfCostAnchor.problem)) return undefined;

  const {
    bookingLine,
    countedZeroLine,
    moneyPage,
    perfFixText,
    perfGap,
    perfGapScale,
    perfGapSubLines,
    perfStakesProse,
  } = dependencies;
  const supportingProblem = perfCostProblem ?? perfCostAnchor;
  const supportingPerfProblem = isPerfCostProblem(supportingProblem.problem)
    ? supportingProblem.problem
    : perfCostAnchor.problem;
  const anchorPage = perfCostAnchor.page;
  const anchorProblemTx = perfProblemPhrase(perfCostAnchor.problem, anchorPage);
  const anchorProblemMetricTx = perfProblemMetric(perfCostAnchor.problem, anchorPage);
  const anchorProblemLabel = anchorProblemMetricTx ?? anchorProblemTx ?? perfCostAnchor.problem.chip;
  const anchorProblemPhrase = anchorProblemTx ?? perfCostAnchor.problem.chip;
  const perfFactPages = input.measured.map(({ page }) => ({
    name: page.name,
    lcpMs: metricVal(page, 'LCP'),
    jsKb: metricVal(page, 'js'),
    downloadsBeforeLcpKb: metricVal(page, 'downloads-before-LCP'),
    downloadsKb: metricVal(page, 'downloads'),
  }));
  const anchorFacts = {
    name: anchorPage.name,
    lcpMs: metricVal(anchorPage, 'LCP'),
    jsKb: metricVal(anchorPage, 'js'),
    downloadsBeforeLcpKb: metricVal(anchorPage, 'downloads-before-LCP'),
    downloadsKb: metricVal(anchorPage, 'downloads'),
  };
  const gapMetrics = {
    lcpMs: metricVal(anchorPage, 'LCP'),
    cls: metricVal(anchorPage, 'CLS') !== undefined ? metricVal(anchorPage, 'CLS')! / 100 : undefined,
    fcpMs: metricVal(anchorPage, 'FCP'),
    tbtMs: metricVal(anchorPage, 'TBT'),
  };
  const gap = perfGap(perfCostAnchor.problem.kind, gapMetrics);
  const scale = perfGapScale(perfCostAnchor.problem.kind, gapMetrics, gap);
  const bookingPage = moneyPage(
    input.rankedCarded.map(({ page }) => ({ name: page.name, startingPath: page.startingPath, lcpMs: metricVal(page, 'LCP') })),
    input.moneyPage,
  );
  const zeroLine = countedZeroLine(perfFactPages);

  return {
    tab: 'perf',
    state: 'measured',
    headline: perfCostHeadline(perfCostAnchor.problem, anchorProblemLabel, anchorProblemPhrase, anchorPage),
    chip: 'measured',
    affectsProse: perfAffectsProse(supportingPerfProblem),
    sitePrompt: perfCostCopyPromptEnabled(supportingPerfProblem)
      ? input.copyPromptForPage(supportingProblem.page)
      : undefined,
    ...(gap ? { gap } : {}),
    ...(scale ? { scale } : {}),
    gapSubLines: perfGapSubLines(perfFactPages, anchorFacts),
    ...(bookingPage ? { bookingLine: bookingLine(bookingPage) } : {}),
    stakes: buildAtRiskPerfStakes(perfStakesProse(perfCostAnchor.problem.kind)),
    fix: { tone: 'primary', text: perfFixText(perfFactPages, perfCostAnchor.problem.kind) },
    calculator: buildPerfCalculator(),
    ...optionalCountedZeroLine(zeroLine),
    scoreBadgePolicy: SCORE_BADGE_POLICY,
  };
}
