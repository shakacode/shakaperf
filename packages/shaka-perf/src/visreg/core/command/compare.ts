/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import createComparisonBitmaps from '../util/createComparisonBitmaps';
import type { RuntimeConfig } from '../types';

/**
 * Run a visreg comparison. Per-test artifact dirs and the flat
 * `<htmlReportDir>/{control,experiment}_screenshot/` scratch dirs are
 * cleared once by the compare runner before any stage runs — this
 * command never wipes anything itself, so concurrent invocations
 * coexist on the shared scratch dir without clobbering each other.
 */
export async function execute(config: RuntimeConfig) {
  // Imported dynamically to break the circular dependency:
  // index.js → compare.js → index.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executeCommand = require('./index').default;
  return createComparisonBitmaps(config).then(function () {
    return executeCommand('_report', config);
  });
}
