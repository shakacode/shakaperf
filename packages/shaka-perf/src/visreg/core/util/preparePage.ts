/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import injectVisregTools from '../../capture/visregTools';
import { createTestAnnotate, runWithTestAnnotationContext } from '../../../test-annotation';
import ensureDirectoryPath from './ensureDirectoryPath';
import { makeSafe } from './engineTools';
import type { PlaywrightPage, Scenario, Viewport, DecoratedCompareConfig, BrowserContext, VisregTools } from '../types';

declare global {
  interface Window {
    _selectorExpansion: boolean;
    _visregSelectors: string[];
    _visregSelectorsExp: string[];
    _visregSelectorsExpMap: Record<string, { exists: number; isVisible: boolean; filePath?: string }>;
    _visregTools: VisregTools;
  }
}

const DOCUMENT_SELECTOR = 'document';
const DEFAULT_EXPERIMENT_SCREENSHOT_DIR = 'experiment_screenshots';
const DEFAULT_CONTROL_SCREENSHOT_DIR = 'control_screenshots';

function translateUrl (url: string) {
  const RE = /^[./]/;
  if (RE.test(url)) {
    return 'file://' + path.join(process.cwd(), url);
  }
  return url;
}

export async function captureFailureScreenshot (page: PlaywrightPage, filePath: string) {
  const screenshot = await page.screenshot({ fullPage: true });
  ensureDirectoryPath(filePath);
  await writeFile(filePath, screenshot);
}

export function failureScreenshotPath (config: DecoratedCompareConfig, scenario: Scenario, viewport: Viewport, isControl: boolean) {
  const dir = isControl
    ? (config._controlScreenshotPath || config.env.controlScreenshotDir || DEFAULT_CONTROL_SCREENSHOT_DIR)
    : (config._experimentScreenshotPath || config.env.experimentScreenshotDir || DEFAULT_EXPERIMENT_SCREENSHOT_DIR);
  const side = isControl ? 'control' : 'experiment';
  return path.join(dir, `${makeSafe(scenario.label)}_failure_${side}_${makeSafe(viewport.label)}_${Date.now()}.png`);
}

/**
 * Prepare a page: navigate to url, inject tools, run the test body, expand
 * selectors. Returns the expanded selectors and selectorMap.
 *
 * Ready-waits, interactions, and DOM manipulation are the test body's job —
 * the scenario carries no declarative fields for them.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: DecoratedCompareConfig, isControl: boolean, browserOrContext: BrowserContext) {
  const gotoParameters = scenario?.engineOptions?.gotoParameters || config?.engineOptions?.gotoParameters || {};

  // Cookie loading + the beforeNavigate hooks now run on the context BEFORE this
  // page is created (see runCompareAttempts → createComparisonSide onContextReady),
  // so by the time we're here the page's first navigation is already covered.
  await page.goto(translateUrl(url), gotoParameters);
  await injectVisregTools(page);

  // --- TEST FN ---
  if (scenario._testFn) {
    // A throw here (or later, at capture) is turned into a failure screenshot
    // by the single handler in runCompareAttempts, while the page is still alive.
    await runWithTestAnnotationContext(() => scenario._testFn!({
      page,
      browserContext: browserOrContext,
      isControl,
      scenario: scenario._testDef!,
      viewport,
      testType: 'visreg',
      annotate: createTestAnnotate(),
    }));
  }

  // reinstall tools in case testFn has loaded a new URL.
  await injectVisregTools(page);

  // --- EXPAND SELECTORS ---
  const selectorExpansion = scenario.selectorExpansion === true || scenario.selectorExpansion === 'true';
  const selectors: string[] = scenario.selectors?.length ? scenario.selectors : [DOCUMENT_SELECTOR];

  const result = await page.evaluate(function (args: { expand: boolean; sels: string[] }) {
    var expand = args.expand;
    var sels = args.sels;
    window._selectorExpansion = expand;
    window._visregSelectors = sels;
    if (expand) {
      window._visregSelectorsExp = window._visregTools.expandSelectors(sels);
    } else {
      window._visregSelectorsExp = sels;
    }
    window._visregSelectorsExpMap = window._visregSelectorsExp.reduce(function (acc: Record<string, { exists: number; isVisible: boolean; filePath?: string }>, selector: string) {
      acc[selector] = {
        exists: window._visregTools.exists(selector),
        isVisible: window._visregTools.isVisible(selector)
      };
      return acc;
    }, {});
    return {
      visregSelectorsExp: window._visregSelectorsExp,
      visregSelectorsExpMap: window._visregSelectorsExpMap
    };
  }, { expand: selectorExpansion, sels: selectors });

  return result;
}

export default preparePage;
export { translateUrl };
