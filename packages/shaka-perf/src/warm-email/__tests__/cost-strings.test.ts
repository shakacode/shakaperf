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
  AI_ZERO_COPY,
  A11Y_INDUSTRY_DATA_STATS,
  BOT_WALL_COPY,
  CALC_DIAL_LABEL,
  CALC_HONESTY_FOOTER,
  CALC_INQUIRIES_LABEL,
  CALC_PARTIAL_LINE,
  CALC_PRIVACY_LINE,
  CALC_SHARE_LABEL,
  CALC_TITLE,
  CALC_VALUE_LABEL,
  COST_CHIPS,
  COST_STATE_MATRIX,
  FOOTER_GUARDRAIL,
  INDUSTRY_DATA,
  NO_MATERIAL_LOSS,
  NOTHING_TO_FIX,
  PERF_INDUSTRY_DATA_STATS,
  PERF_ZERO_COPY,
  WHAT_THIS_AFFECTS,
  WHAT_THIS_COSTS_YOU,
  a11yNoNumberLine,
  aiCheckLine,
  aiHeadline,
  aiHeadlineSub,
  aiSingleCountLine,
  botWallFooterSentence,
  calcBreakEvenLine,
  calcCapNote,
  calcTinyResultLine,
  findBannedWords,
  perfCheckLine,
  perfGapHeadline,
  perfHeadline,
  perfStudiesFooter,
  perfStudiesIntro,
  type State,
  type Tab,
} from '../cost-strings';

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
      estimatorToggle: true,
    });
  });

  it('marks bot-wall measurements as not measured', () => {
    expect(COST_CHIPS['not measured'].label).toBe('not measured');
    expect(COST_CHIPS['not measured'].intent).toBe('blocked measurement');
  });

  it('marks owner arithmetic as your estimate without an estimator toggle', () => {
    expect(COST_CHIPS['your estimate']).toEqual({
      label: 'your estimate',
      intent: 'owner arithmetic',
      estimatorToggle: false,
    });
  });
});

