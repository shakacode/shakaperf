/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import type { BeforeNavigateHook, TestType, Viewport } from 'shaka-shared';
import { clearBrowserData } from './clear-browser-data';
import { runBeforeNavigateHooks } from '../before-navigate';

export interface ContextNavigationSetup {
  context: BrowserContext;
  /** The URL about to be navigated for this side. */
  url: string;
  viewport: Viewport;
  isControl: boolean;
  testType: TestType;
  /** Per-test `beforeNavigate` hook (runs after the global one). */
  beforeNavigate?: BeforeNavigateHook;
}

/**
 * The single pre-navigation sequence shared by every engine (visreg, accessibility,
 * perf). Runs on the `BrowserContext` BEFORE any page is created, so init scripts,
 * routes, cookies, and storage cover the page's first navigation and its subframes.
 *
 * Order matters and is uniform across engines:
 *   1. Clear all state (cookies + HTTP cache + per-origin storage). This resets a
 *      reused context (perf runs many samples through one context) and is a near
 *      no-op on a fresh one.
 *   2. `beforeNavigate` hooks last, so a hook that seeds its own cookie/auth (via
 *      `context.addCookies` / `addInitScript`) lands AFTER the clear and survives
 *      into the navigation.
 */
export async function setUpContextForNavigation(setup: ContextNavigationSetup): Promise<void> {
  await setup.context.clearCookies();
  await clearBrowserData(setup.context, setup.url);
  await runBeforeNavigateHooks(
    {
      context: setup.context,
      url: setup.url,
      viewport: setup.viewport,
      isControl: setup.isControl,
      testType: setup.testType,
    },
    setup.beforeNavigate,
  );
}
