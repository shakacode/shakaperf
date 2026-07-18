/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import type { ClientReportCostBlock } from '../client-report-renderer';
import { NO_MATERIAL_LOSS } from '../cost-strings';
import { BENCHMARK_LINES } from './cost-benchmarks';
import type { BuildPerfCostInput } from './cost-performance';
import { metricVal } from './perf';

export function buildZeroPerfCost(input: BuildPerfCostInput): ClientReportCostBlock {
  const everyMeasuredLcpUnderGoodLine = input.measured.every(({ page }) => {
    const lcpMs = metricVal(page, 'LCP');
    return lcpMs !== undefined && lcpMs <= BENCHMARK_LINES.lcpMs.good;
  });
  return {
    tab: 'perf',
    state: 'zero',
    ...(everyMeasuredLcpUnderGoodLine ? {} : { headline: NO_MATERIAL_LOSS }),
  };
}
