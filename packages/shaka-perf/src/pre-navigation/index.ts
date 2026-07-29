/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import type { BeforeNavigateHook, TestType, Viewport } from 'shaka-shared';
import { clearBrowserData } from './clear-browser-data';

export interface ContextNavigationSetup {
  context: BrowserContext;
  /** The URL about to be navigated for this side. */
  url: string;
  viewport: Viewport;
  isControl: boolean;
  testType: TestType;
  /**
   * The effective `beforeNavigate`, read from the caller's already-merged config
   * (`config.shared.beforeNavigate`). Runs after the state clear.
   */
  beforeNavigate?: BeforeNavigateHook;
}

/**
 * The single pre-navigation sequence shared by every engine, run on the
 * `BrowserContext` before any page is created. Order is uniform and matters:
 * clear all state first (so a reused perf context is reset), then `beforeNavigate`
 * last, so a hook that seeds its own cookie/auth survives the clear. Throws if the
 * hook throws — a failed setup hook should fail the test.
 */
export async function setUpContextForNavigation(setup: ContextNavigationSetup): Promise<void> {
  await setup.context.clearCookies();
  await clearBrowserData(setup.context, setup.url);
  if (setup.beforeNavigate) {
    await setup.beforeNavigate({
      context: setup.context,
      url: setup.url,
      viewport: setup.viewport,
      isControl: setup.isControl,
      testType: setup.testType,
    });
  }
}
