/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './integration-tests',
  globalSetup: './integration-tests/global-setup.ts',
  globalTeardown: './integration-tests/global-teardown.ts',
  timeout: 10 * 60 * 1000,
  // Must fit the whole @audit suite: the filtered OCR audit plus the
  // all-pages audit + client-report drive-through, each with a long
  // per-test setTimeout of its own.
  globalTimeout: 90 * 60 * 1000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
