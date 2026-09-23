/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { LaunchOptions, Page } from 'playwright-core';
import { looksLikeBotWall } from './bot-wall';

// Opt-in (SHAKAPERF_REAL_CHROME=1): drive the real installed Chrome with the
// automation flag stripped, instead of the bundled headless Chromium. Bot
// challenges (Cloudflare "Just a moment", Turnstile) that wall headless
// Playwright let a real-Chrome session through, so this is how we get a clean
// audit of a bot-protected site. Off by default - the bundled Chromium is what
// CI and most runs use; `channel: 'chrome'` requires Chrome to be installed.
export function applyRealChrome(opts: LaunchOptions): LaunchOptions {
  if (!isRealChromeEnabled()) return opts;
  // Default headed: interactive Turnstile challenges can still reject headless
  // Chrome. Some managed challenges auto-pass real Chrome headless, so
  // SHAKAPERF_REAL_CHROME_HEADLESS=1 explicitly selects that path.
  const headless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS === '1';
  return {
    ...opts,
    headless,
    channel: 'chrome',
    args: [
      ...(opts.args ?? []),
      '--disable-blink-features=AutomationControlled',
    ],
  };
}

export function isRealChromeEnabled(): boolean {
  return process.env.SHAKAPERF_REAL_CHROME === '1';
}

// A headed real-Chrome desktop context is the one place the browser keeps its
// own identity: it has to look exactly like the operator's Chrome to an
// interactive bot challenge. Every other context sends the viewport's device
// identity (see `device-identity.ts`).
export function realChromeUsesNativeIdentity(formFactor: string): boolean {
  return (
    isRealChromeEnabled()
    && process.env.SHAKAPERF_REAL_CHROME_HEADLESS !== '1'
    && formFactor !== 'mobile'
  );
}

// In real-Chrome mode a bot challenge can still flash for a second or two before
// its JS auto-solves and the real page loads. Poll until the page is no longer a
// challenge (or the budget elapses) so the scan reads the real page, not the
// interstitial. No-op unless real-Chrome mode is on (default audits never wait).
export async function waitForBotWallToClear(page: Page, budgetMs = 25000): Promise<void> {
  if (process.env.SHAKAPERF_REAL_CHROME !== '1') return;
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const probe = await page
      .evaluate(() => ({
        title: document.title,
        html: document.documentElement.outerHTML.slice(0, 4000),
      }))
      .catch(() => null);
    // A real page (no challenge markers) -> done. A failed probe means the JS
    // challenge tore down the execution context mid-navigation; keep waiting
    // (the budget bounds the loop) rather than proceeding on a half-loaded page.
    if (probe && !looksLikeBotWall({ title: probe.title, html: probe.html })) return;
    await page.waitForTimeout(2000).catch(() => {});
  }
}
