/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig, assignPortsAutomatically, installRequestBlocking, DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';

// Auto-assign the control/experiment host ports from a required preferred pair.
// If either port is in use, BOTH shift up by 1 together — preserving their gap —
// until the first free pair is found; the pair is then remembered per project
// (in ~/.shaka-perf/ports.json) so it stays stable across runs. Set
// SHAKAPERF_CONTROL_PORT / SHAKAPERF_EXPERIMENT_PORT to override entirely. The
// same pair feeds the URLs and twinServers.ports below, so they can't drift.
//
// Concurrent-agent tooling: when SHAKAPERF_BASE_PORT or CONDUCTOR_PORT (set
// automatically per workspace by Conductor.build) is present, the pair is
// derived from that base (control = base+0, experiment = base+1) so multiple
// agents in separate workspaces never collide — no probing, no shared state.
const { control: CONTROL_PORT, experiment: EXPERIMENT_PORT } = assignPortsAutomatically({ control: 3020, experiment: 3030 });

const PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

// Raw Lighthouse flags shared by the `perf` and `audit` pipelines. These pass
// straight through to Lighthouse — shaka-perf only layers each viewport's
// `formFactor` / `screenEmulation` on top. Tune the knobs you care about:
//   - throttling + throttlingMethod 'devtools': real in-browser CPU/network
//     throttling on the Lighthouse "Slow 4G" mobile profile, tuned to track PSI.
//   - maxWaitForLoad (ms): cap on how long Lighthouse waits for the page to be
//     fully loaded before it measures. Lighthouse's default is 45_000; raise it
//     for slow- or never-settling pages so the run isn't cut short.
const LIGHTHOUSE_CONFIG = {
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
  throttlingMethod: 'devtools' as const,
  logLevel: 'error' as const,
  output: 'html' as const,
  onlyCategories: ['performance'],
  maxWaitForLoad: 60_000,
};

export default defineConfig({
  shared: {
    controlURL: `http://localhost:${CONTROL_PORT}`,
    experimentURL: `http://localhost:${EXPERIMENT_PORT}`,
    viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
    parallelism: PARALLELISM,
    // Runs before EVERY test's navigation, on every engine (a per-test
    // `beforeNavigate` on `abTest()` options runs after this one). The
    // `context` is a Playwright BrowserContext — use it for pre-nav setup:
    // route-blocking, cookies, extra headers, init scripts.
    //
    // Default: abort Google reCAPTCHA. Its scripts load from www.google.com /
    // www.gstatic.com, which the twin-server sandbox can't reach (no outbound
    // internet) — those requests never connect, so Playwright's `networkidle`
    // never fires and any test landing on a captcha page hangs until the pool
    // timeout. Harmless if your app has no reCAPTCHA (nothing matches). Add
    // more substring/regex patterns, or delete this if you don't need it.
    beforeNavigate: ({ context }) => installRequestBlocking(context, ['/recaptcha/']),
  },

  visreg: {
    viewports: ['desktop', 'tablet', 'phone'],
    defaultMisMatchThreshold: 0.1,
    maxNumDiffPixels: 50,
    comparePixelmatchThreshold: 0.1,
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
  },

  perf: {
    numberOfMeasurements: 20,
    regressionThreshold: 50,
    pValueThreshold: 0.05,
    regressionThresholdStat: 'estimator',
    samplingMode: 'simultaneous',
    viewports: ['desktop', 'phone'],
    lighthouseConfig: LIGHTHOUSE_CONFIG,
  },

  audit: {
    viewports: ['desktop', 'phone'],
    lighthouseConfig: LIGHTHOUSE_CONFIG,
  },

  // Twin-servers (Docker A/B testing infra). `ports` reuses the constants
  // above so the host-port mapping, the URLs visreg/perf hit, and
  // `servers notify-server-started` all stay in sync. Run `shaka-perf servers`
  // to build + start both sides. If you don't use twin-servers, delete this.
  twinServers: {
    // This checkout is the experiment side. Use `process.cwd()` when running
    // twin-servers from inside the experiment repo (the common case).
    experimentDir: process.cwd(),
    // Baseline (control) checkout: a sibling dir named after this one with
    // `-control` appended, so it adapts to whatever the repo is called rather
    // than a hardcoded name. `servers build` offers to clone it here if missing.
    controlDir: `../${path.basename(process.cwd())}-control`,
    // Local build context. The same relative offset is applied under
    // experimentDir/controlDir when building those images.
    dockerBuildDir: '.',
    dockerfile: 'twin-servers/Dockerfile',
    // Procfile/composeFile are resolved relative to this local project dir.
    procfile: 'twin-servers/Procfile',
    ports: {
      control: CONTROL_PORT,
      experiment: EXPERIMENT_PORT,
    },
    // No `setupCommands` by default: do all setup (install, build, migrate,
    // seed) in the Dockerfile so the image is self-contained. They're a last
    // resort for what can't be baked into an image — chiefly starting an
    // embedded service daemon — and run in both containers at start.
  },
});
