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
 * Run a visreg comparison. Everything this invocation writes lives under the
 * artifacts dir the compare runner pinned (`paths.artifacts`), and the runner
 * clears that dir once before any stage runs — this command never wipes
 * anything itself, so concurrent invocations can't clobber each other.
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
