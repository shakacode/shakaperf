/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import { buildAbTestsConfig } from '../../../../config';
import { createLighthouseBenchmark, measureTest } from '../../../../bench/core';
import { ArtifactStore } from '../../../../pipeline/artifact-store';
import type { WorkerPool } from '../../../../pipeline/worker-pool';
import type { TestContext } from '../../../../stage/stage';
import { runAuditStage } from '../engine';

jest.mock('../../../../bench/core', () => ({
  createLighthouseBenchmark: jest.fn(() => ({})),
  createWorkerLighthouseSamplingPool: () => ({}),
  measureTest: jest.fn(),
}));
jest.mock('../../../../bench/core/patched-lighthouse/register-patch', () => ({ ensureLighthousePatchRegistered() {} }));

describe('audit image check policy', () => {
  let dir: string;
  let previousRealChrome: string | undefined;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-check-engine-'));
    previousRealChrome = process.env.SHAKAPERF_REAL_CHROME;
    process.env.SHAKAPERF_REAL_CHROME = '1'; // No unrelated accessibility subprocess in this engine fixture.
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(createLighthouseBenchmark).mockClear();
    jest.mocked(measureTest).mockResolvedValue([{ group: 'experiment', samples: [{
      phases: [{ phase: 'LCP', duration: 1_200_000, start: 0, sign: 1, unit: 'ms' }],
      duration: 1_200_000, metadata: {},
    }] }] as never);
  });

  afterEach(() => {
    if (previousRealChrome === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = previousRealChrome;
    log.mockRestore(); warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    { enabled: false, failOnUndersized: false, force: false, expectedEnabled: false, expectedFail: false, status: 'disabled' },
    { enabled: false, failOnUndersized: false, force: true, expectedEnabled: true, expectedFail: true, status: 'unavailable' },
    { enabled: true, failOnUndersized: true, force: false, expectedEnabled: true, expectedFail: true, status: 'unavailable' },
    { enabled: true, failOnUndersized: false, force: false, expectedEnabled: true, expectedFail: false, status: 'unavailable' },
  ])('preserves speed metrics and applies image policy: %j', async policy => {
    const test = { name: 'Product', startingPath: '/', file: null, line: null, testTypes: null, testFn: async () => {} } as AbTestDefinition;
    const config = buildAbTestsConfig({
      shared: {
        controlURL: 'https://example.test', experimentURL: 'https://example.test', parallelism: 1,
        playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
        browserConsole: { failOn: [], allowList: [] },
      },
      audit: { imageResolution: { enabled: policy.enabled, failOnUndersized: policy.failOnUndersized } },
    });
    const ctx = {
      config, test, viewport: DESKTOP_VIEWPORT, experimentURL: 'https://example.test',
      artifacts: new ArtifactStore(dir).scopeFor(test, 'desktop'),
      runtime: { resultsRoot: dir }, testAndViewportId: 'product-desktop',
    } as TestContext;
    const result = await runAuditStage(ctx, {} as WorkerPool, { failOnUndersizedImages: policy.force });
    const options = jest.mocked(createLighthouseBenchmark).mock.calls[0]![2];
    if (policy.expectedEnabled) {
      expect(options.imageResolution).toMatchObject({ failOnUndersized: policy.expectedFail });
    } else {
      expect(options).not.toHaveProperty('imageResolution');
    }
    expect(result.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'LCP', value: 1200 })]));
    expect(result.imageResolution).toMatchObject({ status: policy.status, failOnUndersized: policy.expectedFail });
  });
});
