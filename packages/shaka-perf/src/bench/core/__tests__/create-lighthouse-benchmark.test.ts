/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { LighthouseBenchmarkOptions } from '../lighthouse-config';
import createLighthouseBenchmark, {
  lighthouseWorkerEnvironment,
  warnIfRealChromeHeadlessOverridesHeaded,
} from '../create-lighthouse-benchmark';
import {
  lighthouseSamplerReuseKey,
} from '../lighthouse-sampling-worker-pool';

const desktopViewport = {
  formFactor: 'desktop',
} as LighthouseBenchmarkOptions['viewport'];

afterEach(() => {
  jest.restoreAllMocks();
});

describe('lighthouseWorkerEnvironment', () => {
  it('forces an audit real-Chrome worker headless and forwards its viewport identity', () => {
    expect(lighthouseWorkerEnvironment({
      headed: true,
      realChrome: { headless: true },
      viewport: desktopViewport,
    }, 'sequential')).toEqual({
      SHAKA_PERF_BARRIER_SYNCHRONIZATION_FD: '4',
      SHAKA_PERF_SAMPLING_MODE: 'sequential',
      SHAKA_PERF_HEADED: '0',
      SHAKAPERF_REAL_CHROME: '1',
      SHAKA_PERF_VIEWPORT_FORM_FACTOR: 'desktop',
    });
  });

  it('binds real-Chrome sampler reuse to the viewport form factor', () => {
    const benchmark = createLighthouseBenchmark(
      'experiment',
      { file: null, name: 'example' } as Parameters<typeof createLighthouseBenchmark>[1],
      {
        viewport: desktopViewport,
        lhConfig: {},
        targetUrl: 'https://example.com',
        realChrome: { headless: true },
      },
    );
    const desktopKey = lighthouseSamplerReuseKey([benchmark]);
    const mobileKey = lighthouseSamplerReuseKey([{
      ...benchmark,
      workerReuseKey: 'mobile',
    }]);

    expect(benchmark.workerReuseKey).toBe('desktop');
    expect(desktopKey).not.toBe(mobileKey);
  });

  it('does not enable audit real-Chrome mode from ambient state', () => {
    expect(lighthouseWorkerEnvironment({
      headed: true,
      viewport: desktopViewport,
    }, 'simultaneous')).toEqual(expect.objectContaining({
      SHAKA_PERF_HEADED: '1',
      SHAKAPERF_REAL_CHROME: '0',
    }));
  });
});

describe('warnIfRealChromeHeadlessOverridesHeaded', () => {
  it('explains when explicit headless real Chrome overrides headed mode', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    warnIfRealChromeHeadlessOverridesHeaded({
      headed: true,
      realChrome: { headless: true },
    });
    warnIfRealChromeHeadlessOverridesHeaded({
      headed: true,
      realChrome: { headless: true },
    });

    expect(warn).toHaveBeenCalledWith(
      'SHAKAPERF_REAL_CHROME_HEADLESS=1 overrides --headed for the audit browsers',
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
