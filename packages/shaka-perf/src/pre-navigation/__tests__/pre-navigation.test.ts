/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import { setUpContextForNavigation } from '../index';
import type { Viewport } from 'shaka-shared';

const VIEWPORT: Viewport = { label: 'phone', width: 375, height: 667, formFactor: 'mobile', deviceScaleFactor: 3 };

function fakeContext() {
  const calls: string[] = [];
  // No `newCDPSession` → clearBrowserData early-returns (cache clear is CDP-only),
  // which keeps this fake free of page plumbing; we're asserting order here.
  const context = {
    clearCookies: jest.fn(async () => { calls.push('clearCookies'); }),
  } as unknown as BrowserContext;
  return { context, calls };
}

describe('setUpContextForNavigation', () => {
  it('clears first, then runs the beforeNavigate hook (so a hook-seeded cookie survives)', async () => {
    const { context, calls } = fakeContext();
    const hook = jest.fn(async () => { calls.push('hook'); });

    await setUpContextForNavigation({
      context,
      url: 'https://x.com/',
      viewport: VIEWPORT,
      isControl: true,
      testType: 'visreg',
      beforeNavigate: hook,
    });

    expect(calls).toEqual(['clearCookies', 'hook']);
  });

  it('with no hook, only clears', async () => {
    const { context, calls } = fakeContext();
    await setUpContextForNavigation({
      context,
      url: 'https://x.com/',
      viewport: VIEWPORT,
      isControl: false,
      testType: 'perf',
    });
    expect(calls).toEqual(['clearCookies']);
  });
});
