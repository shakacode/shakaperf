/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  pageFindings as agentPageFindings,
  pageLead as agentPageLead,
  type AgentPageView,
} from '../agent-ready-report';
import { scoreSite, type CategoryScore, type SiteAccessSignals } from '../agent-ready-score';
import { AI_INDUSTRY_DATA_STATS, aiCheckLine, aiHeadline, aiHeadlineSub, aiSingleCountLine, aiSiteWideContextLine } from '../cost-strings';
import { buildCopyPrompt } from '../copy-prompt';
import type {
  ClientReportAgentCard,
  ClientReportBlockedPage,
  ClientReportCostBlock,
  ClientReportModel,
  ClientReportStatus,
} from '../client-report-renderer';
import { MAX_MISSING_AI_TEXT_SHARE_FOR_ZERO } from './cost';
import { SCORE_BADGE_POLICY, scoreStatus } from './perf';
import { dashSafe, liveUrlFor } from './shared';

const AGENT_FACTOR_NAME: Record<string, string> = {
  ssr: 'Readable without running code',
  structure: 'Labeled so AI knows what it is',
  semantics: 'Clear structure & enough text',
};

const AI_AFFECTS_PROSE = 'AI search and answer tools usually read the HTML first. If your real page text only appears after browser code runs, they may miss what you sell, answer without your site, or cite a competitor instead.';
const MIN_AGENT_COST_WORDS = 20;

export interface AgentPromptContext {
  siteUrl: string;
  host: string;
  date: string;
  conditions: string;
}

export interface AgentSection {
  agentSite?: ClientReportModel['agentSite'];
  agentCards: ClientReportAgentCard[];
  agentFine: ClientReportModel['agentFine'];
  agentStatus: ClientReportStatus;
  agentOverall: number;
  agentAccessBlocked: boolean;
  agentCoveragePct?: number;
  agentTopGap?: string;
  agentBlocked: ClientReportBlockedPage[];
  agentCouldNotMeasure: boolean;
  agentCost?: ClientReportCostBlock;
}

function agentFactor(cat: CategoryScore): { name: string; score: number; status: ClientReportStatus } {
  const frac = cat.max > 0 ? cat.points / cat.max : 1;
  const status: ClientReportStatus = frac >= 0.8 ? 'good' : frac >= 0.5 ? 'fair' : 'poor';
  return { name: AGENT_FACTOR_NAME[cat.id] ?? cat.name, score: Math.round(frac * 100), status };
}

function agentRawStateForPrompt(view: AgentPageView): string {
  if (view.struct.rawReachable) return 'ok';
  return view.result.raw.likelyBlocked ? 'blocked' : 'failed';
}

function agentRawWords(view: AgentPageView): number {
  return view.result.raw.signals?.textWords ?? 0;
}

function agentRenderedWords(view: AgentPageView): number {
  return view.result.rendered.textWords;
}

function boundedCoverageRatio(rawWords: number, renderedWords: number): number {
  if (renderedWords <= 0) return 0;
  return Math.max(0, Math.min(1, rawWords / renderedWords));
}

function boundedCoveragePct(rawWords: number, renderedWords: number): number {
  return Math.round(boundedCoverageRatio(rawWords, renderedWords) * 100);
}

function boundedPresentWords(rawWords: number, renderedWords: number): number {
  return Math.max(0, Math.min(rawWords, renderedWords));
}

function missingRenderedWords(view: AgentPageView): number {
  return Math.max(0, agentRenderedWords(view) - boundedPresentWords(agentRawWords(view), agentRenderedWords(view)));
}

function requiresAgentCard(view: AgentPageView): boolean {
  const renderedWords = agentRenderedWords(view);
  if (!view.struct.rawReachable || renderedWords < MIN_AGENT_COST_WORDS) return true;
  return 1 - boundedCoverageRatio(agentRawWords(view), renderedWords) > MAX_MISSING_AI_TEXT_SHARE_FOR_ZERO;
}

function agentPromptForView(view: AgentPageView, ctx: AgentPromptContext, coveragePct: number): string | undefined {
  if (!view.struct.rawReachable) return undefined;
  const url = liveUrlFor(ctx.siteUrl, view.page.startingPath || '/') || view.result.url || ctx.siteUrl;
  return buildCopyPrompt('ai', {
    url,
    host: ctx.host,
    date: ctx.date,
    conditions: ctx.conditions,
    coveragePct,
    rawWords: agentRawWords(view),
    renderedWords: agentRenderedWords(view),
    headings: view.result.rendered.headings.total,
    links: view.result.rendered.links.total,
    textSample: view.result.rendered.textSample,
    rawState: agentRawStateForPrompt(view),
  });
}

function compareAgentCostPage(a: AgentPageView, b: AgentPageView): number {
  const coverageA = boundedCoverageRatio(agentRawWords(a), agentRenderedWords(a));
  const coverageB = boundedCoverageRatio(agentRawWords(b), agentRenderedWords(b));
  if (coverageA !== coverageB) return coverageA - coverageB;
  const missingA = missingRenderedWords(a);
  const missingB = missingRenderedWords(b);
  if (missingA !== missingB) return missingB - missingA;
  return a.page.startingPath.localeCompare(b.page.startingPath);
}

