/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page } from 'playwright-core';
import { applyRealChrome, realChromeContextOptions, waitForBotWallToClear } from '../real-chrome';
import {
  matchRealChromeUserAgentVersion,
  REAL_CHROME_DESKTOP_USER_AGENT,
} from '../../browser-user-agent';

describe('matchRealChromeUserAgentVersion', () => {
  it.each([undefined, '', 'abc', '150'])(
    'preserves the fallback user agent for an unusable browser version (%p)',
    (browserVersion) => {
      expect(
        matchRealChromeUserAgentVersion(REAL_CHROME_DESKTOP_USER_AGENT, browserVersion),
      ).toBe(REAL_CHROME_DESKTOP_USER_AGENT);
    },
  );
});

describe('realChromeContextOptions', () => {
  const orig = process.env.SHAKAPERF_REAL_CHROME;
  const origHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
  afterEach(() => {
    if (orig === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
    else process.env.SHAKAPERF_REAL_CHROME = orig;
    if (origHeadless === undefined) delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    else process.env.SHAKAPERF_REAL_CHROME_HEADLESS = origHeadless;
  });

  it('is undefined when real-Chrome mode is off (default path unchanged)', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(realChromeContextOptions('mobile', '150.0.0.0')).toBeUndefined();
  });

  it('uses a desktop UA without the headless token for non-mobile viewports', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';
    expect(realChromeContextOptions('desktop', '150.0.0.0')).toEqual({
      userAgent: expect.stringMatching(/Chrome\/150\.0\.0\.0 Safari\/537\.36$/),
    });
    expect(realChromeContextOptions('tablet', '150.0.0.0')).toEqual({
      userAgent: expect.not.stringContaining('Mobile'),
    });
  });

  it('returns a mobile UA + touch for a mobile viewport in real-Chrome mode', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    const out = realChromeContextOptions('mobile', '150.0.0.0');
    expect(out?.hasTouch).toBe(true);
    expect(out?.userAgent).toMatch(/Mobile/);
    expect(out?.userAgent).toMatch(/Chrome\/150\.0\.0\.0/);
  });

  it('keeps the native desktop UA on the headed path', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    expect(realChromeContextOptions('desktop', '150.0.0.0')).toBeUndefined();
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
    expect(out.args).not.toContainEqual(expect.stringMatching(/^--user-agent=/));
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
