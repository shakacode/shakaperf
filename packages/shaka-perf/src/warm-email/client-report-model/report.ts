/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { botWallFooterSentence, FOOTER_GUARDRAIL, perfGapHeadline } from '../cost-strings';
import type {
  ClientReportModel,
  ClientReportStatus,
  ClientReportTile,
} from '../client-report-renderer';
import { composeNarrative, type Dim, type NarrativeFacts, type NarrativeOverlay } from '../client-report-narrative';
import { dimSeverityRank, type PerfCostAssembly, type PerfCostPage } from './cost';
import type { A11ySection } from './a11y';
import type { AgentSection } from './ai';
import { perfProblemTileCopy } from './perf';
import { stripTags } from './shared';

export interface ClientReportPerformanceSection extends PerfCostAssembly {
  hasPerf: boolean;
  perfStatus: ClientReportStatus;
  perfScore?: number;
  perfCouldNotMeasure: boolean;
  perfCards: ClientReportModel['perfCards'];
  perfFine: ClientReportModel['perfFine'];
}

export interface ClientReportReportInput {
  domain: string;
  dateStr: string;
  faviconLinkTag: string;
  measuredCount: number;
  avgMs?: number;
  avgLabel: string;
  slowCount: number;
  jumpyCount: number;
  footnoteThrottle: string;
  perf: ClientReportPerformanceSection;
  a11y: A11ySection;
  hasAgent: boolean;
  agent: AgentSection;
}

export function buildClientReportNarrativeFacts(input: ClientReportReportInput): NarrativeFacts {
  const { perf, a11y, agent } = input;
  const rank: Record<ClientReportStatus, number> = { good: 0, fair: 1, poor: 2 };
  const present: { dim: Dim; status: ClientReportStatus }[] = [];
  if (perf.hasPerf && !perf.perfCouldNotMeasure) present.push({ dim: 'perf', status: perf.perfStatus });
  if (a11y.hasA11y && !a11y.a11yCouldNotMeasure) present.push({ dim: 'a11y', status: a11y.a11yStatus });
  if (input.hasAgent && !agent.agentCouldNotMeasure) present.push({ dim: 'agent', status: agent.agentStatus });
  const worstDim: Dim = present.length
    ? present.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a)).dim
    : 'perf';
  const facts: NarrativeFacts = { domain: input.domain, worstDim };
  if (perf.hasPerf) {
    const perfFact: NonNullable<NarrativeFacts['perf']> = {
      status: perf.perfStatus,
      slowCount: input.slowCount,
      jumpyCount: input.jumpyCount,
      worst: perf.rankedCarded.slice(0, 3).map((row: PerfCostPage) => ({ name: row.page.name, problem: stripTags(row.lead.headline) })),
    };
    if (input.avgMs !== undefined) perfFact.avgLabel = input.avgLabel;
    if (perf.perfCost?.gap?.multipleLabel) perfFact.benchmarkMultiples = [perf.perfCost.gap.multipleLabel];
    if (perf.perfCostAnchor?.problem.kind === 'slow-lcp' && perf.perfCost?.gap) {
      perfFact.gapHeadline = perfGapHeadline(
        perf.perfCost.gap.measuredLabel,
        perf.perfCost.gap.multipleLabel,
        perf.perfCostAnchor.page.name,
      );
    }
    if (perf.perfCouldNotMeasure) perfFact.couldNotMeasure = true;
    facts.perf = perfFact;
  }
  if (a11y.hasA11y) {
    const a11yFact: NonNullable<NarrativeFacts['a11y']> = {
      status: a11y.a11yStatus,
      highImpact: a11y.highImpactTotal,
      lowerImpact: a11y.lowerImpactTotal,
      pagesWithBarriers: a11y.cardedA11y.length,
      topIssues: a11y.a11yTopIssues,
    };
    if (a11y.a11yWorst) a11yFact.worstPage = a11y.a11yWorst.page.name;
    if (a11y.a11yCouldNotMeasure) a11yFact.couldNotMeasure = true;
    facts.a11y = a11yFact;
  }
  if (input.hasAgent) {
    const agentFact: NonNullable<NarrativeFacts['agent']> = {
      status: agent.agentStatus,
      score: agent.agentOverall,
      accessBlocked: agent.agentAccessBlocked,
    };
    if (agent.agentCoveragePct !== undefined) agentFact.coveragePct = agent.agentCoveragePct;
    if (agent.agentCards[0]) agentFact.worstPage = agent.agentCards[0].name;
    if (agent.agentTopGap) agentFact.topGap = agent.agentTopGap;
    if (agent.agentCouldNotMeasure) agentFact.couldNotMeasure = true;
    facts.agent = agentFact;
  }
  return facts;
}

