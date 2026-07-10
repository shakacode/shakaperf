/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportStatus } from '../client-report-renderer';

/**
 * Published performance and accessibility lines.
 * Sources: https://web.dev/articles/lcp, https://web.dev/articles/cls,
 * https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint,
 * https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time,
 * and https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html.
 */
export const BENCHMARK_LINES = {
  lcpMs: { good: 2500, poor: 4000 },
  cls: { good: 0.10, poor: 0.25 },
  fcpMs: { good: 1800, poor: 3000 },
  tbtMs: { good: 200, poor: 600 },
  contrast: 4.5,
} as const;

interface DecimalFraction {
  numerator: bigint;
  denominator: bigint;
}

function decimalFraction(value: number): DecimalFraction {
  const [mantissa, exponentLabel] = value.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const numerator = BigInt(`${integer}${fraction}`);
  const exponent = Number(exponentLabel ?? 0) - fraction.length;
  if (exponent >= 0) {
    return { numerator: numerator * (10n ** BigInt(exponent)), denominator: 1n };
  }
  return { numerator, denominator: 10n ** BigInt(-exponent) };
}

export function benchmarkMultiple(measured: number, good: number): string | undefined {
  if (!Number.isFinite(measured) || !Number.isFinite(good) || measured <= 0 || good <= 0 || measured <= good) {
    return undefined;
  }

  const measuredFraction = decimalFraction(measured);
  const goodFraction = decimalFraction(good);
  const tenths = (
    measuredFraction.numerator
    * goodFraction.denominator
    * 10n
  ) / (
    measuredFraction.denominator
    * goodFraction.numerator
  );
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return decimal === 0n ? `${whole}x` : `${whole}.${decimal}x`;
}

export type CostZone = 'good' | 'mid' | 'poor';

export function benchmarkZone(measured: number, line: { good: number; poor: number }): CostZone {
  if (measured <= line.good) return 'good';
  if (measured > line.poor) return 'poor';
  return 'mid';
}

export interface CostGap {
  metricLabel: string;
  measuredLabel: string;
  goodLabel: string;
  poorLabel: string;
  multipleLabel?: string;
  zone: CostZone;
  lineOwner: string;
  lineUrl: string;
}

export interface CostStudy {
  text: string;
  publisher: string;
  date: string;
  url: string;
  method: 'controlled test' | 'correlation';
}

export interface CostStakes {
  kind: 'at-risk' | 'no-material-loss';
  prose: string;
  studies?: CostStudy[];
  expanderIntro?: string;
  expanderFooter?: string;
}

export interface CostFix {
  tone: 'primary' | 'secondary';
  text?: string;
}

export interface RecoveryBand {
  id: 'cautious' | 'middle' | 'ceiling';
  lo: number;
  hi: number;
}

/** Vodafone's 2021 controlled test caps the recovery estimate: https://web.dev/case-studies/vodafone */
export const RECOVERY_CAP = 0.15;

/** Recovery bands capped by Vodafone's 2021 result: https://web.dev/case-studies/vodafone */
export const RECOVERY_BANDS: readonly RecoveryBand[] = [
  { id: 'cautious', lo: 0.02, hi: 0.05 },
  { id: 'middle', lo: 0.05, hi: 0.10 },
  { id: 'ceiling', lo: 0.10, hi: RECOVERY_CAP },
];

/** Internal product-policy threshold with no external source. */
export const MATERIALITY_FLOOR_USD_PER_MONTH = 50;

export interface CostCalculatorConfig {
  mobileSharePrefill: number;
  bands: readonly RecoveryBand[];
  materialityFloorUsdPerMonth: number;
  inquiryNoun: string;
}

export interface RecoveryInputs {
  monthlyInquiries: number;
  valuePerInquiryUsd?: number;
  mobileShare: number;
  band: RecoveryBand;
}

export interface RecoveryRange {
  mobileInquiries: number;
  recoveredLo: number;
  recoveredHi: number;
  usdMonthLo?: number;
  usdMonthHi?: number;
  usdYearLo?: number;
  usdYearHi?: number;
  breakEvenUsdYear?: number;
  material: boolean;
}

export function computeRecoveryRange(i: RecoveryInputs): RecoveryRange | undefined {
  const { monthlyInquiries, valuePerInquiryUsd, mobileShare, band } = i;
  if (
    !Number.isFinite(monthlyInquiries)
    || monthlyInquiries <= 0
    || !Number.isFinite(mobileShare)
    || mobileShare < 0
    || mobileShare > 1
    || !Number.isFinite(band.lo)
    || !Number.isFinite(band.hi)
    || band.lo < 0
    || band.hi < band.lo
    || band.hi > RECOVERY_CAP
    || (valuePerInquiryUsd !== undefined && (!Number.isFinite(valuePerInquiryUsd) || valuePerInquiryUsd < 0))
  ) {
    return undefined;
  }

  const mobileInquiries = monthlyInquiries * mobileShare;
  const recoveredLo = mobileInquiries * band.lo;
  const recoveredHi = mobileInquiries * band.hi;
  if (![mobileInquiries, recoveredLo, recoveredHi].every(Number.isFinite)) return undefined;
  if (valuePerInquiryUsd === undefined) {
    return { mobileInquiries, recoveredLo, recoveredHi, material: true };
  }

  const usdMonthLo = recoveredLo * valuePerInquiryUsd;
  const usdMonthHi = recoveredHi * valuePerInquiryUsd;
  const usdYearLo = usdMonthLo * 12;
  const usdYearHi = usdMonthHi * 12;
  const breakEvenUsdYear = valuePerInquiryUsd * 12;
  if (![usdMonthLo, usdMonthHi, usdYearLo, usdYearHi, breakEvenUsdYear].every(Number.isFinite)) return undefined;
  return {
    mobileInquiries,
    recoveredLo,
    recoveredHi,
    usdMonthLo,
    usdMonthHi,
    usdYearLo,
    usdYearHi,
    breakEvenUsdYear,
    material: usdMonthHi >= MATERIALITY_FLOOR_USD_PER_MONTH,
  };
}

export interface CostBlockExtras {
  gap?: CostGap;
  gapSubLines?: string[];
  bookingLine?: string;
  stakes?: CostStakes;
  fix?: CostFix;
  calculator?: CostCalculatorConfig;
  countedZeroLine?: string;
}

export function dimSeverityRank(status: ClientReportStatus, couldNotMeasure: boolean): number {
  if (couldNotMeasure) return 2;
  return { poor: 0, fair: 1, good: 3 }[status];
}
