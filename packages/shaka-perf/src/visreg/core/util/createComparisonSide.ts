/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Browser, BrowserContext, PlaywrightPage, Viewport, DecoratedCompareConfig } from '../types';

// JSON-bridge safety net only: the compare runner always writes the resolved
// `waitTimeout` (required on `shared.playwrightOptions`) into the temp config,
// so this fires only for a hand-built engine config that bypassed zod.
const DEFAULT_NAV_TIMEOUT = 60000;

export type ComparisonSideName = 'control' | 'experiment';

export interface ComparisonSide {
  side: ComparisonSideName;
  context: BrowserContext;
  page: PlaywrightPage;
  /** Close this side's context. Best-effort; safe if it's already gone. */
  dispose: () => Promise<void>;
}

/**
 * Single source of truth for building one side (control or experiment) of a
 * compare run: a fresh, isolated browser context + page, configured with the
 * scenario viewport and navigation timeout.
 *
 * Used for every attempt in runCompareAttempts — attempt 0 (the initial
 * capture) and every retry alike — so a retry reproduces the initial attempt's
 * environment EXACTLY: same context options, viewport, timeout. Per-attempt fresh contexts
 * exist to stop a state-mutating testFn (add-to-cart, sign-in) from stacking
 * across retries; that guarantee only holds if both paths build the context
 * identically. If they derived options independently they could drift (a new
 * `newContext` option added to one path but not the other), and retries would
 * render in a subtly different environment — reintroducing false diffs.
 *
 * `onContextReady` runs after the context is built but BEFORE the page is
 * created — the hook point for pre-nav setup (cookie loading, beforeNavigate
 * hooks) that must be in place before the page's first navigation.
 */
export async function createComparisonSide(
  browser: Browser,
  config: DecoratedCompareConfig,
  viewport: Viewport,
  side: ComparisonSideName,
  onContextReady?: (context: BrowserContext) => Promise<void>,
): Promise<ComparisonSide> {
  const { playwrightOptions = {} } = config;
  // Default true on every engine; `false` opts into strict cert checking.
  const ignoreHTTPSErrors = playwrightOptions.ignoreHTTPSErrors !== false;
  const waitTimeout = playwrightOptions.waitTimeout ?? DEFAULT_NAV_TIMEOUT;
  const VP_W = viewport.width;
  const VP_H = viewport.height;

  // Emulate the viewport's device at context creation — deviceScaleFactor and
  // mobile form factor, uniform with the accessibility and perf engines (which
  // have always emulated them). `isMobile` is Chromium/WebKit only; Firefox
  // rejects it, so it's omitted there.
  const context = await browser.newContext({
    ignoreHTTPSErrors,
    viewport: { width: VP_W, height: VP_H },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.formFactor === 'mobile' && playwrightOptions.browser !== 'firefox',
  });
  // From here on, anything that throws (a beforeNavigate hook, cookie loading,
  // newPage) must close the context we just created — the caller only tracks it
  // for teardown once we hand back a `dispose`, so an early throw would leak it.
  try {
    if (onContextReady) await onContextReady(context);
    const page = await context.newPage();
    // The one wait cap every Playwright engine respects: default action + navigation
    // timeout, uniform with the accessibility and agent-readiness engines.
    page.setDefaultTimeout(waitTimeout);
    page.setDefaultNavigationTimeout(waitTimeout);

    return {
      side,
      context,
      page,
      dispose: async () => {
        try { await context.close(); } catch { /* context may already be gone */ }
      },
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}
