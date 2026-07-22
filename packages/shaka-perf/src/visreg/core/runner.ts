/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import makeConfig from './util/makeConfig';
import createComparisonBitmaps from './util/createComparisonBitmaps';
import { execute as writeReport } from './report';
import type { RuntimeConfig } from './types';

/**
 * Run one visreg comparison: resolve the runtime config, capture and diff the
 * screenshots, then write the per-unit report. This is the engine's only entry
 * point — the unified compare pipeline calls it once per work unit.
 */
export default async function runVisregCompare(options?: Record<string, unknown>) {
  const config = await makeConfig(options) as RuntimeConfig;
  await createComparisonBitmaps(config);
  return writeReport(config);
}
