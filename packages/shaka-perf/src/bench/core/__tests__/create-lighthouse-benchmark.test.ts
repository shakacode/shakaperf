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
  lighthouseWorkerSetupOptions,
  lighthouseWorkerUserAgent,
  resetRealChromeHeadlessWarning,
  warnIfRealChromeHeadlessOverridesHeaded,
} from '../create-lighthouse-benchmark';
import {
  lighthouseSamplerReuseKey,
} from '../lighthouse-sampling-worker-pool';

const desktopViewport = {
  label: 'desktop',
  formFactor: 'desktop',
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
} as LighthouseBenchmarkOptions['viewport'];

const originalRealChrome = process.env.SHAKAPERF_REAL_CHROME;
const originalRealChromeHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;

beforeEach(() => {
  resetRealChromeHeadlessWarning();
});

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

const phoneViewport = { ...desktopViewport, label: 'phone', formFactor: 'mobile', width: 375 } as LighthouseBenchmarkOptions['viewport'];
const tabletViewport = { ...desktopViewport, label: 'tablet', formFactor: 'mobile', width: 768 } as LighthouseBenchmarkOptions['viewport'];

function benchmarkFor(options: Partial<LighthouseBenchmarkOptions> & { viewport: LighthouseBenchmarkOptions['viewport'] }) {
  return createLighthouseBenchmark(
    'experiment',
    { file: null, name: 'example' } as Parameters<typeof createLighthouseBenchmark>[1],
    { lhConfig: {}, targetUrl: 'https://example.com', ...options },
  );
}

