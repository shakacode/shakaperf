/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describe, it, expect } from '@jest/globals';
import { buildAbTestsConfig, type AbTestsConfig } from '../../config';
import { applyPerTestConfigOverrides } from '../../effective-config';
import { taskLimitsResolver } from '../task-limits';
import type { PipelineWorkerPool } from '../pipeline';
import type { TaskLimits } from '../worker-pool';
import type { AbTestDefinition, PerTestConfig } from 'shaka-shared';

const fileConfig = (shared: Record<string, unknown> = {}): AbTestsConfig =>
  buildAbTestsConfig({
    shared: {
      controlURL: 'http://control.test',
      experimentURL: 'http://experiment.test',
      parallelism: 1,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
      browserConsole: { failOn: ['error', 'warn'], allowList: [] },
      ...shared,
    },
  });

const workerPool = (limits?: Partial<TaskLimits>): PipelineWorkerPool =>
  ({ id: 'worker-pool-1', parallelism: 1, ...(limits ? { limits } : {}) });

const NOT_BURNING = null;

const testWithConfig = (config: PerTestConfig): AbTestDefinition =>
  ({ name: 'a test', config } as AbTestDefinition);

describe('taskLimitsResolver', () => {
  it('reads the budgets off whatever config it is handed', () => {
    const resolve = taskLimitsResolver(workerPool(), NOT_BURNING);
    expect(resolve(fileConfig({ timeoutMs: 9_000, retries: 4, retryDelay: 250 })))
      .toEqual({ timeoutMs: 9_000, retries: 4, retryDelay: 250 });
  });

  it('gives a test its own budgets and everyone else the file\'s', () => {
    // The exact composition the runner performs per unit: file config, the
    // test's `config` merged over it, then the resolver. This is what used to
    // be dropped — the merge happened and the result went unread.
    const file = fileConfig({ timeoutMs: 120_000, retries: 2, retryDelay: 1_000 });
    const resolve = taskLimitsResolver(workerPool(), NOT_BURNING);

    const slowTest = testWithConfig({ shared: { timeoutMs: 600_000, retries: 0 } });
    expect(resolve(applyPerTestConfigOverrides(file, slowTest)))
      .toEqual({ timeoutMs: 600_000, retries: 0, retryDelay: 1_000 });

    const plainTest = testWithConfig({ visreg: { maxNumDiffPixels: 10 } });
    expect(resolve(applyPerTestConfigOverrides(file, plainTest)))
      .toEqual({ timeoutMs: 120_000, retries: 2, retryDelay: 1_000 });
  });

  it('lets a pool pin the budgets its own topology dictates', () => {
    // `troubleshoot`'s pools freeze their browsers: a test asking for a 30s cap
    // and 5 retries must reintroduce neither. The budget the pool says nothing
    // about still comes from the config.
    const resolve = taskLimitsResolver(workerPool({ timeoutMs: 0, retries: 0 }), NOT_BURNING);
    const file = fileConfig({ timeoutMs: 120_000, retryDelay: 1_000 });
    const impatient = testWithConfig({ shared: { timeoutMs: 30_000, retries: 5 } });

    expect(resolve(applyPerTestConfigOverrides(file, impatient)))
      .toEqual({ timeoutMs: 0, retries: 0, retryDelay: 1_000 });
  });

  it('zeroes retries under --burn, over any config and any pool', () => {
    // A burn instance's raw outcome IS the measurement, so no retry may mask a
    // failure — not the file's, not a test's, not the pool's.
    const resolve = taskLimitsResolver(workerPool({ retries: 3 }), 5);
    const file = fileConfig({ retries: 2 });
    const retryHappy = testWithConfig({ shared: { retries: 7 } });

    expect(resolve(applyPerTestConfigOverrides(file, retryHappy)).retries).toBe(0);
    expect(resolve(file).retries).toBe(0);
  });
});