export function assembleClientReportModel(
  input: ClientReportReportInput,
  overlay: NarrativeOverlay | null,
): ClientReportModel {
  const { perf, a11y, agent } = input;
  const narrative = composeNarrative(buildClientReportNarrativeFacts(input), overlay);
  const tiles: ClientReportTile[] = [];
  if (perf.hasPerf) {
    const defaultPerfMetricSub = 'typical wait before a page is usable';
    const defaultPerfConseq = perf.perfStatus === 'good'
      ? 'Pages load fine on a phone, so visitors are not lost to waiting.'
      : `Phone visitors wait around ${input.avgMs !== undefined ? input.avgLabel : 'several seconds'} - long enough that many leave first.`;
    const dominantPerfTileCopy = perf.tilePerfProblem ? perfProblemTileCopy(perf.tilePerfProblem.problem) : undefined;
    const perfKicker = dominantPerfTileCopy?.kicker ?? 'Mobile speed';
    const perfWordTx = perf.perfCouldNotMeasure
      ? 'Could not measure'
      : dominantPerfTileCopy?.wordTx ?? narrative.perf.verdictWord;
    const perfMetricSub = perf.perfCouldNotMeasure
      ? 'no usable mobile speed data'
      : dominantPerfTileCopy?.metricSub(input.avgMs !== undefined ? input.avgLabel : undefined) ?? defaultPerfMetricSub;
    const perfConseq = perf.perfCouldNotMeasure
      ? 'The audit did not return enough mobile speed data to make a speed claim.'
      : dominantPerfTileCopy?.conseq ?? defaultPerfConseq;
    tiles.push({
      target: 'perf',
      kicker: perfKicker,
      status: perf.perfStatus,
      wordTx: perfWordTx,
      metric: perf.perfProblemMetricTx ?? (input.avgMs !== undefined ? input.avgLabel : 'n/a'),
      ...(dominantPerfTileCopy?.benchmarkTx ? { benchmarkTx: dominantPerfTileCopy.benchmarkTx } : {}),
      ...(dominantPerfTileCopy?.benchmarkHtml ? { benchmarkHtml: dominantPerfTileCopy.benchmarkHtml } : {}),
      ...(perf.perfProblemTx ? { problemTx: perf.perfProblemTx } : {}),
      metricSub: perfMetricSub,
      conseq: perfConseq,
      ...(perf.perfCouldNotMeasure ? { blocked: true } : {}),
    });
  }
  if (a11y.hasA11y) {
    tiles.push({
      target: 'a11y',
      kicker: 'Accessibility',
      status: a11y.a11yStatus,
      wordTx: narrative.a11y.verdictWord,
      metric: a11y.a11yCouldNotMeasure ? 'n/a' : String(a11y.highImpactTotal),
      metricSub: a11y.a11yCouldNotMeasure
        ? `${a11y.a11yBlocked.length} page${a11y.a11yBlocked.length === 1 ? '' : 's'} blocked by bot protection`
        : a11y.highImpactTotal > 0
          ? `high-impact issue${a11y.highImpactTotal === 1 ? '' : 's'} across ${a11y.cardedA11y.length} page${a11y.cardedA11y.length === 1 ? '' : 's'}`
          : `high-impact issues across ${a11y.a11yMeasurable.length} page${a11y.a11yMeasurable.length === 1 ? '' : 's'} checked`,
      conseq: a11y.a11yCouldNotMeasure
        ? "The site's bot protection served our checker a challenge page, so we could not measure this."
        : a11y.highImpactTotal > 0
          ? 'One blocking issue can turn a customer away - and the same fixes lift your SEO.'
          : a11y.lowerImpactTotal > 0
            ? 'Most visitors can use the site; only minor polish is left.'
            : 'No accessibility issues turned up on the pages we measured.',
      ...(a11y.a11yCouldNotMeasure ? { blocked: true } : {}),
    });
  }
  if (input.hasAgent) {
    tiles.push({
      target: 'agent',
      kicker: 'AI visibility',
      status: agent.agentStatus,
      wordTx: narrative.agent.verdictWord,
      metric: agent.agentCouldNotMeasure ? 'n/a' : String(agent.agentOverall),
      metricSub: agent.agentCouldNotMeasure
        ? `${agent.agentBlocked.length} page${agent.agentBlocked.length === 1 ? '' : 's'} blocked by bot protection`
        : 'out of 100 - avg page readability for AI',
      conseq: agent.agentCouldNotMeasure
        ? "The site's bot protection served our checker a challenge page, so we could not measure this."
        : agent.agentAccessBlocked
          ? 'AI crawlers are blocked, so AI answers will not recommend your site.'
          : agent.agentStatus === 'good'
            ? 'AI crawlers can already read most of your site and are allowed in.'
            : agent.agentStatus === 'fair'
              ? 'AI is allowed in, but misses content that loads after the page runs code.'
              : 'AI can read little of your site, so it rarely gets recommended.',
      ...(agent.agentCouldNotMeasure ? { blocked: true } : {}),
    });
  }
  const aspects: string[] = [];
  if (perf.hasPerf) aspects.push('stay');
  if (a11y.hasA11y) aspects.push('can use the page');
  if (input.hasAgent) aspects.push('get recommended by AI');
  const aspectList = aspects.length <= 1
    ? aspects[0] ?? 'have a good experience'
    : `${aspects.slice(0, -1).join(', ')}, and ${aspects[aspects.length - 1]}`;
  const lede = `We loaded ${input.measuredCount} of your pages the way a customer does - on a typical phone, on a normal cellular connection - and checked what decides whether visitors ${aspectList}.`;
  const outro = `The single fix behind most of this is making sure your full page content is present the moment the page loads - done well, it speeds the page up for real visitors${input.hasAgent ? ' and makes you readable to AI at the same time' : ''}. That is the work we do every day at ShakaCode; happy to walk through what we found.`;
  const footnoteAddenda: string[] = [];
  if ([perf.perfCost, agent.agentCost, a11y.a11yCost].some((cost) => cost?.state === 'measured')) footnoteAddenda.push(FOOTER_GUARDRAIL);
  const botWalledPageCount = new Set([...a11y.a11yBlocked, ...agent.agentBlocked].map((page) => `${page.path}|${page.name}`)).size;
  if (botWalledPageCount > 0) footnoteAddenda.push(botWallFooterSentence(botWalledPageCount));
  const footnoteBase = `Measured ${input.dateStr ? `${input.dateStr} ` : ''}on an emulated mid-range phone over ${input.footnoteThrottle} - the conditions a real mobile visitor faces, not a developer's laptop. Speed score is Google's 0-100 mobile scale (90+ is fast, under 50 is slow); layout shift is Google's CLS (above 0.25 is poor)${a11y.hasA11y ? '; accessibility score is the Google Lighthouse 0-100 scale - issue counts come from a deeper axe-core scan whose rules sit partly outside Lighthouse\'s scored set, so a high score can coexist with real issues' : ''}. Put together by ShakaCode.`;
  const footnote = footnoteAddenda.length ? `${footnoteBase} ${footnoteAddenda.map((sentence) => `${sentence}.`).join(' ')}` : footnoteBase;
  const tabOrder = ([
    ...(perf.hasPerf ? [{ dim: 'perf' as const, rank: dimSeverityRank(perf.perfStatus, perf.perfCouldNotMeasure) }] : []),
    ...(a11y.hasA11y ? [{ dim: 'a11y' as const, rank: dimSeverityRank(a11y.a11yStatus, a11y.a11yCouldNotMeasure) }] : []),
    ...(input.hasAgent ? [{ dim: 'agent' as const, rank: dimSeverityRank(agent.agentStatus, agent.agentCouldNotMeasure) }] : []),
  ])
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.dim);
  const model: ClientReportModel = {
    domain: input.domain,
    dateStr: input.dateStr,
    faviconLinkTag: input.faviconLinkTag,
    lede,
    tiles,
    tabOrder,
    hasPerf: perf.hasPerf,
    perfStatus: perf.perfStatus,
    ...(perf.perfScore !== undefined ? { perfScore: perf.perfScore } : {}),
    perfCouldNotMeasure: perf.perfCouldNotMeasure,
    perfCards: perf.perfCards,
    perfFine: perf.perfFine,
    hasA11y: a11y.hasA11y,
    a11yStatus: a11y.a11yStatus,
    ...(a11y.a11yScore !== undefined ? { a11yScore: a11y.a11yScore } : {}),
    a11yCards: a11y.a11yCards,
    a11yFine: a11y.a11yFine,
    ...(a11y.a11yStrongPageGroup ? { a11yStrongPageGroup: a11y.a11yStrongPageGroup } : {}),
    a11yBlocked: a11y.a11yBlocked,
    a11yCouldNotMeasure: a11y.a11yCouldNotMeasure,
    hasAgent: input.hasAgent,
    agentStatus: agent.agentStatus,
    ...(input.hasAgent && !agent.agentCouldNotMeasure ? { agentScore: agent.agentOverall } : {}),
    agentCards: agent.agentCards,
    agentFine: agent.agentFine,
    ...(agent.agentReading ? { agentReading: agent.agentReading } : {}),
    ...(agent.agentUnderstanding ? { agentUnderstanding: agent.agentUnderstanding } : {}),
    agentBlocked: agent.agentBlocked,
    agentCouldNotMeasure: agent.agentCouldNotMeasure,
    ...(perf.perfCost ? { perfCost: perf.perfCost } : {}),
    ...(a11y.a11yCost ? { a11yCost: a11y.a11yCost } : {}),
    ...(agent.agentCost ? { agentCost: agent.agentCost } : {}),
    narrative,
    outro,
    footnote,
  };
  if (agent.agentSite) model.agentSite = agent.agentSite;
  return model;
}
