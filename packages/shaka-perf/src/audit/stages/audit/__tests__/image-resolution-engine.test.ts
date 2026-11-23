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
  });

  afterEach(() => {
    if (previousRealChrome === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = previousRealChrome;
    log.mockRestore(); warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const findings = {
    images: [{ label: 'img#photo', src: 'https://example.test/photo.png', fit: 'fill',
      boxWidth: 100, boxHeight: 100, naturalWidth: 50, naturalHeight: 50,
      sourceWidth: 50, sourceHeight: 50, devicePixelRatio: 1, status: 'undersized', ratio: 0.5 }],
    undersized: 1, oversized: 0, unknown: 0,
  };
  const unavailable = { status: 'unavailable', reason: 'Image collector timed out.' };
  const thresholds = { minRatio: 0.8, maxRatio: 3 };

  it.each([
    { enabled: false, failOnUndersized: false, force: false, sample: undefined,
      expected: { status: 'disabled', failOnUndersized: false } },
    { enabled: false, failOnUndersized: false, force: true, sample: findings,
      expected: { ...findings, failOnUndersized: true } },
    { enabled: true, failOnUndersized: true, force: false, sample: findings,
      expected: { ...findings, failOnUndersized: true } },
    { enabled: true, failOnUndersized: false, force: false, sample: findings,
      expected: { ...findings, failOnUndersized: false } },
    { enabled: true, failOnUndersized: true, force: false, sample: unavailable,
      expected: { ...unavailable, failOnUndersized: true } },
    { enabled: true, failOnUndersized: false, force: false, sample: undefined,
      expected: { status: 'unavailable', reason: expect.any(String), failOnUndersized: false } },
  ])('preserves speed metrics and saves the effective image policy (case %#)', async policy => {
    jest.mocked(measureTest).mockResolvedValue([{ group: 'experiment', samples: [{
      phases: [{ phase: 'LCP', duration: 1_200_000, start: 0, sign: 1, unit: 'ms' }],
      duration: 1_200_000, metadata: {}, imageResolution: policy.sample,
    }] }] as never);
    const test = { name: 'Product', startingPath: '/', file: null, line: null, testTypes: null, testFn: async () => {} } as AbTestDefinition;
    const config = buildAbTestsConfig({
      shared: {
        controlURL: 'https://example.test', experimentURL: 'https://example.test', parallelism: 1,
        playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
        browserConsole: { failOn: [], allowList: [] },
      },
      audit: { imageResolution: { ...thresholds, enabled: policy.enabled, failOnUndersized: policy.failOnUndersized } },
    });
    const ctx = {
      config, test, viewport: DESKTOP_VIEWPORT, experimentURL: 'https://example.test',
      artifacts: new ArtifactStore(dir).scopeFor(test, 'desktop'),
      runtime: { resultsRoot: dir }, testAndViewportId: 'product-desktop',
    } as TestContext;
    const result = await runAuditStage(ctx, {} as WorkerPool, { failOnUndersizedImages: policy.force });
    const options = jest.mocked(createLighthouseBenchmark).mock.calls[0]![2];
    if (policy.enabled || policy.force) {
      expect(options.imageResolution).toEqual(thresholds);
    } else {
      expect(options).not.toHaveProperty('imageResolution');
    }
    expect(result.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'LCP', value: 1200 })]));
    expect(result.imageResolution).toEqual(policy.expected);
  });
});
