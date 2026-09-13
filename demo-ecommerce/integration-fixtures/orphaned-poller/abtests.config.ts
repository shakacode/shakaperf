/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Fixture for integration-tests/orphaned-poller.spec.ts. Control and
// experiment are the SAME tiny server the spec starts; the point is not a
// comparison but a page shaped to make Lighthouse's cpu-idle poller outlive
// its cancel() — see ab-tests/orphaned-poller.abtest.ts. Perf only.
import { defineConfig, DESKTOP_VIEWPORT } from 'shaka-shared';

const port = process.env.ORPHAN_FIXTURE_PORT;
if (!port) throw new Error('ORPHAN_FIXTURE_PORT is required (set by the spec)');

export default defineConfig({
  shared: {
    controlURL: `http://127.0.0.1:${port}`,
    experimentURL: `http://127.0.0.1:${port}`,
    viewportDefinitions: [DESKTOP_VIEWPORT],
    viewports: ['desktop'],
    parallelism: 1,
    retries: 0,
    timeoutMs: 120_000,
    playwrightOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
      waitTimeout: 30_000,
    },
    browserConsole: {
      failOn: [],
      allowList: [],
    },
  },

  perf: {
    // The orphan forms in one sample and its fatal lands in the next one on
    // the same worker, so there must be a next one.
    numberOfMeasurements: 2,
    lighthouseConfig: {
      // 'simulate' exactly: anything else makes Lighthouse raise every quiet
      // window below to 5250ms.
      throttlingMethod: 'simulate' as const,
      throttling: {
        rttMs: 0,
        throughputKbps: 10_240,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
        cpuSlowdownMultiplier: 1,
      },
      output: 'html' as const,
      onlyCategories: ['performance'],
      // Short on purpose: the testFn must outlast it so the timeout branch is
      // the one waiting on the hold when the hold releases.
      maxWaitForLoad: 3_000,
      // The critical-network gate must resolve soon after the page stops
      // fetching — after the race has settled but while Lighthouse is still
      // collecting artifacts. That is the window the un-cancelled poller is
      // created in.
      networkQuietThresholdMs: 300,
      // And that poller's RE-SCHEDULED poll must land after the page is
      // closed: with the CPU kept busy, its wait ≈ this value.
      cpuQuietThresholdMs: 4_000,
    },
  },
});
