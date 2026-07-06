/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  AI_INDUSTRY_DATA_STATS,
  A11Y_INDUSTRY_DATA_STATS,
  BOT_WALL_COPY,
  COST_CHIPS,
  COST_STATE_MATRIX,
  FOOTER_GUARDRAIL,
  INDUSTRY_DATA,
  NOTHING_TO_FIX,
  WHAT_THIS_AFFECTS,
  aiCheckLine,
  aiHeadline,
  aiHeadlineSub,
  botWallFooterSentence,
  dataCostEstimatedLine,
  dataCostFormula,
  dataCostMeasuredLine,
  findBannedWords,
  perfCheckLine,
  perfHeadline,
  type State,
  type Tab,
} from '../cost-strings';
import { MOBILE_DATA_PRICE_USD_PER_MB_HIGH, MOBILE_DATA_PRICE_USD_PER_MB_LOW } from '../cost-model';

describe('findBannedWords', () => {
  it('finds banned report vocabulary case-insensitively', () => {
    expect(findBannedWords('AI assistants read this')).toEqual(['assistants']);
  });

  it('returns an empty array for clean text', () => {
    expect(findBannedWords('AI crawlers read this page')).toEqual([]);
  });

  it('uses word boundaries for normal words and handles the hyphenated entry', () => {
    expect(findBannedWords('An omnichannel plan is not the same as zero-click search.')).toEqual(['zero-click']);
  });
});

describe('cost chips', () => {
  it('keeps estimated values marked as estimates with a math toggle', () => {
    expect(COST_CHIPS.estimated).toEqual({
      label: 'estimated',
      intent: 'calculated estimate',
      valuePrefix: '~=',
      estimatorToggle: true,
    });
  });

  it('marks bot-wall measurements as not measured', () => {
    expect(COST_CHIPS['not measured'].label).toBe('not measured');
    expect(COST_CHIPS['not measured'].intent).toBe('blocked measurement');
  });
});

describe('cost state matrix', () => {
  const expected: Record<Tab, Record<State, [boolean, boolean, boolean, boolean]>> = {
    ai: {
      measured: [true, true, true, true],
      zero: [false, false, false, false],
      blocked: [false, false, false, false],
      noclaim: [false, false, false, false],
    },
    perf: {
      measured: [true, true, true, false],
      zero: [false, false, false, false],
      blocked: [false, false, false, false],
      noclaim: [false, false, false, false],
    },
    a11y: {
      measured: [true, false, true, false],
      zero: [false, false, false, false],
      blocked: [false, false, false, false],
      noclaim: [false, false, false, false],
    },
  };

  it('matches the per-tab per-state render rules', () => {
    for (const tab of Object.keys(expected) as Tab[]) {
      for (const state of Object.keys(expected[tab]) as State[]) {
        const cell = COST_STATE_MATRIX[tab][state];
        expect([
          cell.rendersFullTreatment,
          cell.rendersCostNumber,
          cell.rendersCopyPromptButton,
          cell.rendersIndustryDataExpander,
        ]).toEqual(expected[tab][state]);
      }
    }
  });

  it('keeps state-specific copy and chips in the table', () => {
    expect(COST_STATE_MATRIX.ai.zero).toMatchObject({ copy: NOTHING_TO_FIX, chip: 'measured' });
    expect(COST_STATE_MATRIX.ai.blocked).toMatchObject({ copy: BOT_WALL_COPY, chip: 'not measured' });
    expect(COST_STATE_MATRIX.ai.noclaim).toMatchObject({ copy: 'almost no text to compare', rendersPercentageClaim: false });
    expect(COST_STATE_MATRIX.a11y.measured).toMatchObject({ copy: WHAT_THIS_AFFECTS, chip: 'measured' });
  });
});

describe('canonical cost copy', () => {
  it('builds AI headline, subline, and self-check text', () => {
    expect(aiHeadline(58, 42, 100)).toBe("58% of your page's text is missing from the page the server sends, before any JavaScript runs");
    expect(aiHeadlineSub(42, 100)).toBe('only 42 of 100 words present');
    expect(aiCheckLine('https://example.com/a')).toBe('check it yourself: open view-source:https://example.com/a and search for a sentence from your page');
  });

  it('builds performance headline and profile-aware PSI check lines', () => {
    expect(perfHeadline('6.2s', 'Home')).toBe('6.2s before your main content appears on a mid-range phone');
    expect(perfCheckLine('https://example.com/a?b=1', true)).toBe(
      'check it yourself: run PageSpeed Insights on this page - same phone and network profile we used: https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
    );
    expect(perfCheckLine('https://example.com/a', false, '4G Fast / Moto G4')).toContain(
      "(Google's standard phone profile; we used 4G Fast / Moto G4, so numbers may differ)",
    );
  });

  it('exports shared labels and footer guardrails', () => {
    expect(WHAT_THIS_AFFECTS).toBe('What this affects');
    expect(INDUSTRY_DATA).toBe('industry data');
    expect(NOTHING_TO_FIX).toBe('Nothing to fix here');
    expect(FOOTER_GUARDRAIL).toBe('measured on your site - estimates are labeled and show their math - every number links to its source');
    expect(botWallFooterSentence(2)).toBe('2 pages could not be measured because bot protection served our checker a challenge page instead of the real page');
  });

  it('builds data-cost measured, estimated, and formula lines', () => {
    expect(dataCostMeasuredLine('12.5 MB')).toBe('each visit to this page downloads 12.5 MB');
    expect(dataCostEstimatedLine('~= $0.03-0.08')).toBe('~= $0.03-0.08 of mobile data per visit');
    expect(dataCostFormula('12.5 MB')).toBe(
      `12.5 MB measured on this page x $${MOBILE_DATA_PRICE_USD_PER_MB_LOW}-${MOBILE_DATA_PRICE_USD_PER_MB_HIGH} per MB (cable.co.uk worldwide average / US price)`,
    );
  });
});

describe('industry data stats', () => {
  it('exports exactly the sourced AI stat lines', () => {
    expect(AI_INDUSTRY_DATA_STATS).toEqual([
      {
        text: 'Google AI answers cut organic clicks up to 58% on the first result',
        publisher: 'Ahrefs',
        date: 'Dec 2025',
        url: 'https://ahrefs.com/blog/ai-overviews-reduce-clicks-update/',
      },
      {
        text: 'organic click-through fell 61% on AI-overview queries; pages cited in the answer got +35% clicks',
        publisher: 'Seer',
        date: 'Sep 2025',
        url: 'https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update',
      },
      {
        text: '69% of Google searches now end without a click, up from 56% a year earlier',
        publisher: 'Similarweb',
        date: 'May 2025',
        url: 'https://www.similarweb.com',
      },
      {
        text: 'major AI crawlers fetch HTML but execute 0% of JavaScript',
        publisher: 'Vercel',
        date: 'Dec 2024',
        url: 'https://vercel.com/blog/the-rise-of-the-ai-crawler',
      },
      {
        text: 'fully client-rendered pages returned blank to ChatGPT, Perplexity, and Claude',
        publisher: 'GSQI',
        date: 'Aug 2025',
        url: 'https://www.gsqi.com/marketing-blog/ai-search-javascript-rendering/',
      },
    ]);
  });

  it('keeps accessibility stats empty until a verified behavioral stat exists', () => {
    expect(A11Y_INDUSTRY_DATA_STATS).toEqual([]);
  });
});
