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
  const initScripts: string[] = [];
  // No `newCDPSession` → clearBrowserData early-returns (cache clear is CDP-only),
  // which keeps this fake free of page plumbing; we're asserting order here.
  const context = {
    clearCookies: jest.fn(async () => { calls.push('clearCookies'); }),
    addInitScript: jest.fn(async (script: string) => {
      calls.push('addInitScript');
      initScripts.push(script);
    }),
  } as unknown as BrowserContext;
  return { context, calls, initScripts };
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

    expect(calls).toEqual(['clearCookies', 'addInitScript', 'hook']);
  });

  it('with no hook, still clears and installs the shim', async () => {
    const { context, calls } = fakeContext();
    await setUpContextForNavigation({
      context,
      url: 'https://x.com/',
      viewport: VIEWPORT,
      isControl: false,
      testType: 'perf',
    });
    expect(calls).toEqual(['clearCookies', 'addInitScript']);
  });

  // A function serialized into the page by addInitScript/evaluate carries
  // esbuild's `keepNames` helper with it; without this the script dies on
  // `__name is not defined` and the run stays green with wrong screenshots.
  it('defines __name in the page, deferring to a bundle that ships its own', async () => {
    const { context, initScripts } = fakeContext();
    await setUpContextForNavigation({
      context,
      url: 'https://x.com/',
      viewport: VIEWPORT,
      isControl: true,
      testType: 'visreg',
    });

    expect(initScripts).toHaveLength(1);
    expect(initScripts[0]).toContain('globalThis.__name ||=');

    // Behavioural check: evaluating it must make `__name` a name-preserving
    // pass-through, which is all the transpiled call site needs.
    const scope: { __name?: (fn: unknown, name: string) => unknown } = {};
    new Function('globalThis', initScripts[0])(scope);
    const fn = () => 'ok';
    expect(scope.__name?.(fn, 'attach')).toBe(fn);
    expect(fn.name).toBe('attach');
  });
});
