/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export const BANNED_WORDS = ['assistants', 'absent', 'costing', 'channel', 'zero-click', 'modeled', 'Pew'] as const;

export function findBannedWords(text: string): string[] {
  return BANNED_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
    return pattern.test(text);
  });
}

export type CostChip = 'measured' | 'estimated' | 'your estimate' | 'not measured';

export interface CostChipCopy {
  label: string;
  intent: 'site measurement' | 'calculated estimate' | 'owner arithmetic' | 'blocked measurement';
  estimatorToggle: boolean;
}

export const COST_CHIPS: Record<CostChip, CostChipCopy> = {
  measured: {
    label: 'measured',
    intent: 'site measurement',
    estimatorToggle: false,
  },
  estimated: {
    label: 'estimated',
    intent: 'calculated estimate',
    estimatorToggle: true,
  },
  'your estimate': {
    label: 'your estimate',
    intent: 'owner arithmetic',
    estimatorToggle: false,
  },
  'not measured': {
    label: 'not measured',
    intent: 'blocked measurement',
    estimatorToggle: false,
  },
};

export const COST_CHIP_LABELS: Record<CostChip, string> = {
  measured: COST_CHIPS.measured.label,
  estimated: COST_CHIPS.estimated.label,
  'your estimate': COST_CHIPS['your estimate'].label,
  'not measured': COST_CHIPS['not measured'].label,
};

export type Tab = 'ai' | 'perf' | 'a11y';
export type State = 'measured' | 'zero' | 'blocked' | 'noclaim';

export interface CostStateCell {
  rendersFullTreatment: boolean;
  rendersCostNumber: boolean;
  rendersCopyPromptButton: boolean;
  rendersIndustryDataExpander: boolean;
  chip?: CostChip;
  copy?: string;
  rendersPercentageClaim?: boolean;
  // Wave 2 consumes these additive flags.
  rendersBenchmarkScale?: boolean;
  rendersCalculator?: boolean;
  rendersCheckLine?: boolean;
}

export const WHAT_THIS_AFFECTS = 'What this affects';
export const WHAT_THIS_COSTS_YOU = 'What this costs you';
export const INDUSTRY_DATA = 'industry data';
export const NOTHING_TO_FIX = 'Nothing to fix here';
export const PERF_ZERO_COPY = "Under Google's 2.5-second line on every page we measured - no material loss here.";
export const AI_ZERO_COPY = 'AI tools can already read your site - no material loss here.';
export const NO_MATERIAL_LOSS = 'No material loss here.';
export const BOT_WALL_COPY =
  "The site's bot protection served our checker a challenge page instead of the real page, so this could not be measured. Allowlist our checker and we will re-run a clean pass.";
export const FOOTER_GUARDRAIL = 'Measured on your site - every number links to its source';

const noTreatment = (copy?: string, chip?: CostChip): CostStateCell => ({
  rendersFullTreatment: false,
  rendersCostNumber: false,
  rendersCopyPromptButton: false,
  rendersIndustryDataExpander: false,
  chip,
  copy,
});

export const COST_STATE_MATRIX: Record<Tab, Record<State, CostStateCell>> = {
  ai: {
    measured: {
      rendersFullTreatment: true,
      rendersCostNumber: true,
      rendersCopyPromptButton: true,
      rendersIndustryDataExpander: true,
      chip: 'measured',
      rendersPercentageClaim: true,
      rendersBenchmarkScale: true,
      rendersCheckLine: true,
    },
    zero: {
      ...noTreatment(AI_ZERO_COPY, 'measured'),
      rendersIndustryDataExpander: true,
      rendersPercentageClaim: false,
      rendersBenchmarkScale: true,
      rendersCheckLine: true,
    },
    blocked: {
      ...noTreatment(BOT_WALL_COPY, 'not measured'),
      rendersPercentageClaim: false,
    },
    noclaim: {
      ...noTreatment('almost no text to compare', 'measured'),
      rendersPercentageClaim: false,
    },
  },
  perf: {
    measured: {
      rendersFullTreatment: true,
      rendersCostNumber: true,
      rendersCopyPromptButton: true,
      rendersIndustryDataExpander: true,
      chip: 'measured',
      rendersBenchmarkScale: true,
      rendersCalculator: true,
      rendersCheckLine: true,
    },
    zero: {
      ...noTreatment(PERF_ZERO_COPY, 'measured'),
      rendersBenchmarkScale: true,
      rendersCheckLine: true,
    },
    blocked: noTreatment(BOT_WALL_COPY, 'not measured'),
    noclaim: noTreatment(undefined, 'measured'),
  },
  a11y: {
    measured: {
      rendersFullTreatment: true,
      rendersCostNumber: false,
      rendersCopyPromptButton: true,
      rendersIndustryDataExpander: false,
      chip: 'measured',
      copy: WHAT_THIS_AFFECTS,
      rendersBenchmarkScale: true,
    },
    zero: {
      ...noTreatment(undefined, 'measured'),
      rendersBenchmarkScale: true,
    },
    blocked: noTreatment(BOT_WALL_COPY, 'not measured'),
    noclaim: noTreatment(undefined, 'measured'),
  },
};

