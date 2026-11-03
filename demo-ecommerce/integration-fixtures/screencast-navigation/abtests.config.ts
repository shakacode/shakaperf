/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { defineConfig } from 'shaka-shared';
import demoConfig from '../../abtests.config';

// Run from this directory against the demo on both local origins. The second
// host must be cross-site (127.0.0.1 -> localhost), not just a different port,
// so Chrome's site isolation exercises a renderer swap.
export default defineConfig({
  ...demoConfig,
  shared: {
    ...demoConfig.shared,
    controlURL: 'http://127.0.0.1:3067',
    experimentURL: 'http://127.0.0.1:3067',
    parallelism: 1,
    retries: 0,
    timeoutMs: 120_000,
    playwrightOptions: {
      ...demoConfig.shared?.playwrightOptions,
      browser: 'chromium',
      args: ['--no-sandbox', '--site-per-process'],
      waitTimeout: 30_000,
    },
  },
});
