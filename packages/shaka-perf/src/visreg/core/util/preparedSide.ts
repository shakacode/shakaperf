/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { setUpContextForNavigation } from '../../../pre-navigation';
import type { BrowserConsolePolicy } from '../../../browser-console';
import {
  attachLatestTestAnnotation,
  getLatestTestAnnotation,
  runWithFreshTestAnnotationContext,
} from '../../../test-annotation';
import type { BeforeNavigateHook } from 'shaka-shared';
import { createComparisonSide as defaultCreateComparisonSide, type ComparisonSide } from './createComparisonSide';
import defaultPreparePage from './preparePage';
import type {
  Browser,
  BrowserContext,
  EngineBrowserConfig,
  PlaywrightPage,
  Scenario,
  Viewport,
} from '../types';

export type PreparePageFn = typeof defaultPreparePage;
export type CreateSideFn = (
  browser: Browser,
  config: EngineBrowserConfig,
  viewport: Viewport,
  onContextReady?: (context: BrowserContext) => Promise<void>,
) => Promise<ComparisonSide>;

export interface PreparedSideParams {
  browser: Browser;
  config: EngineBrowserConfig;
  viewport: Viewport;
  scenario: Scenario;
  /** Resolved URL for this side — control and experiment differ. */
  url: string;
  isControl: boolean;
  beforeNavigate?: BeforeNavigateHook;
  /** Arms console capture. Only engines that then ASSERT on it should pass one. */
  browserConsole?: BrowserConsolePolicy;
  /**
   * Sides currently alive for this unit. A failure on one disposes the rest,
   * so a sibling's "page closed" rejection can't replace the real failure.
   * Compare passes the pair's shared set; a single-side caller can omit it.
   */
  activeSides?: Set<ComparisonSide>;
  captureFailure?: (err: unknown, page: PlaywrightPage, isControl: boolean) => Promise<unknown>;
  /** Runs once the page is built, before navigation — compare places windows here. */
  onSideReady?: (side: ComparisonSide) => Promise<void>;
  /**
   * Runs instead of disposal when the browser is kept open (`troubleshoot`) —
   * the last point this side's identity is in scope.
   */
  onKeptOpen?: (side: ComparisonSide) => Promise<void>;
  /** Injection seams for tests; default to the real implementations. */
  createSide?: CreateSideFn;
  preparePage?: PreparePageFn;
}

/**
 * Own one side — context, page, navigation, test body, teardown — and hand the
 * finished page to `use`.
 *
 * THE definition of "a test's page" for every engine that runs a test body
 * through Playwright: visreg captures screenshots from it, the audit's
 * `code_coverage` stage drains coverage and maps visibility from it. They must
 * be the same page or the second engine's numbers describe a rendering the
 * first never photographed — which is exactly what a private copy of this
 * sequence drifted into (its own `goto` default, no `_visregTools`, `isMobile`
 * on Firefox).
 *
 * The annotation scope and failure screenshot stay on this async branch, so a
 * concurrent sibling side cannot overwrite either.
 */
export async function withPreparedSide<T>(
  params: PreparedSideParams,
  use: (side: ComparisonSide) => Promise<T>,
): Promise<T> {
  const {
    browser,
    config,
    viewport,
    scenario,
    url,
    isControl,
    beforeNavigate,
    browserConsole,
    captureFailure,
    onSideReady,
    onKeptOpen,
  } = params;
  const activeSides = params.activeSides ?? new Set<ComparisonSide>();
  const createSide = params.createSide ?? defaultCreateComparisonSide;
  const preparePage = params.preparePage ?? defaultPreparePage;
  let side: ComparisonSide | undefined;

  return runWithFreshTestAnnotationContext(async () => {
    try {
      side = await createSide(
        browser,
        config,
        viewport,
        (context) => setUpContextForNavigation({
          context,
          url,
          viewport,
          isControl,
          testType: 'visreg',
          beforeNavigate,
          ...(browserConsole ? { browserConsole } : {}),
        }),
      );
      activeSides.add(side);
      if (onSideReady) await onSideReady(side);

      await preparePage(side.page, url, scenario, viewport, config, isControl, side.context);

      return await use(side);
    } catch (err) {
      attachLatestTestAnnotation(err, getLatestTestAnnotation(err));
      const failure = side && activeSides.has(side) && captureFailure
        ? await captureFailure(err, side.page, isControl)
        : err;
      // The sibling window is evidence too; Promise.all already rejects without help.
      if (!config.keepBrowserOpen) disposeActiveSidesOnNextTask(activeSides);
      throw failure;
    } finally {
      if (side && activeSides.delete(side)) {
        if (config.keepBrowserOpen) {
          if (onKeptOpen) await onKeptOpen(side);
        } else {
          await side.dispose();
        }
      }
    }
  });
}

function disposeActiveSidesOnNextTask(activeSides: Set<ComparisonSide>): void {
  const sidesToDispose = [...activeSides];
  activeSides.clear();
  if (sidesToDispose.length === 0) return;
  // Let this side's rejection settle Promise.all before closing its sibling.
  // Otherwise the sibling's resulting "page closed" rejection can win the
  // race and replace the failure that initiated cancellation.
  setImmediate(() => {
    void Promise.all(sidesToDispose.map((side) => side.dispose()));
  });
}
