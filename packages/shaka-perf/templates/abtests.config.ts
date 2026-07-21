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
import { BrowserContext } from 'playwright-core';
import { defineConfig, assignPortsAutomatically, installRequestBlocking, DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';

// Control/experiment host ports. The same pair feeds the URLs and
// twinServers.ports below, so they can't drift.
let CONTROL_PORT: number;
let EXPERIMENT_PORT: number;

const pinnedControl = Number(process.env.SHAKAPERF_CONTROL_PORT);
const pinnedExperiment = Number(process.env.SHAKAPERF_EXPERIMENT_PORT);
const conductorBase = Number(process.env.CONDUCTOR_PORT);
if (pinnedControl > 0 && pinnedExperiment > 0) {
  // Explicit pin — e.g. CI needing a fixed, known pair. Both vars required;
  // a lone one is ignored.
  CONTROL_PORT = pinnedControl;
  EXPERIMENT_PORT = pinnedExperiment;
} else if (conductorBase > 0) {
  // Conductor.build (https://conductor.build) exports CONDUCTOR_PORT — the
  // first of 10 consecutive ports each workspace owns exclusively
  // (docs.conductor.build/tips/conductor-env) — so parallel agents get
  // non-overlapping pairs with no probing or shared state. Not using
  // Conductor? Delete this branch. Need other per-machine overrides? This
  // file is plain TypeScript — read whatever env you like right here.
  CONTROL_PORT = conductorBase;
  EXPERIMENT_PORT = conductorBase + 1;
} else {
  // Auto-assign from the required preferred pair. If either port is in use,
  // BOTH shift up by 1 together — preserving their gap — until the first free
  // pair is found; the pair is then remembered per project (in
  // ~/.shaka-perf/ports.json) so it stays stable across runs.
  ({ control: CONTROL_PORT, experiment: EXPERIMENT_PORT } =
    assignPortsAutomatically({ control: 3020, experiment: 3030 }));
}

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
  // Reduce the value for Lighhouse to finish earlier on pages with background Network Activity
  networkQuietThresholdMs: 1000,
  // Reduce the value for Lighhouse to finish earlier on pages with background CPU Activity
  cpuQuietThresholdMs: 1000,
};

export default defineConfig({
  shared: {
    controlURL: `http://localhost:${CONTROL_PORT}`,
    experimentURL: `http://localhost:${EXPERIMENT_PORT}`,
    viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
    parallelism: PARALLELISM,
    // Runs before EVERY test's navigation, on every engine. A per-test
    // `beforeNavigate` on `abTest()` options, if present, receives this hook as
    // a second arg and decides whether to call it (`await runGlobal(ctx)`) —
    // so a test can wrap, extend, or opt out of this setup. The
    // `context` is a Playwright BrowserContext — use it for pre-nav setup:
    // request blocking, cookies, extra headers, init scripts. Prefer
    // `installRequestBlocking` over Playwright `route()` for perf request
    // blocking because request interception disables Chromium's HTTP cache.
    //
    // Default: abort Google reCAPTCHA. Its scripts load from www.google.com /
    // www.gstatic.com, which the twin-server sandbox can't reach (no outbound
    // internet) — those requests never connect, so Playwright's `networkidle`
    // never fires and any test landing on a captcha page hangs until the pool
    // timeout. Harmless if your app has no reCAPTCHA (nothing matches). Add
    // more substring/regex patterns, or delete this if you don't need it.
    beforeNavigate: async (options : {context: BrowserContext}) => {
      await installRequestBlocking(options.context, ['/recaptcha/']);
      // Seed cookies / an auth session here (optional):
      //   await context.addCookies([{ name: 'session', value: '…', options.url }]);
      // localStorage/auth too, via:
      //   context.addInitScript(...)
    },
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