function agentCardModel(view: AgentPageView, promptCtx: AgentPromptContext): ClientReportAgentCard {
  const { page, struct } = view;
  const lead = agentPageLead(view);
  const needsScoreAttention = scoreStatus(struct.score) !== 'good' && lead.status === 'good';
  const fixes = view.client?.fixes?.length
    ? view.client.fixes.map(dashSafe)
    : Array.from(new Set(agentPageFindings(struct).map((finding) => finding.action).filter((action): action is string => !!action))).slice(0, 3).map(dashSafe);
  const card: ClientReportAgentCard = {
    name: page.name,
    path: page.startingPath || '/',
    score: struct.score,
    status: scoreStatus(struct.score),
    capped: struct.shellCapped,
    headlineHtml: needsScoreAttention
      ? 'Readable for AI tools, with details still to improve'
      : lead.headline,
    factors: struct.categories.map(agentFactor),
    fixes,
  };
  if (needsScoreAttention) card.sub = 'The page is readable, but its remaining structure details still need attention.';
  else if (lead.note) card.sub = lead.note;
  const copyPrompt = agentPromptForView(view, promptCtx, boundedCoveragePct(agentRawWords(view), agentRenderedWords(view)));
  if (copyPrompt) card.copyPrompt = copyPrompt;
  return card;
}

