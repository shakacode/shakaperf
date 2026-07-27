/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  lhConfigForViewport,
  type LighthouseBenchmarkOptions,
} from '../lighthouse-config';
import createLighthouseBenchmark, {
  lighthouseWorkerEnvironment,
  warnIfRealChromeHeadlessOverridesHeaded,
} from '../create-lighthouse-benchmark';
import {
  lighthouseSamplerReuseKey,
} from '../lighthouse-sampling-worker-pool';

const desktopViewport = {
  formFactor: 'desktop',
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
} as LighthouseBenchmarkOptions['viewport'];

const originalRealChrome = process.env.SHAKAPERF_REAL_CHROME;
const originalRealChromeHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;

afterEach(() => {
  if (originalRealChrome === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
  else process.env.SHAKAPERF_REAL_CHROME = originalRealChrome;
  if (originalRealChromeHeadless === undefined) {
    delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
  } else {
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = originalRealChromeHeadless;
  }
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
    process.env.SHAKAPERF_REAL_CHROME = '1';
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';

    expect(lighthouseWorkerEnvironment({
      headed: true,
      viewport: desktopViewport,
    }, 'simultaneous')).toEqual(expect.objectContaining({
      SHAKA_PERF_HEADED: '1',
      SHAKAPERF_REAL_CHROME: '0',
    }));
  });

  it('defaults every real-Chrome worker to the same headed mode as Playwright', () => {
    expect(lighthouseWorkerEnvironment({
      realChrome: { headless: false },
      viewport: desktopViewport,
    }, 'simultaneous')).toEqual(expect.objectContaining({
      SHAKA_PERF_HEADED: '1',
      SHAKAPERF_REAL_CHROME: '1',
    }));
  });

  it('pins the Lighthouse identity to the viewport outside real-Chrome mode too', () => {
    expect(lhConfigForViewport(desktopViewport).emulatedUserAgent).not.toContain('Mobile');
    expect(lhConfigForViewport({
      ...desktopViewport,
      formFactor: 'mobile',
    }).emulatedUserAgent).toContain('Mobile');
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