export function aiHeadline(pct: number, present: number, total: number): string {
  void present;
  void total;
  return `${pct}% of your page's text is missing from the page the server sends, before any JavaScript runs`;
}

export function aiHeadlineSub(present: number, total: number): string {
  return `only ${present} of ${total} words present`;
}

export function aiCheckLine(url: string): string {
  return `check it yourself: open view-source:${url} and search for a sentence from your page`;
}

export function perfHeadline(label: string, page: string): string {
  void page;
  return `${label} before your main content appears on a mid-range phone`;
}

export function perfCheckLine(url: string, sameProfile: boolean, usedProfile?: string): string {
  const psiUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`;
  if (sameProfile) {
    return `check it yourself: run PageSpeed Insights on this page - same phone and network profile we used: ${psiUrl}`;
  }

  const profile = usedProfile ?? 'a different profile';
  return `check it yourself: run PageSpeed Insights on this page: ${psiUrl} (Google's standard phone profile; we used ${profile}, so numbers may differ)`;
}

export function botWallFooterSentence(n: number): string {
  const pageWord = n === 1 ? 'page' : 'pages';
  return `${n} ${pageWord} had at least one report section that could not be measured because bot protection served our checker a challenge page instead of the real page`;
}

export function perfGapHeadline(measuredLabel: string, multipleLabel: string | undefined, pageName: string): string {
  if (multipleLabel) {
    return `${pageName} shows its main content after ${measuredLabel} on a mid-range phone - ${multipleLabel} past Google's 2.5-second good line`;
  }
  return `${pageName} shows its main content after ${measuredLabel} on a mid-range phone`;
}

export function perfStudiesIntro(): string {
  return 'None of these numbers are yours. They are what the same kind of wait did on sites that measured it.';
}

export function perfStudiesFooter(): string {
  return 'Why this report prints no "N of 100 visitors leave" figure for your pages: these studies ran on other sites and much smaller gaps, and stretching them across your gap would pass 100%. We use them for direction and rough size only.';
}

export function a11yNoNumberLine(): string {
  return 'We put no visitor count on this - no study we trust can honestly count who leaves over these barriers, so we do not pretend to.';
}

export function aiSingleCountLine(): string {
  return 'Visitor loss is counted once in this report, on the Performance tab. This tab answers one question: can AI tools read you?';
}

export interface IndustryDataStat {
  text: string;
  publisher: string;
  date: string;
  url: string;
  method?: 'controlled test' | 'correlation';
}

export const PERF_INDUSTRY_DATA_STATS: readonly IndustryDataStat[] = [
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
];

export const AI_INDUSTRY_DATA_STATS: readonly IndustryDataStat[] = [
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
];

export const A11Y_INDUSTRY_DATA_STATS: readonly IndustryDataStat[] = [];

export const CALC_TITLE = 'What is the wait worth to you? - optional, your numbers, your math';
export const CALC_INQUIRIES_LABEL = 'About how many inquiries does the website bring you in a typical month?';
export const CALC_VALUE_LABEL = 'Roughly what is one new inquiry worth to you, in dollars?';
export const CALC_SHARE_LABEL = 'Share of visits from phones';
export const CALC_DIAL_LABEL = 'If the site got fast, how much of the lost response comes back?';

export function calcCapNote(): string {
  return 'The 15% top of this dial is not ours: Vodafone measured a 15% improvement in the lead-to-visit rate in a controlled test after improving LCP 31%. We cap the dial there anyway, because bigger gaps do not pay out in a straight line.';
}

export const CALC_PRIVACY_LINE = 'Numbers you type stay in this file. It makes no network requests and stores nothing.';
export const CALC_PARTIAL_LINE = 'Fill the fields to see the math - until then, no dollar figure is honest.';

export function calcBreakEvenLine(usdYearLabel: string): string {
  return `If a faster site brought back just one extra inquiry a month, that is ${usdYearLabel} a year.`;
}

export function calcTinyResultLine(): string {
  return 'Under $50 a month at your numbers - speed is not where your money is; fix it for your visitors, not for revenue.';
}

export const CALC_HONESTY_FOOTER = 'This is your arithmetic, not our measurement. Change any number above and it changes.';
