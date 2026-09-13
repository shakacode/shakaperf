/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describe, it, expect } from '@jest/globals';
import { buildAbTestsConfig } from '../../config';
import { createTroubleshootPipeline } from '../pipeline';

describe('createTroubleshootPipeline', () => {
  const config = buildAbTestsConfig({
    shared: {
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      parallelism: 1,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
      browserConsole: { failOn: ['error', 'warn'], allowList: [] },
      // What a real user's config looks like — and what must NOT reach these
      // pools, because the frozen browsers ARE this command's output.
      timeoutMs: 120_000,
      retries: 2,
    },
  });

  it('freezes every pool it registers, so no track can be cut short', () => {
    // The guarantee used to be stated once, command-wide, as run options —
    // it covered pools that did not exist yet. It is now per-pool opt-in, so
    // a track added without the frozen limits silently inherits the file's
    // 120s cap and 2 retries: its browsers die mid-inspection, and the retry
    // builds a SECOND set of windows that also never close. Nothing in the
    // type system catches that. This does.
    const pools = createTroubleshootPipeline(config).workerPools;

    expect(pools.length).toBeGreaterThan(0);
    for (const pool of pools) {
      expect(pool.limits).toEqual({ timeoutMs: 0, retries: 0 });
    }
  });

  it('runs every stage on a frozen pool', () => {
    // Registering a frozen pool is not enough if a stage runs on some other
    // one. Every `run-stage` step must target a pool that carries the pin.
    const pipeline = createTroubleshootPipeline(config);
    const frozen = new Set(
      pipeline.workerPools.filter((pool) => pool.limits?.timeoutMs === 0 && pool.limits?.retries === 0),
    );

    const stageSteps = pipeline.steps.filter((step) => step.kind === 'run-stage');
    expect(stageSteps.length).toBeGreaterThan(0);
    for (const step of stageSteps) {
      expect(frozen.has(step.pool)).toBe(true);
    }
  });
});
