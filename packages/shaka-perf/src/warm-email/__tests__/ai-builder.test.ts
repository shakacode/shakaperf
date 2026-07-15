/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import { buildAgentSection, type AgentPromptContext } from '../client-report-model/ai';
import type { AgentPageView } from '../agent-ready-report';
import { scorePageStructure, type SiteAccessSignals } from '../agent-ready-score';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';
import type { PagePerf } from '../synthesis';

function signals(textWords: number): PageSignals {
  return {
    title: 'Example page', titlePresent: true,
    metaDescription: 'Example description', metaDescriptionPresent: true,
    canonical: true, lang: 'en', robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['Organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 3, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 4, nondescriptive: 0 },
    images: { total: 1, withAlt: 1 },
    textChars: textWords * 6, textWords,
  };
}

function agentView(rawWords: number | null, renderedWords: number, blocked = false): AgentPageView {
  const page: PagePerf = { id: 'home', name: 'Home', startingPath: '/', chips: [], metrics: {} };
  const result: AgentReadinessResult = {
    url: 'https://example.com/',
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 } as AgentReadinessResult['viewport'],
    fetchedAt: '2026-07-10T00:00:00.000Z',
    raw: { ok: rawWords !== null, status: blocked ? 403 : 200, likelyBlocked: blocked, signals: rawWords === null ? null : signals(rawWords) },
    rendered: signals(renderedWords),
    rawHtmlBytes: rawWords === null ? 0 : 1000,
    renderedHtmlBytes: 5000,
    ...(blocked ? { blocked: true } : {}),
  };
  return { page, result, struct: scorePageStructure(result) };
}

const promptCtx: AgentPromptContext = {
  siteUrl: 'https://example.com', host: 'example.com', date: 'July 10, 2026', conditions: 'phone on Slow-4G',
};

const noGuide: SiteAccessSignals = {
  robots: { fetched: true, blocksAiBots: [], blocksAll: false },
  sitemap: true,
  llmsTxt: false,
  llmsTxtConfirmedAbsent: true,
};

describe('buildAgentSection', () => {
  it('builds a measured AI visibility block directly from hand-built page facts', () => {
    const result = buildAgentSection([agentView(50, 100)], [], promptCtx, noGuide);

    expect(result.agentCost).toMatchObject({
      state: 'measured',
      aiTiles: { invisiblePercent: 50, readableWords: 50, totalWords: 100 },
      fix: { tone: 'secondary' },
    });
  });

  it('does not add the optional llms.txt fix without site-access data', () => {
    const result = buildAgentSection([agentView(50, 100)], [], promptCtx, undefined);

    expect(result.agentCost?.fix).toBeUndefined();
  });

  it('uses the zero state at the inclusive ten-percent missing-text floor', () => {
    const result = buildAgentSection([agentView(90, 100)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'zero' });
    expect(result.agentCards).toHaveLength(0);
    expect(result.agentCost?.strongPageGroup?.pages).toEqual([{ name: 'Home', score: 90 }]);
  });

  it('uses the measured state immediately above the ten-percent missing-text floor', () => {
    const result = buildAgentSection([agentView(89, 100)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'measured' });
    expect(result.agentCards.map((card) => card.name)).toEqual(['Home']);
    expect(result.agentFine).toHaveLength(0);
    expect(result.agentCost?.strongPageGroup).toBeUndefined();
  });

  it('keeps too-little-text pages out of the verified fine-page group', () => {
    const result = buildAgentSection([agentView(10, 10)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'noclaim' });
    expect(result.agentCards.map((card) => card.name)).toEqual(['Home']);
    expect(result.agentCost?.strongPageGroup).toBeUndefined();
  });

  it('keeps a non-blocked raw-fetch failure out of the verified fine-page group', () => {
    const result = buildAgentSection([agentView(null, 10)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'noclaim' });
    expect(result.agentCards.map((card) => card.name)).toEqual(['Home']);
    expect(result.agentCost?.strongPageGroup).toBeUndefined();
  });

  it('uses the blocked state when no server-readable page facts exist', () => {
    const result = buildAgentSection([agentView(null, 100, true)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'blocked' });
  });
});
