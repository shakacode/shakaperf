/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import injectVisregTools from '../../capture/visregTools';
import { createTestAnnotate } from '../../../test-annotation';
import type { PlaywrightPage, Scenario, Viewport, EngineBrowserConfig, BrowserContext } from '../types';

function translateUrl (url: string) {
  const RE = /^[./]/;
  if (RE.test(url)) {
    return 'file://' + path.join(process.cwd(), url);
  }
  return url;
}

/**
 * Prepare a page: navigate to url, inject tools, and run the test body.
 *
 * Ready-waits, interactions, and DOM manipulation are the test body's job —
 * the scenario carries no declarative fields for them.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: EngineBrowserConfig, isControl: boolean, browserOrContext: BrowserContext) {
  const gotoParameters = config?.playwrightOptions?.gotoParameters || {};

  // Cookie loading + the beforeNavigate hooks now run on the context BEFORE this
  // page is created (see runCompareAttempts → createComparisonSide onContextReady),
  // so by the time we're here the page's first navigation is already covered.
  await page.goto(translateUrl(url), gotoParameters);
  await injectVisregTools(page);

  // --- TEST FN ---
  if (scenario._testFn) {
    // The per-side lifecycle in runCompareAttempts owns the annotation scope
    // and failure screenshot while this page is still alive.
    await scenario._testFn({
      page,
      browserContext: browserOrContext,
      isControl,
      scenario: scenario._testDef!,
      viewport,
      testType: 'visreg',
      annotate: createTestAnnotate(),
    });
  }
}

export default preparePage;
export { translateUrl };
