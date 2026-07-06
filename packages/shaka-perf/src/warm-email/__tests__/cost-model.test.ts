/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  DEFAULT_MOBILE_TRAFFIC_SHARE,
  MOBILE_DATA_PRICE_USD_PER_MB_HIGH,
  MOBILE_DATA_PRICE_USD_PER_MB_LOW,
  formatDataCostRange,
  formatDataCostRangeFromKb,
} from '../cost-model';

describe('cost model constants', () => {
  it('exports the researched default values', () => {
    expect(DEFAULT_MOBILE_TRAFFIC_SHARE).toBe(0.52);
    expect(MOBILE_DATA_PRICE_USD_PER_MB_LOW).toBe(0.0026);
    expect(MOBILE_DATA_PRICE_USD_PER_MB_HIGH).toBe(0.006);
  });
});

describe('formatDataCostRangeFromKb', () => {
  it('formats decimal KB as MB and a rounded estimated USD range', () => {
    expect(formatDataCostRangeFromKb(12_500)).toEqual({
      measuredMb: '12.5 MB',
      estimatedUsd: '~= $0.03-0.08',
    });
  });

  it('never emits a zero-dollar low bound', () => {
    const { estimatedUsd } = formatDataCostRangeFromKb(1);
    const [low, high] = estimatedUsd.replace('~= $', '').split('-').map(Number);

    expect(estimatedUsd).toMatch(/^~= \$\d+\.\d{2}-\d+\.\d{2}$/);
    expect(low).toBeGreaterThanOrEqual(0.01);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('normalizes non-finite input without emitting NaN', () => {
    expect(formatDataCostRangeFromKb(Number.NaN)).toEqual({
      measuredMb: '0 MB',
      estimatedUsd: '~= $0.01-0.01',
    });
  });

  it('keeps the compatibility formatter aligned with the explicit KB formatter', () => {
    expect(formatDataCostRange(12_500)).toEqual(formatDataCostRangeFromKb(12_500));
  });
});
