/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as engineTools from './engineTools';
import type { Browser, BrowserContext, PlaywrightPage, Viewport, DecoratedCompareConfig } from '../types';

// Fallback navigation timeout when the config doesn't set `waitTimeout`.
const DEFAULT_NAV_TIMEOUT = 60000;

export interface ComparisonSide {
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
 */
export async function createComparisonSide(
  browser: Browser,
  config: DecoratedCompareConfig,
  viewport: Viewport,
): Promise<ComparisonSide> {
  const { engineOptions = {} } = config;
  const ignoreHTTPSErrors = engineOptions.ignoreHTTPSErrors !== undefined ? engineOptions.ignoreHTTPSErrors : true;
  // storageState shape comes from user config — cast to satisfy Playwright's newContext.
  const storageState = (engineOptions.storageState || undefined) as string | undefined;
  const navTimeout = engineTools.getEngineOption(config, 'waitTimeout', DEFAULT_NAV_TIMEOUT);

  const context = await browser.newContext({ ignoreHTTPSErrors, storageState });
  const page = await context.newPage();
  const VP_W = viewport.width || viewport.viewport!.width;
  const VP_H = viewport.height || viewport.viewport!.height;
  await page.setViewportSize({ width: VP_W, height: VP_H });
  page.setDefaultNavigationTimeout(navTimeout);

  return {
    context,
    page,
    dispose: async () => {
      try { await context.close(); } catch { /* context may already be gone */ }
    },
  };
}