describe('lighthouseWorkerEnvironment', () => {
  it('forces an audit real-Chrome worker headless and forwards its viewport identity', () => {
    expect(lighthouseWorkerEnvironment({
      realChrome: { headless: true },
      viewport: desktopViewport,
    }, 'sequential')).toEqual({
      SHAKA_PERF_BARRIER_SYNCHRONIZATION_FD: '4',
      SHAKA_PERF_SAMPLING_MODE: 'sequential',
      SHAKAPERF_REAL_CHROME: '1',
      SHAKAPERF_REAL_CHROME_HEADLESS: '1',
      SHAKA_PERF_VIEWPORT_USER_AGENT: expect.stringMatching(/Macintosh.*Chrome\/\d+.*Safari/),
      SHAKA_PERF_VIEWPORT_USER_AGENT_IS_EXPLICIT: '0',
    });
  });

  it('gives every worker its viewport device identity, in every mode', () => {
    expect(lighthouseWorkerUserAgent({ viewport: desktopViewport })).toMatch(/Macintosh/);
    expect(lighthouseWorkerUserAgent({ viewport: phoneViewport })).toMatch(/Android.*Mobile Safari/);
    const tablet = lighthouseWorkerUserAgent({ viewport: tabletViewport });
    expect(tablet).toMatch(/Android/);
    expect(tablet).not.toContain('Mobile');
    expect(lighthouseWorkerUserAgent({
      viewport: { ...phoneViewport, userAgent: 'custom-ua' },
    })).toBe('custom-ua');
    expect(lighthouseWorkerEnvironment({
      viewport: { ...phoneViewport, userAgent: 'custom-ua' },
    }, 'sequential')).toEqual(expect.objectContaining({
      SHAKA_PERF_VIEWPORT_USER_AGENT: 'custom-ua',
      SHAKA_PERF_VIEWPORT_USER_AGENT_IS_EXPLICIT: '1',
    }));
  });

  it('keeps the native identity only for a headed real-Chrome desktop worker', () => {
    expect(lighthouseWorkerUserAgent({
      viewport: desktopViewport,
      realChrome: { headless: false },
    })).toBeUndefined();
    expect(lighthouseWorkerUserAgent({
      viewport: phoneViewport,
      realChrome: { headless: false },
    })).toMatch(/Mobile/);
    expect(lighthouseWorkerUserAgent({
      viewport: desktopViewport,
      realChrome: { headless: true },
    })).toMatch(/Macintosh/);
    expect(lighthouseWorkerEnvironment({
      viewport: desktopViewport,
      realChrome: { headless: false },
    }, 'sequential')).toEqual(expect.objectContaining({ SHAKA_PERF_VIEWPORT_USER_AGENT: '' }));
  });

  it('shares a sampler only between benchmarks that launch Chrome with the same identity', () => {
    const desktop = benchmarkFor({ viewport: desktopViewport });
    const phone = benchmarkFor({ viewport: phoneViewport });
    const tablet = benchmarkFor({ viewport: tabletViewport });
    const nativeDesktop = benchmarkFor({ viewport: desktopViewport, realChrome: { headless: false } });

    expect(desktop.workerReuseKey).toMatch(/Macintosh/);
    expect(lighthouseSamplerReuseKey([desktop])).toBe(lighthouseSamplerReuseKey([benchmarkFor({ viewport: desktopViewport })]));
    const keys = new Set([desktop, phone, tablet, nativeDesktop].map((b) => lighthouseSamplerReuseKey([b])));
    expect(keys.size).toBe(4);
    expect(nativeDesktop.workerReuseKey).toBe('native');
  });

  it('does not enable audit real-Chrome mode from ambient state', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';

    expect(lighthouseWorkerEnvironment({
      viewport: desktopViewport,
    }, 'simultaneous')).toEqual(expect.objectContaining({
      SHAKAPERF_REAL_CHROME: '0',
    }));
  });

  it('defaults every real-Chrome worker to the same headed mode as Playwright', () => {
    expect(lighthouseWorkerEnvironment({
      realChrome: { headless: false },
      viewport: desktopViewport,
    }, 'simultaneous')).toEqual(expect.objectContaining({
      SHAKAPERF_REAL_CHROME: '1',
      SHAKAPERF_REAL_CHROME_HEADLESS: '0',
    }));
  });

  it('emulates the viewport device identity by default, and none in native mode', () => {
    expect(lhConfigForViewport(desktopViewport).emulatedUserAgent).toMatch(/Macintosh/);
    expect(lhConfigForViewport(phoneViewport).emulatedUserAgent).toContain('Mobile');
    expect(lhConfigForViewport(tabletViewport).emulatedUserAgent).toMatch(/Android/);
    expect(lhConfigForViewport(tabletViewport).emulatedUserAgent).not.toContain('Mobile');
    expect(lhConfigForViewport({ ...phoneViewport, userAgent: 'custom-ua' }).emulatedUserAgent)
      .toBe('custom-ua');
    expect(lhConfigForViewport(desktopViewport, {}, 'native').emulatedUserAgent).toBe(false);
  });

  it('preserves an explicit Lighthouse identity override', () => {
    expect(lhConfigForViewport(desktopViewport, {
      emulatedUserAgent: 'custom-user-agent',
    }, 'viewport').emulatedUserAgent).toBe('custom-user-agent');
    expect(lhConfigForViewport(desktopViewport, {
      emulatedUserAgent: false,
    }, 'viewport').emulatedUserAgent).toBe(false);
    expect(lhConfigForViewport(desktopViewport, {
      emulatedUserAgent: 'custom-user-agent',
    }, 'native').emulatedUserAgent).toBe('custom-user-agent');
  });
});

describe('lighthouseWorkerSetupOptions', () => {
  it('defaults real Chrome to headed and lets its explicit headless mode override all other inputs', () => {
    expect(lighthouseWorkerSetupOptions({
      playwrightOptions: {},
      realChrome: { headless: false },
    })).toMatchObject({ headed: true });
    expect(lighthouseWorkerSetupOptions({
      playwrightOptions: { headless: false },
      realChrome: { headless: true },
    })).toMatchObject({ headed: false });
  });

  // Visibility has ONE source now: `headless` on the resolved launch options,
  // which the caller has already folded `--headed` into.
  // Visibility has one source: the `headed` option, from the `--headed` flag.
  // `playwrightOptions` carries no `headless` — the config schema rejects it.
  it('reads visibility only from headed', () => {
    expect(lighthouseWorkerSetupOptions({ headed: true })).toMatchObject({ headed: true });
    expect(lighthouseWorkerSetupOptions({ headed: false })).toMatchObject({ headed: false });
    expect(lighthouseWorkerSetupOptions({})).toMatchObject({ headed: false });
  });

  it('carries keep-open on those same options rather than a parallel field', () => {
    expect(lighthouseWorkerSetupOptions({ playwrightOptions: { keepBrowserOpen: true } }))
      .toMatchObject({ keepBrowserOpen: true });
    expect(lighthouseWorkerSetupOptions({ playwrightOptions: {} }))
      .toMatchObject({ keepBrowserOpen: false });
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
