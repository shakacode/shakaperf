/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';
import type { BeforeNavigateHook, TestType, Viewport } from 'shaka-shared';
import { clearBrowserData } from './clear-browser-data';
import { installConsoleCapture, type BrowserConsolePolicy } from '../browser-console';

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
  /** Arms console capture for the engines that assert on it (visreg, perf). */
  browserConsole?: BrowserConsolePolicy;
}

/**
 * Test files load through tsx, whose esbuild transform sets `keepNames`. That
 * rewrites every *named* inner function — `const attach = () => {}`, a class, a
 * function declaration — to `__name(fn, 'name')`, where `__name` is a helper
 * esbuild puts in the Node module scope. Playwright serializes a function
 * argument with `Function.prototype.toString`, so `addInitScript(fn)` and
 * `page.evaluate(fn)` carry that call into the page, where the helper does not
 * exist and the script dies on `__name is not defined`.
 *
 * Nothing about that is visible: `addInitScript` still resolves, and the throw
 * lands on `pageerror`. A hide or a stub simply does not happen, and the run
 * goes green with wrong screenshots. Whether it bites depends on the installed
 * tsx — 4.21.0 emits no helper, 4.23.1 does — so a caret-ranged transitive bump
 * can start corrupting baselines with no code change.
 *
 * Defining the helper in the page costs nothing when no script references it,
 * and `||=` yields to any bundle that ships its own.
 */
const KEEP_NAMES_SHIM =
  "globalThis.__name ||= (fn, name) => Object.defineProperty(fn, 'name', { value: name, configurable: true });";

/**
 * `addInitScript` has no dedupe and no removal API, and init scripts survive the
 * state clear — while perf reuses ONE context across every sample. Installing
 * per navigation would leave sample N running N copies of the shim on the
 * measured page, so track the contexts already covered and install once.
 * The first install is what orders it ahead of `beforeNavigate`'s own scripts;
 * later navigations inherit that.
 */
const shimmedContexts = new WeakSet<BrowserContext>();

async function installKeepNamesShim(context: BrowserContext): Promise<void> {
  if (shimmedContexts.has(context)) return;
  shimmedContexts.add(context);
  await context.addInitScript(KEEP_NAMES_SHIM);
}

/**
 * The single pre-navigation sequence shared by every engine, run on the
 * `BrowserContext` before any page is created. Order is uniform and matters:
 * arm console capture, clear all state (so a reused perf context is reset),
 * install the `__name` shim, then `beforeNavigate` last, so a hook that seeds
 * its own cookie/auth survives the clear — and so the shim is already in place
 * for any init script the hook registers. Throws if the hook throws — a failed
 * setup hook should fail the test.
 */
export async function setUpContextForNavigation(setup: ContextNavigationSetup): Promise<void> {
  if (setup.browserConsole) {
    installConsoleCapture(setup.context, setup.browserConsole,
      `${setup.isControl ? 'control' : 'experiment'} [${setup.viewport.label}]`);
  }
  await setup.context.clearCookies();
  await clearBrowserData(setup.context, setup.url);
  await installKeepNamesShim(setup.context);
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
