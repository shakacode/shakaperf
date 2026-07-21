/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

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
    return { mobileInquiries, recoveredLo, recoveredHi, material: recoveredHi > 0 };
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
