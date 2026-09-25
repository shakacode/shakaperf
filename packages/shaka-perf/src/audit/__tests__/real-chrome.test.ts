/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page } from 'playwright-core';
import {
  applyRealChrome,
  realChromeUsesNativeIdentity,
  waitForBotWallToClear,
} from '../real-chrome';
import { chromeVersionFromProductString } from '../../browser-user-agent';

describe('chromeVersionFromProductString', () => {
  it('extracts a four-part version from Chrome product output', () => {
    expect(chromeVersionFromProductString('Google Chrome 150.0.7339.41')).toBe(
      '150.0.7339.41',
    );
    expect(chromeVersionFromProductString('Chrome/151.0.1.2')).toBe('151.0.1.2');
    expect(
      chromeVersionFromProductString('Google Chrome for Testing 141.0.7390.55'),
    ).toBe('141.0.7390.55');
    expect(chromeVersionFromProductString('Google Chrome')).toBeUndefined();
    expect(
      chromeVersionFromProductString('/usr/lib/chromium-browser/1.2.3.4/chrome: error'),
    ).toBeUndefined();
  });
});

describe('realChromeUsesNativeIdentity', () => {
  const orig = process.env.SHAKAPERF_REAL_CHROME;
  const origHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
  afterEach(() => {
    if (orig === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = orig;
    if (origHeadless === undefined) delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    else process.env.SHAKAPERF_REAL_CHROME_HEADLESS = origHeadless;
  });

  it('is only the headed real-Chrome desktop path', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(realChromeUsesNativeIdentity('desktop')).toBe(false);
    process.env.SHAKAPERF_REAL_CHROME = '1';
    delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    expect(realChromeUsesNativeIdentity('desktop')).toBe(true);
    expect(realChromeUsesNativeIdentity('mobile')).toBe(false);
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';
    expect(realChromeUsesNativeIdentity('desktop')).toBe(false);
  });
});

describe('applyRealChrome', () => {
  const orig = process.env.SHAKAPERF_REAL_CHROME;
  const origHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
  afterEach(() => {
    if (orig === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = orig;
    if (origHeadless === undefined) delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    else process.env.SHAKAPERF_REAL_CHROME_HEADLESS = origHeadless;
  });

  it('is a no-op when the env flag is off', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';
    const opts = { headless: true, args: ['--no-sandbox'] };
    expect(applyRealChrome(opts)).toEqual(opts);
  });

  it('defaults real Chrome to headed and strips automation when enabled', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    const out = applyRealChrome({ headless: true, args: ['--no-sandbox'] });
    expect(out.channel).toBe('chrome');
    expect(out.headless).toBe(false);
    expect(out.args).toEqual(['--no-sandbox', '--disable-blink-features=AutomationControlled']);
  });

  it('lets the explicit headless env override the caller headed mode', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';
    const out = applyRealChrome({ headless: false });
    expect(out.channel).toBe('chrome');
    expect(out.headless).toBe(true);
  });
});

describe('waitForBotWallToClear', () => {
  const orig = process.env.SHAKAPERF_REAL_CHROME;
  afterEach(() => {
    if (orig === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = orig;
  });

  const challenge = { title: 'Just a moment...', html: '<html>__cf_chl</html>' };
  const real = { title: 'Real Page', html: '<main>content</main>' };

  function mockPage(seq: Array<{ title: string; html: string } | 'throw'>) {
    let i = 0;
    const evaluate = jest.fn(async () => {
      const v = seq[Math.min(i, seq.length - 1)];
      i += 1;
      if (v === 'throw') throw new Error('Execution context was destroyed');
      return v;
    });
    const page = { evaluate, waitForTimeout: jest.fn(async () => {}) } as unknown as Page;
    return { page, evaluate };
  }

  it('does nothing when real-Chrome mode is off', async () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    const { page, evaluate } = mockPage([challenge]);
    await waitForBotWallToClear(page, 5000);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('returns as soon as the page is no longer a challenge', async () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    const { page, evaluate } = mockPage([challenge, real]);
    await waitForBotWallToClear(page, 5000);
    expect(evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps waiting when the probe throws mid-challenge, then returns once it clears', async () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    const { page, evaluate } = mockPage(['throw', real]);
    await waitForBotWallToClear(page, 5000);
    expect(evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('gives up at the budget when the challenge never clears (does not hang)', async () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    const { page } = mockPage([challenge]);
    await expect(waitForBotWallToClear(page, 30)).resolves.toBeUndefined();
  });
});
