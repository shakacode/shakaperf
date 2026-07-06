/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// StatCounter desktop-vs-mobile worldwide, 2026 (~52%); editable default.
// Source: https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet/worldwide
export const DEFAULT_MOBILE_TRAFFIC_SHARE = 0.52;

// cable.co.uk worldwide average mobile data price (~$2.59/GB).
// Source: https://www.cable.co.uk/mobiles/worldwide-data-pricing/
export const MOBILE_DATA_PRICE_USD_PER_MB_LOW = 0.0026;

// cable.co.uk United States mobile data price (~$6.00/GB).
// Source: https://www.cable.co.uk/mobiles/worldwide-data-pricing/
export const MOBILE_DATA_PRICE_USD_PER_MB_HIGH = 0.006;

export interface DataCostRange {
  measuredMb: string;
  estimatedUsd: string;
}

function formatMb(mb: number): string {
  const rounded = Math.round(mb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} MB`;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

// The audit downloads metric is reported in decimal KB, so 12_500 KB is 12.5 MB.
export function formatDataCostRangeFromKb(downloadsKb: number): DataCostRange {
  const safeDownloadsKb = Number.isFinite(downloadsKb) ? Math.max(0, downloadsKb) : 0;
  const measuredMb = safeDownloadsKb / 1000;
  const lowUsd = Math.max(0.01, roundUsd(measuredMb * MOBILE_DATA_PRICE_USD_PER_MB_LOW));
  const highUsd = Math.max(lowUsd, roundUsd(measuredMb * MOBILE_DATA_PRICE_USD_PER_MB_HIGH));

  return {
    measuredMb: formatMb(measuredMb),
    estimatedUsd: `~= $${formatUsd(lowUsd)}-${formatUsd(highUsd)}`,
  };
}

export const formatDataCostRange = formatDataCostRangeFromKb;
