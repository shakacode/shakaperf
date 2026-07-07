/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  throttlingMethod: 'simulate' as const,
  logLevel: 'error' as const,
  output: 'html' as const,
  onlyCategories: ['performance'],
};

export default defineConfig({
  shared: {
    controlURL: `http://localhost:${CONTROL_PORT}`,
    experimentURL: `http://localhost:${EXPERIMENT_PORT}`,
    parallelism: PARALLELISM,
    retries: 1
  },

  visreg: {
    // viewports default to ['desktop', 'tablet', 'phone'] — full defs live
    // in shared.viewports (also defaulted).
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
    maxNumDiffPixels: 50,
    defaultMisMatchThreshold: 0.1,
  },

  accessibility: {
    failOnViolation: false,
  },

  perf: {
    // viewports default to ['desktop', 'phone']. `formFactor` and
    // `screenEmulation` are NOT set here — the viewport referenced from
    // shared.viewports owns them; the runner lowers them via
    // lhConfigForViewport.
    lighthouseConfig: LIGHTHOUSE_CONFIG,
    numberOfMeasurements: 8, // Just to make CI faster
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
    setupCommands: [
      { command: 'bin/rails db:prepare', description: 'Preparing database' },
      { command: 'bin/rails db:seed', description: 'Seeding database' },
    ],
  },
});