describe('cost state matrix', () => {
  const expected: Record<Tab, Record<State, [boolean, boolean, boolean, boolean]>> = {
    ai: {
      measured: [true, true, true, true],
      zero: [false, false, false, true],
      blocked: [false, false, false, false],
      noclaim: [false, false, false, false],
    },
    perf: {
      measured: [true, true, true, true],
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
    expect(COST_STATE_MATRIX.ai.zero).toMatchObject({ copy: AI_ZERO_COPY, chip: 'measured' });
    expect(COST_STATE_MATRIX.perf.zero).toMatchObject({ copy: PERF_ZERO_COPY, chip: 'measured' });
    expect(COST_STATE_MATRIX.perf.measured.chip).toBe('measured');
    expect(COST_STATE_MATRIX.ai.blocked).toMatchObject({ copy: BOT_WALL_COPY, chip: 'not measured' });
    expect(COST_STATE_MATRIX.ai.noclaim).toMatchObject({ copy: 'almost no text to compare', rendersPercentageClaim: false });
    expect(COST_STATE_MATRIX.a11y.measured).toMatchObject({ copy: WHAT_THIS_AFFECTS, chip: 'measured' });
  });

  it('enables the calculator only for measured performance and benchmark scales for every zero state', () => {
    const calculatorCells = (Object.keys(COST_STATE_MATRIX) as Tab[]).flatMap((tab) =>
      (Object.keys(COST_STATE_MATRIX[tab]) as State[])
        .filter((state) => COST_STATE_MATRIX[tab][state].rendersCalculator)
        .map((state) => `${tab}.${state}`),
    );

    expect(calculatorCells).toEqual(['perf.measured']);
    for (const tab of Object.keys(COST_STATE_MATRIX) as Tab[]) {
      expect(COST_STATE_MATRIX[tab].zero.rendersBenchmarkScale).toBe(true);
    }
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
    expect(WHAT_THIS_COSTS_YOU).toBe('What this costs you');
    expect(FOOTER_GUARDRAIL).toBe('Measured on your site - every number links to its source');
    expect(botWallFooterSentence(2)).toBe('2 pages had at least one report section that could not be measured because bot protection served our checker a challenge page instead of the real page');
  });

  it('builds benchmark, study, count, and calculator copy', () => {
    expect(perfGapHeadline('10.3s', '4.1x', 'Home')).toBe(
      "Home shows its main content after 10.3s on a mid-range phone - 4.1x past Google's 2.5-second good line",
    );
    expect(perfGapHeadline('2.4s', undefined, 'Home')).toBe(
      'Home shows its main content after 2.4s on a mid-range phone',
    );
    expect(perfStudiesIntro()).toContain('None of these numbers are yours.');
    expect(perfStudiesFooter()).toContain('We use them for direction and rough size only.');
    expect(a11yNoNumberLine()).toContain('We put no visitor count on this');
    expect(aiSingleCountLine()).toContain('Visitor loss is counted once');
    expect(calcCapNote()).toBe(
      'The 15% top of this dial is not ours: Vodafone measured a 15% improvement in the lead-to-visit rate in a controlled test after improving LCP 31%. We cap the dial there anyway, because bigger gaps do not pay out in a straight line.',
    );
    expect(calcBreakEvenLine('$6,000')).toBe(
      'If a faster site brought back just one extra inquiry a month, that is $6,000 a year.',
    );
    expect(calcTinyResultLine()).toContain('Under $50 a month at your numbers');
  });

  it('keeps every new exported copy string free of banned vocabulary', () => {
    const strings = [
      WHAT_THIS_COSTS_YOU,
      PERF_ZERO_COPY,
      AI_ZERO_COPY,
      NO_MATERIAL_LOSS,
      perfGapHeadline('10.3s', '4.1x', 'Home'),
      perfGapHeadline('2.4s', undefined, 'Home'),
      perfStudiesIntro(),
      perfStudiesFooter(),
      a11yNoNumberLine(),
      aiSingleCountLine(),
      CALC_TITLE,
      CALC_INQUIRIES_LABEL,
      CALC_VALUE_LABEL,
      CALC_SHARE_LABEL,
      CALC_DIAL_LABEL,
      calcCapNote(),
      CALC_PRIVACY_LINE,
      CALC_PARTIAL_LINE,
      calcBreakEvenLine('$6,000'),
      calcTinyResultLine(),
      CALC_HONESTY_FOOTER,
      FOOTER_GUARDRAIL,
      COST_CHIPS['your estimate'].label,
      COST_CHIPS['your estimate'].intent,
      ...PERF_INDUSTRY_DATA_STATS.flatMap((stat) => Object.values(stat)),
    ];

    expect(strings.flatMap((text) => findBannedWords(text))).toEqual([]);
  });
});

describe('industry data stats', () => {
  it('exports exactly the sourced performance stat lines', () => {
    expect(PERF_INDUSTRY_DATA_STATS).toEqual([
      {
        text: 'a controlled test that improved LCP 31% lifted the lead-to-visit rate 15%',
        publisher: 'Vodafone with Google',
        date: '2021',
        url: 'https://web.dev/case-studies/vodafone',
        method: 'controlled test',
      },
      {
        text: 'a 0.1-second improvement across four mobile speed metrics came with 21.6% more visitors reaching the form-submission step on lead-generation sites, across 30M+ sessions',
        publisher: 'Deloitte, Milliseconds Make Millions',
        date: '2020',
        url: 'https://web.dev/case-studies/milliseconds-make-millions',
        method: 'correlation',
      },
      {
        text: 'a 2-second delay roughly doubled bounce rates (+103%)',
        publisher: 'Akamai / SOASTA',
        date: '2017',
        url: 'https://www.akamai.com/newsroom/press-release/akamai-releases-spring-2017-state-of-online-retail-performance-report',
        method: 'correlation',
      },
      {
        text: 'about 10% of visitors are lost for every extra second a page takes',
        publisher: 'BBC engineering',
        date: '2018',
        url: 'https://www.creativebloq.com/features/how-the-bbc-builds-websites-that-scale',
        method: 'correlation',
      },
    ]);
  });

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
