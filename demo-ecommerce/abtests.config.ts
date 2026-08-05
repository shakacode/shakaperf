/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as os from 'node:os';
import { assignPortsAutomatically, defineConfig } from 'shaka-shared';

// Auto-assign the control/experiment host ports from a required preferred pair.
// If either port is in use, BOTH shift up by 1 together — preserving their gap —
// until the first free pair is found; the pair is then remembered per project
// (in ~/.shaka-perf/ports.json) so it stays stable across runs. The same pair
// feeds the URLs below and twinServers.ports, so they can't drift.
//
// DEMO_CONTROL_PORT / DEMO_EXPERIMENT_PORT pin an exact pair — this config's
// own contract with the integration-test harness (helpers.ts), which resolves
// the pair up front so config evaluation, waitForPort(), and page.goto() in
// its child processes all agree. Plain TS: any project wanting env overrides
// writes them here, in its own config, like this.
const pinnedControl = Number(process.env.DEMO_CONTROL_PORT);
const pinnedExperiment = Number(process.env.DEMO_EXPERIMENT_PORT);
const { control: CONTROL_PORT, experiment: EXPERIMENT_PORT } =
  pinnedControl > 0 && pinnedExperiment > 0
    ? { control: pinnedControl, experiment: pinnedExperiment }
    : assignPortsAutomatically({ control: 3060, experiment: 3090 });

const PARALLELISM = Math.max(1, Math.floor(os.cpus().length / 2));

// Shared by perf and audit so both pipelines hit Lighthouse with the same
// network/CPU profile — drift here would make audit and perf disagree on
// what "the page" actually was.
const LIGHTHOUSE_CONFIG = {
  throttling: {
    rttMs: 100,
    throughputKbps: 2700,
    requestLatencyMs: 200,
    downloadThroughputKbps: 2700,
    uploadThroughputKbps: 2700,
    cpuSlowdownMultiplier: 3,
  },
  throttlingMethod: 'devtools' as const,
  logLevel: 'error' as const,
  output: 'html' as const,
  onlyCategories: ['performance'],
};

export default defineConfig({
  shared: {
    controlURL: `http://localhost:${CONTROL_PORT}`,
    experimentURL: `http://localhost:${EXPERIMENT_PORT}`,
    parallelism: PARALLELISM,
    retries: 1,
    // Browser-launch options every stage respects. Required — no hidden
    // defaults; visreg/perf may override per-category via
    // <category>.playwrightOptions (partial, per-key).
    playwrightOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
      // Default action + navigation timeout (ms) on every Playwright engine
      // (visreg, accessibility, agent-readiness). Lighthouse's page-load wait
      // is separate: lighthouseConfig.maxWaitForLoad.
      waitTimeout: 60_000,
    },
    browserConsole: {
      failOn: ['error', 'warn'],
      allowList: [
        'includes ~14KB of server-rendering code',
        // layouts/pages.html.erb declares no <link rel="icon">, so the browser
        // falls back to /favicon.ico and 404s. Only Lighthouse's chrome-launcher
        // Chrome actually requests it — Playwright's headless chromium doesn't —
        // so this fires in perf/audit but not visreg. Matched on the message's
        // location URL, which is the failing resource.
        'favicon.ico',
      ],
    },
    // Exercises the Node -> browser function boundary on every run, for free.
    // Playwright serializes a function argument with `Function.prototype.toString`,
    // so the emitted source has to stand alone once it lands in the page. A
    // transform that injects runtime helpers breaks that: esbuild's `keepNames`
    // wraps the NAMED inner function below in its `__name` helper, which exists
    // only in the Node module scope. If that ever reaches the
    // page again, this throws `__name is not defined` at document start, the
    // uncaught page error fails the unit, and visreg.spec.ts pins its absence.
    // Deliberately a no-op otherwise — it adds no work and no screenshots.
    beforeNavigate: ({ context }) => context.addInitScript(() => {
      const mark = () => {
        (window as unknown as { __shakaPerfSerializationCheck?: boolean })
          .__shakaPerfSerializationCheck = true;
      };
      mark();
    }),
  },

  visreg: {
    // Overrides shared.viewports (desktop + phone) for visreg alone —
    // screenshots are cheap, so the extra breakpoint is worth it here.
    viewports: ['desktop', 'tablet', 'phone'],
    maxNumDiffPixels: 50,
    mismatchThreshold: 0.1,
  },

  accessibility: {
    failOnViolation: false,
  },

  perf: {
    // No `viewports` — perf inherits shared.viewports (desktop + phone).
    // `formFactor` and `screenEmulation` are NOT set here — the viewport
    // referenced from shared.viewportDefinitions owns them; the runner lowers
    // them via lhConfigForViewport.
    lighthouseConfig: LIGHTHOUSE_CONFIG,
    numberOfMeasurements: 10,
    pValueThreshold: 0.01,
  },

  audit: {
    lighthouseConfig: LIGHTHOUSE_CONFIG,
  },

  twinServers: {
    experimentDir: process.cwd(),
    controlDir: process.env.CONTROL_REPO_DIR || '../../shaka-perf-control/demo-ecommerce',
    dockerBuildDir: '..',
    dockerfile: 'twin-servers/Dockerfile',
    procfile: 'twin-servers/Procfile',
    ports: {
      control: CONTROL_PORT,
      experiment: EXPERIMENT_PORT,
    },
    rebuildCommands: [
      {
        description: 'Install JavaScript dependencies',
        command: 'yarn install --immutable',
      },
      {
        description: 'Precompile application assets',
        command: 'rm -rf public/packs tmp/cache && SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile',
      },
    ],
    setupCommands: [
      { command: 'bin/rails db:prepare', description: 'Preparing database' },
      { command: 'bin/rails db:seed', description: 'Seeding database' },
    ],
  },
});
