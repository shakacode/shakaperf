/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  BENCHMARK_LINES,
  MATERIALITY_FLOOR_USD_PER_MONTH,
  RECOVERY_BANDS,
  benchmarkMultiple,
  benchmarkZone,
  computeRecoveryRange,
  dimSeverityRank,
} from '../client-report-model/cost';

describe('benchmarkMultiple', () => {
  it.each([
    [10_300, 2500, '4.1x'],
    [12_500, 2500, '5x'],
    [12_499, 2500, '4.9x'],
    [12_499.999, 2500, '4.9x'],
    [0.3, 0.1, '3x'],
    [0.29, 0.1, '2.9x'],
    [1.09, 0.1, '10.9x'],
  ])('floors %s / %s to %s', (measured, good, expected) => {
    expect(benchmarkMultiple(measured, good)).toBe(expected);
  });

  it.each([
    [2400, 2500],
    [2500, 2500],
    [Number.NaN, 2500],
    [2501, Number.POSITIVE_INFINITY],
    [0, 2500],
    [2501, 0],
  ])('returns undefined for invalid or under-line inputs', (measured, good) => {
    expect(benchmarkMultiple(measured, good)).toBeUndefined();
  });
});

describe('benchmarkZone', () => {
  const line = BENCHMARK_LINES.lcpMs;

  it.each([
    [2400, 'good'],
    [2500, 'good'],
    [2501, 'mid'],
    [3999, 'mid'],
    [4000, 'mid'],
    [4001, 'poor'],
    [10_300, 'poor'],
  ] as const)('classifies %s as %s', (measured, expected) => {
    expect(benchmarkZone(measured, line)).toBe(expected);
  });

  it('keeps published decimal boundaries in the middle zone', () => {
    expect(benchmarkZone(0.25, BENCHMARK_LINES.cls)).toBe('mid');
    expect(benchmarkZone(0.26, BENCHMARK_LINES.cls)).toBe('poor');
  });
});

describe('computeRecoveryRange', () => {
  it('computes exact inquiry and dollar ranges from owner inputs', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: 62,
      mobileShare: 0.52,
      band: RECOVERY_BANDS[0],
      valuePerInquiryUsd: 500,
    })).toEqual({
      mobileInquiries: 32.24,
      recoveredLo: 0.6448,
      recoveredHi: 1.612,
      usdMonthLo: 322.40000000000003,
      usdMonthHi: 806,
      usdYearLo: 3868.8,
      usdYearHi: 9672,
      breakEvenUsdYear: 6000,
      material: true,
    });
  });

  it('omits dollar fields and stays material until a value is entered', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: 62,
      mobileShare: 0.52,
      band: RECOVERY_BANDS[0],
    })).toEqual({
      mobileInquiries: 32.24,
      recoveredLo: 0.6448,
      recoveredHi: 1.612,
      material: true,
    });
  });

  it('marks dollar results below the monthly floor as immaterial', () => {
    const result = computeRecoveryRange({
      monthlyInquiries: 10,
      mobileShare: 0.5,
      band: RECOVERY_BANDS[0],
      valuePerInquiryUsd: 100,
    });

    expect(result?.usdMonthHi).toBe(25);
    expect(result?.usdMonthHi).toBeLessThan(MATERIALITY_FLOOR_USD_PER_MONTH);
    expect(result?.material).toBe(false);
  });

  it('rejects finite inputs whose derived dollar outputs overflow', () => {
    expect(computeRecoveryRange({
      monthlyInquiries: Number.MAX_VALUE,
      mobileShare: 1,
      band: RECOVERY_BANDS[2],
      valuePerInquiryUsd: Number.MAX_VALUE,
    })).toBeUndefined();
  });

  it.each([
    { monthlyInquiries: 0, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: -1, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: Number.NaN, mobileShare: 0.5, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: -0.01, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: 1.01, band: RECOVERY_BANDS[0] },
    { monthlyInquiries: 10, mobileShare: 0.5, band: { id: 'ceiling' as const, lo: 0.1, hi: 0.2 } },
    { monthlyInquiries: 10, mobileShare: 0.5, band: RECOVERY_BANDS[0], valuePerInquiryUsd: Number.NaN },
    { monthlyInquiries: 10, mobileShare: 0.5, band: RECOVERY_BANDS[0], valuePerInquiryUsd: -1 },
  ])('returns undefined for invalid inputs', (input) => {
    expect(computeRecoveryRange(input)).toBeUndefined();
  });
});

describe('dimSeverityRank', () => {
  it('orders poor, fair, could-not-measure, then good', () => {
    expect(dimSeverityRank('poor', false)).toBe(0);
    expect(dimSeverityRank('fair', false)).toBe(1);
    expect(dimSeverityRank('poor', true)).toBe(2);
    expect(dimSeverityRank('good', false)).toBe(3);
  });
});