export function buildAgentSection(
  agentViews: readonly AgentPageView[],
  agentBlocked: ClientReportBlockedPage[],
  agentPromptCtx: AgentPromptContext,
  siteSignals: SiteAccessSignals | undefined,
): AgentSection {
  const agentMeasurable = agentViews;
  const agentCouldNotMeasure = agentMeasurable.length === 0 && agentBlocked.length > 0;
  if (agentCouldNotMeasure) {
    return {
      agentCards: [],
      agentFine: [],
      agentStatus: 'good',
      agentOverall: 0,
      agentAccessBlocked: false,
      agentBlocked,
      agentCouldNotMeasure,
      agentCost: { tab: 'ai', state: 'blocked' },
    };
  }
  if (agentMeasurable.length === 0) {
    return {
      agentCards: [],
      agentFine: [],
      agentStatus: 'good',
      agentOverall: 0,
      agentAccessBlocked: false,
      agentBlocked,
      agentCouldNotMeasure,
    };
  }

  const overall = scoreSite(agentMeasurable.map((view) => view.result), siteSignals);
  const agentStatus = scoreStatus(overall.overall);
  const cardViews = agentMeasurable.filter(requiresAgentCard);
  const fineViews = agentMeasurable.filter((view) => !requiresAgentCard(view));
  const reachableForCost = agentMeasurable.filter((view) => view.struct.rawReachable);
  const siteWideReadable = reachableForCost.length > 0 && reachableForCost.length === agentMeasurable.length
    ? boundedCoveragePct(
      reachableForCost.reduce((sum, view) => sum + agentRawWords(view), 0),
      reachableForCost.reduce((sum, view) => sum + agentRenderedWords(view), 0),
    )
    : undefined;
  const claimableForCost = reachableForCost.filter((view) => agentRenderedWords(view) >= MIN_AGENT_COST_WORDS);
  const renderedWords = reachableForCost.reduce((sum, view) => sum + agentRenderedWords(view), 0);
  const allRenderedWords = agentMeasurable.reduce((sum, view) => sum + agentRenderedWords(view), 0);
  const worstCostPage = [...claimableForCost].sort(compareAgentCostPage)[0];
  const worstRawWords = worstCostPage ? agentRawWords(worstCostPage) : 0;
  const worstRenderedWords = worstCostPage ? agentRenderedWords(worstCostPage) : 0;
  const worstCoveragePct = boundedCoveragePct(worstRawWords, worstRenderedWords);
  const worstMissingShare = 1 - boundedCoverageRatio(worstRawWords, worstRenderedWords);
  const worstMissingPct = 100 - worstCoveragePct;
  const worstPresentWords = boundedPresentWords(worstRawWords, worstRenderedWords);
  const homepageCostPage = reachableForCost.find((view) => view.page.startingPath === '/');
  const homepageRawWords = homepageCostPage ? agentRawWords(homepageCostPage) : 0;
  const homepageRenderedWords = homepageCostPage ? agentRenderedWords(homepageCostPage) : 0;
  const homepagePresentWords = boundedPresentWords(homepageRawWords, homepageRenderedWords);
  const homepageInvisiblePct = 100 - boundedCoveragePct(homepageRawWords, homepageRenderedWords);
  const costPageLabel = worstCostPage?.page.startingPath === '/'
    ? 'homepage'
    : worstCostPage?.page.name.toLowerCase() ?? 'page';
  const aiAffects = `${AI_AFFECTS_PROSE} ${aiSingleCountLine()}`;
  const aiFix = siteSignals?.llmsTxtConfirmedAbsent === true
    ? {
      tone: 'secondary' as const,
      text: 'One optional addition: an llms.txt file - a short plain-text guide some AI crawlers read to find your key pages. Minutes to add, small upside, zero risk.',
    }
    : undefined;
  let agentCostState: ClientReportCostBlock['state'];
  if (allRenderedWords < MIN_AGENT_COST_WORDS || (reachableForCost.length > 0 && (renderedWords < MIN_AGENT_COST_WORDS || claimableForCost.length === 0))) {
    agentCostState = 'noclaim';
  } else if (reachableForCost.length === 0) {
    agentCostState = 'blocked';
  } else if (worstMissingShare <= MAX_MISSING_AI_TEXT_SHARE_FOR_ZERO) {
    agentCostState = 'zero';
  } else {
    agentCostState = 'measured';
  }
  let agentCost: ClientReportCostBlock = { tab: 'ai', state: agentCostState };
  if (agentCostState === 'blocked') {
    agentCost = {
      tab: 'ai',
      state: 'blocked',
      headline: 'We could not read the page the server sends, so this text gap was not measured.',
    };
  }
  if (agentCostState === 'measured' && worstCostPage) {
    const worstUrl = liveUrlFor(agentPromptCtx.siteUrl, worstCostPage.page.startingPath || '/') || worstCostPage.result.url || agentPromptCtx.siteUrl;
    agentCost = {
      tab: 'ai',
      state: 'measured',
      headline: aiHeadline(worstMissingPct, worstPresentWords, worstRenderedWords),
      headlineSub: [
        aiHeadlineSub(worstPresentWords, worstRenderedWords),
        ...(siteWideReadable === undefined || worstCoveragePct >= siteWideReadable
          ? []
          : [aiSiteWideContextLine(siteWideReadable, costPageLabel)]),
      ].join(' '),
      chip: 'measured',
      checkLine: aiCheckLine(worstUrl),
      affectsProse: aiAffects,
      sitePrompt: buildCopyPrompt('ai', {
        url: worstUrl,
        host: agentPromptCtx.host,
        date: agentPromptCtx.date,
        conditions: agentPromptCtx.conditions,
        coveragePct: worstCoveragePct,
        rawWords: worstRawWords,
        renderedWords: worstRenderedWords,
        headings: worstCostPage.result.rendered.headings.total,
        links: worstCostPage.result.rendered.links.total,
        textSample: worstCostPage.result.rendered.textSample,
        rawState: agentRawStateForPrompt(worstCostPage),
      }),
      stats: [...AI_INDUSTRY_DATA_STATS],
      ...(homepageCostPage && homepageRenderedWords >= MIN_AGENT_COST_WORDS ? {
        aiTiles: {
          invisiblePercent: homepageInvisiblePct,
          readableWords: homepagePresentWords,
          totalWords: homepageRenderedWords,
        },
      } : {}),
      stakes: {
        kind: 'at-risk',
        prose: AI_AFFECTS_PROSE,
        studies: AI_INDUSTRY_DATA_STATS,
      },
      ...(aiFix ? { fix: aiFix } : {}),
      scoreBadgePolicy: SCORE_BADGE_POLICY,
    };
  } else if (agentCostState === 'zero' && worstCostPage) {
    agentCost = {
      tab: 'ai',
      state: 'zero',
      headlineSub: aiHeadlineSub(worstPresentWords, worstRenderedWords),
      affectsProse: aiAffects,
      stakes: {
        kind: 'no-material-loss',
        prose: 'When someone asks ChatGPT, Claude, or Perplexity about what you do, your pages can be read and quoted. Many sites fail this check outright.',
        studies: AI_INDUSTRY_DATA_STATS,
        expanderIntro: 'These are the studies behind this check - they describe a risk your site is not exposed to.',
      },
      ...(aiFix ? { fix: aiFix } : {}),
      scoreBadgePolicy: SCORE_BADGE_POLICY,
    };
  }
  const agentCards = cardViews.map((view) => agentCardModel(view, agentPromptCtx));
  const firstGap = cardViews[0] ? agentPageFindings(cardViews[0].struct)[0] : undefined;
  const agentFine = fineViews.map((view) => ({
    name: view.page.name,
    path: view.page.startingPath || '/',
    score: view.struct.score,
    status: scoreStatus(view.struct.score),
  }));
  if (agentFine.length > 0) {
    agentCost.strongPageGroup = {
      label: 'Strong pages',
      pages: agentFine.map(({ name, score }) => ({ name, score })),
    };
  }
  return {
    agentSite: {
      score: overall.access.score,
      status: scoreStatus(overall.access.score),
      checks: overall.access.category.items.map((item) => ({
        ok: item.state === 'pass' ? 'ok' : item.state === 'na' ? 'na' : 'bad',
        tx: dashSafe(item.detail),
      })),
    },
    agentCards,
    agentFine,
    agentStatus,
    agentOverall: overall.overall,
    agentAccessBlocked: overall.accessBlocked,
    ...(siteWideReadable !== undefined ? { agentCoveragePct: siteWideReadable } : {}),
    ...(firstGap?.label ? { agentTopGap: firstGap.label.toLowerCase() } : {}),
    agentBlocked,
    agentCouldNotMeasure,
    agentCost,
  };
}
