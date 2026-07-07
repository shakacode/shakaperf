/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { MOBILE_DATA_PRICE_USD_PER_MB_HIGH, MOBILE_DATA_PRICE_USD_PER_MB_LOW } from './cost-model';

export const BANNED_WORDS = ['assistants', 'absent', 'costing', 'channel', 'zero-click', 'modeled', 'Pew'] as const;

export function findBannedWords(text: string): string[] {
  return BANNED_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
    return pattern.test(text);
  });
}

export type CostChip = 'measured' | 'estimated' | 'not measured';

export interface CostChipCopy {
  label: string;
  intent: 'site measurement' | 'calculated estimate' | 'blocked measurement';
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
  'not measured': {
    label: 'not measured',
    intent: 'blocked measurement',
    estimatorToggle: false,
  },
};

export const COST_CHIP_LABELS: Record<CostChip, string> = {
  measured: COST_CHIPS.measured.label,
  estimated: COST_CHIPS.estimated.label,
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
}

export const WHAT_THIS_AFFECTS = 'What this affects';
export const INDUSTRY_DATA = 'industry data';
export const NOTHING_TO_FIX = 'Nothing to fix here';
export const BOT_WALL_COPY =
  "The site's bot protection served our checker a challenge page instead of the real page, so this could not be measured. Allowlist our checker and we will re-run a clean pass.";
export const FOOTER_GUARDRAIL = 'measured on your site - estimates are labeled and show their math - every number links to its source';

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
    },
    zero: {
      ...noTreatment(NOTHING_TO_FIX, 'measured'),
      rendersPercentageClaim: false,
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
      rendersIndustryDataExpander: false,
      chip: 'estimated',
    },
    zero: noTreatment(NOTHING_TO_FIX, 'measured'),
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
    },
    zero: noTreatment(undefined, 'measured'),
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
  return `${n} ${pageWord} could not be measured because bot protection served our checker a challenge page instead of the real page`;
}

export function dataCostMeasuredLine(mb: string): string {
  return `each visit to this page downloads ${mb}`;
}

export function dataCostEstimatedLine(usd: string): string {
  return `${usd} of mobile data per visit`;
}

function formatPricePerMb(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function dataCostFormula(mb: string): string {
  return `${mb} measured on this page x ${formatPricePerMb(MOBILE_DATA_PRICE_USD_PER_MB_LOW)}-${formatPricePerMb(MOBILE_DATA_PRICE_USD_PER_MB_HIGH)} per MB (cable.co.uk worldwide average / US price)`;
}

export interface IndustryDataStat {
  text: string;
  publisher: string;
  date: string;
  url: string;
}

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
