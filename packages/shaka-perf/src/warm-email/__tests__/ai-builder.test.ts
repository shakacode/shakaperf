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

function signals(textWords: number, poorStructure = false): PageSignals {
  return {
    title: poorStructure ? '' : 'Example page', titlePresent: !poorStructure,
    metaDescription: poorStructure ? '' : 'Example description', metaDescriptionPresent: !poorStructure,
    canonical: !poorStructure, lang: poorStructure ? '' : 'en', robotsMeta: '',
    og: { title: !poorStructure, description: !poorStructure, image: !poorStructure, type: !poorStructure, siteName: !poorStructure },
    twitterCard: !poorStructure,
    structuredData: poorStructure
      ? { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 }
      : { blocks: 1, valid: 1, invalid: 0, types: ['Organization'], microdataItems: 0 },
    headings: { h1Count: poorStructure ? 0 : 1, total: poorStructure ? 0 : 3, orderOk: !poorStructure },
    landmarks: { main: !poorStructure, nav: !poorStructure, header: !poorStructure, footer: !poorStructure, article: false },
    links: { total: 4, nondescriptive: poorStructure ? 4 : 0 },
    images: { total: 1, withAlt: poorStructure ? 0 : 1 },
    textChars: textWords * 6, textWords,
  };
}

function agentView(rawWords: number | null, renderedWords: number, blocked = false, poorStructure = false): AgentPageView {
  const page: PagePerf = { id: 'home', name: 'Home', startingPath: '/', chips: [], metrics: {} };
  const result: AgentReadinessResult = {
    url: 'https://example.com/',
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 } as AgentReadinessResult['viewport'],
    fetchedAt: '2026-07-10T00:00:00.000Z',
    raw: { ok: rawWords !== null, status: blocked ? 403 : 200, likelyBlocked: blocked, signals: rawWords === null ? null : signals(rawWords, poorStructure) },
    rendered: signals(renderedWords, poorStructure),
    rawHtmlBytes: rawWords === null ? 0 : 1000,
    renderedHtmlBytes: 5000,
    ...(blocked ? { blocked: true } : {}),
  };
  return { page, result, struct: scorePageStructure(result) };
}

function fairStructureView(): AgentPageView {
  const view = agentView(100, 100);
  view.result.rendered = {
    ...view.result.rendered,
    title: '',
    titlePresent: false,
    metaDescription: '',
    metaDescriptionPresent: false,
    canonical: false,
    lang: '',
    og: { title: false, description: false, image: false, type: false, siteName: false },
    twitterCard: false,
    structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 },
  };
  view.struct = scorePageStructure(view.result);
  return view;
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

  it('does not mistake sitemap or indexing deductions for blocked AI crawlers', () => {
    const result = buildAgentSection([agentView(100, 100)], [], promptCtx, {
      ...noGuide,
      sitemap: false,
    });

    expect(result.agentSite?.status).toBe('fair');
    expect(result.agentReading).toEqual({
      status: 'good',
      verdict: 'Yes - your text is served before JavaScript and AI crawlers are allowed in.',
    });
  });

  it('reports partial crawler permission only when the crawler check is partial', () => {
    const result = buildAgentSection([agentView(100, 100)], [], promptCtx, {
      ...noGuide,
      robots: { fetched: true, blocksAiBots: ['OAI-SearchBot'], blocksAll: false },
    });

    expect(result.agentReading).toEqual({
      status: 'fair',
      verdict: 'Only partly - some AI crawlers are not allowed in.',
    });
  });

  it('uses the worst page rather than average coverage for the reading verdict', () => {
    const result = buildAgentSection([
      agentView(2000, 2000),
      agentView(0, 100),
    ], [], promptCtx, noGuide);

    expect(result.agentReading).toEqual({
      status: 'fair',
      verdict: 'Only partly - some of your text still needs JavaScript before AI can read it.',
    });
  });

  it('does not claim every page is readable when some results are unconfirmed', () => {
    const failedFetch = buildAgentSection([
      agentView(100, 100),
      agentView(null, 100),
    ], [], promptCtx, noGuide);
    const blockedPage = buildAgentSection(
      [agentView(100, 100)],
      [{ name: 'Contact', path: '/contact' }],
      promptCtx,
      noGuide,
    );

    expect(failedFetch.agentReading).toEqual({
      status: 'fair',
      verdict: 'Only partly - we could not confirm that AI can read every page we checked.',
    });
    expect(blockedPage.agentReading).toEqual(failedFetch.agentReading);
  });

  it('uses the zero state at the inclusive ten-percent missing-text floor', () => {
    const result = buildAgentSection([agentView(90, 100)], [], promptCtx, undefined);

    expect(result.agentCost).toMatchObject({ tab: 'ai', state: 'zero' });
    expect(result.agentCards).toHaveLength(0);
    expect(result.agentCost?.strongPageGroup?.pages).toEqual([{ name: 'Home', score: 90 }]);
    expect(result.agentCost?.strongPageGroup?.verdict).toBeUndefined();
  });

  it('labels a readable group as only fair when its worst page is below the good bucket', () => {
    const result = buildAgentSection([fairStructureView()], [], promptCtx, noGuide);

    expect(result.agentFine).toHaveLength(1);
    expect(result.agentFine[0].score).toBeGreaterThanOrEqual(50);
    expect(result.agentFine[0].score).toBeLessThan(80);
    expect(result.agentCost?.strongPageGroup?.verdict).toBe('1 page is readable, but only fair');
    expect(result.agentReading).toEqual({
      status: 'good',
      verdict: 'Yes - your text is served before JavaScript and AI crawlers are allowed in.',
    });
    expect(result.agentUnderstanding).toMatchObject({
      status: 'fair',
      verdict: 'Only partly - the labels machines rely on are missing.',
    });
    expect(result.agentUnderstanding?.items.map((item) => item.label)).toEqual(expect.arrayContaining([
      'Structured data',
      'Meta description',
      'Social preview tags',
    ]));
  });

  it('keeps a good understanding zone as a green one-line verdict', () => {
    const result = buildAgentSection([agentView(100, 100)], [], promptCtx, noGuide);

    expect(result.agentUnderstanding).toEqual({
      status: 'good',
      verdict: 'Labeling is in place.',
      items: [],
    });
  });

  it('adds score context to the green text-coverage proof when the site is not good', () => {
    const result = buildAgentSection([fairStructureView()], [], promptCtx, undefined);

    expect(result.agentStatus).toBe('fair');
    expect(result.agentCost?.stakes?.prose).toContain('Being readable is the pass/fail part; the page scores below show the labeling polish still left.');
  });

  it('keeps a fully server-readable page card when its structural score is poor', () => {
    const page = agentView(100, 100, false, true);
    expect(page.struct.bucket).toBe('poor');

    const result = buildAgentSection([page], [], promptCtx, undefined);

    expect(result.agentCards.map((card) => card.name)).toEqual(['Home']);
    expect(result.agentCost?.strongPageGroup).toBeUndefined();
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
