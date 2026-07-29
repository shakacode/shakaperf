/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportStatus } from '../client-report-renderer';
import type { CostGap } from './cost-benchmarks';
import type { ScoreBadgePolicy } from './perf';
import type { CostCalculatorConfig } from './cost-recovery';

export interface CostStudy {
  text: string;
  publisher: string;
  date: string;
  url: string;
  method?: 'controlled test' | 'correlation';
}

export interface CostStakes {
  kind: 'at-risk' | 'no-material-loss';
  prose: string;
  studies?: readonly CostStudy[];
  expanderIntro?: string;
  expanderFooter?: string;
}

export interface CostFix {
  tone: 'primary' | 'secondary';
  text?: string;
}

export interface CostBlockExtras {
  gap?: CostGap;
  gapSubLines?: string[];
  bookingLine?: string;
  stakes?: CostStakes;
  fix?: CostFix;
  calculator?: CostCalculatorConfig;
  countedZeroLine?: string;
  // Filled only by later builder waves for the C renderer.
  sitePrompts?: CostSitePromptSlots;
  // Kept nested on cost blocks for the AI tab only.
  strongPageGroup?: StrongPageGroup;
  scoreBadgePolicy?: ScoreBadgePolicy;
}

/** Optional C design handoff slots. They remain absent until a builder fills them. */
export interface CostSitePromptSlots {
  perf?: string;
  a11y?: string;
}

/** A quiet one-line group used instead of full cards for strong pages. */
export interface StrongPageGroup {
  label: string;
  verdict?: string;
  pages: readonly {
    name: string;
    score?: number;
  }[];
}

export function dimSeverityRank(status: ClientReportStatus, couldNotMeasure: boolean): number {
  if (couldNotMeasure) return 2;
  return { poor: 0, fair: 1, good: 3 }[status];
}
