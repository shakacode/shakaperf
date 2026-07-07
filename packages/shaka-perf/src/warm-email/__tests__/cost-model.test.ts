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
  it('formats audit KB as MB and a rounded estimated USD range', () => {
    expect(formatDataCostRangeFromKb(12_500)).toEqual({
      measuredMb: '12.2 MB',
      estimatedUsd: '~= $0.03-0.07',
    });
  });

  it('renders sub-cent positive estimates without overstating them to a cent', () => {
    const { estimatedUsd } = formatDataCostRangeFromKb(1);

    expect(estimatedUsd).toBe('~= <$0.01');
  });

  it('normalizes zero and non-finite input without emitting NaN or nonzero cost', () => {
    expect(formatDataCostRangeFromKb(0)).toEqual({
      measuredMb: '0 MB',
      estimatedUsd: '~= $0.00-0.00',
    });
    expect(formatDataCostRangeFromKb(Number.NaN)).toEqual({
      measuredMb: '0 MB',
      estimatedUsd: '~= $0.00-0.00',
    });
  });
});
