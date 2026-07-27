/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { LaunchOptions, Page } from 'playwright-core';
import { REAL_CHROME_MOBILE_USER_AGENT } from '../browser-user-agent';
import { looksLikeBotWall } from './bot-wall';

// Opt-in (SHAKAPERF_REAL_CHROME=1): drive the real installed Chrome with the
// automation flag stripped, instead of the bundled headless Chromium. Bot
// challenges (Cloudflare "Just a moment", Turnstile) that wall headless
// Playwright let a real-Chrome session through, so this is how we get a clean
// audit of a bot-protected site. Off by default - the bundled Chromium is what
// CI and most runs use; `channel: 'chrome'` requires Chrome to be installed.
export function applyRealChrome(opts: LaunchOptions): LaunchOptions {
  if (process.env.SHAKAPERF_REAL_CHROME !== '1') return opts;
  // Default headed: interactive Turnstile challenges can still reject headless
  // Chrome. Some managed challenges auto-pass real Chrome headless, so
  // SHAKAPERF_REAL_CHROME_HEADLESS=1 explicitly selects that path. This also
  // makes --headed unnecessary, leaving the separate Lighthouse browser
  // headless and avoiding its headed screencast attachment issue.
  const headless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS === '1';
  return {
    ...opts,
    headless,
    channel: 'chrome',
    args: [
      ...(opts.args ?? []),
      '--disable-blink-features=AutomationControlled',
      ...(headless ? [`--user-agent=${REAL_CHROME_MOBILE_USER_AGENT}`] : []),
    ],
  };
}

// Headed real Chrome won't honor a small mobile viewport (it renders a desktop
// breakpoint) unless the context is a full mobile device, so add mobile UA + touch.
// Real-Chrome + mobile only; headless already honors the viewport, so it's a no-op there.
export function realChromeMobileEmulation(
  formFactor: string,
): { userAgent: string; hasTouch: boolean } | undefined {
  if (process.env.SHAKAPERF_REAL_CHROME !== '1') return undefined;
  if (formFactor !== 'mobile') return undefined;
  return { userAgent: REAL_CHROME_MOBILE_USER_AGENT, hasTouch: true };
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
