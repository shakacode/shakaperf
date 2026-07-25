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
    _visregSelectors: string[];
    _visregTools: VisregTools;
  }
}

const DOCUMENT_SELECTOR = 'document';

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
  // Always absolute under the unit artifacts dir (extendConfig derives both).
  const dir = isControl ? config.env.controlScreenshotDir : config.env.experimentScreenshotDir;
  const side = isControl ? 'control' : 'experiment';
  return path.join(dir, `${makeSafe(scenario.label)}_failure_${side}_${makeSafe(viewport.label)}_${Date.now()}.png`);
}

/**
 * Prepare a page: navigate to url, inject tools, run the test body. Returns
 * the capture selectors and their in-page presence/visibility map.
 *
 * Ready-waits, interactions, and DOM manipulation are the test body's job —
 * the scenario carries no declarative fields for them.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: DecoratedCompareConfig, isControl: boolean, browserOrContext: BrowserContext) {
  const gotoParameters = config?.playwrightOptions?.gotoParameters || {};

  // Cookie loading + the beforeNavigate hooks now run on the context BEFORE this
  // page is created (see runCompareAttempts → createComparisonSide onContextReady),
  // so by the time we're here the page's first navigation is already covered.
  await page.goto(translateUrl(url), gotoParameters);
  await injectVisregTools(page);

  // --- TEST FN ---
  if (scenario._testFn) {
    // A throw here is turned into a per-side failure screenshot by
    // runCompareAttempts while this page is still alive.
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

  // --- SELECTOR PRESENCE MAP ---
  const selectors: string[] = scenario.selectors?.length ? scenario.selectors : [DOCUMENT_SELECTOR];

  const result = await page.evaluate(function (sels: string[]) {
    window._visregSelectors = sels;
    var selectorMap = sels.reduce(function (acc: Record<string, { exists: number; isVisible: boolean; filePath?: string }>, selector: string) {
      acc[selector] = {
        exists: window._visregTools.exists(selector),
        isVisible: window._visregTools.isVisible(selector)
      };
      return acc;
    }, {});
    return { selectors: sels, selectorMap: selectorMap };
  }, selectors);

  return result;
}

export default preparePage;
export { translateUrl };
