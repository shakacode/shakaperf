/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { PERF_INDUSTRY_DATA_STATS, perfStudiesFooter, perfStudiesIntro } from '../cost-strings';
import { DEFAULT_MOBILE_TRAFFIC_SHARE } from '../cost-model';
import { MATERIALITY_FLOOR_USD_PER_MONTH, RECOVERY_BANDS } from './cost-recovery';

export function buildAtRiskPerfStakes(prose: string) {
  return {
    kind: 'at-risk' as const,
    prose,
    studies: PERF_INDUSTRY_DATA_STATS,
    expanderIntro: perfStudiesIntro(),
    expanderFooter: perfStudiesFooter(),
  };
}

export function buildPerfCalculator() {
  return {
    mobileSharePrefill: DEFAULT_MOBILE_TRAFFIC_SHARE,
    bands: RECOVERY_BANDS,
    materialityFloorUsdPerMonth: MATERIALITY_FLOOR_USD_PER_MONTH,
    inquiryNoun: 'inquiry',
  };
}

export function optionalCountedZeroLine(countedZeroLine: string | undefined) {
  return countedZeroLine ? { countedZeroLine } : {};
}
