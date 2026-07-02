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
import _ from 'lodash';
import injectVisregTools from '../../capture/visregTools';
import { loadCookies } from '../../capture/helpers/loadCookies';
import { waitUntilPageSettled } from 'shaka-shared';
import { clickAndHoverHelper } from '../../capture/helpers/clickAndHoverHelper';
import createLogger from './logger';
import { createTestAnnotate, runWithTestAnnotationContext } from '../../../test-annotation';
import { runBeforeNavigateHooks } from '../../../before-navigate';
import ensureDirectoryPath from './ensureDirectoryPath';
import { makeSafe } from './engineTools';
import type { PlaywrightPage, Scenario, Viewport, DecoratedCompareConfig, BrowserContext, VisregTools } from '../types';
import type { ConsoleMessage } from 'playwright';

declare global {
  interface Window {
    _readyEvent: string;
    _selectorExpansion: boolean;
    _visregSelectors: string[];
    _visregSelectorsExp: string[];
    _visregSelectorsExpMap: Record<string, { exists: number; isVisible: boolean; filePath?: string }>;
    _visregTools: VisregTools;
  }
}

const logger = createLogger('preparePage');

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

async function captureFailureScreenshot (page: PlaywrightPage, filePath: string) {
  const screenshot = await page.screenshot({ fullPage: true });
  ensureDirectoryPath(filePath);
  await writeFile(filePath, screenshot);
}

function failureScreenshotPath (config: DecoratedCompareConfig, scenario: Scenario, viewport: Viewport, isControl: boolean) {
  const dir = isControl
    ? (config._controlScreenshotPath || config.env.controlScreenshotDir || DEFAULT_CONTROL_SCREENSHOT_DIR)
    : (config._experimentScreenshotPath || config.env.experimentScreenshotDir || DEFAULT_EXPERIMENT_SCREENSHOT_DIR);
  const side = isControl ? 'control' : 'experiment';
  return path.join(dir, `${makeSafe(scenario.label)}_failure_${side}_${makeSafe(viewport.label)}_${Date.now()}.png`);
}

/**
 * Prepare a page: navigate to url, inject tools, wait for ready, handle selectors.
 * Returns the expanded selectors and selectorMap.
 *
 * Shared by runCompareScenario (compare) and runPlaywright.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: DecoratedCompareConfig, isControl: boolean, browserOrContext: BrowserContext) {
  const gotoParameters = scenario?.engineOptions?.gotoParameters || config?.engineOptions?.gotoParameters || {};

  // --- BEFORE: LOAD COOKIES ---
  if (scenario.cookiePath) {
    await loadCookies(browserOrContext, scenario);
  }

  // --- BEFORE: PRE-NAVIGATION HOOKS (global shared.beforeNavigate + per-test) ---
  // Context-level so subframes (e.g. reCAPTCHA's anchor/bframe) are covered.
  await runBeforeNavigateHooks(
    {
      context: browserOrContext,
      page,
      url,
      viewport,
      isControl,
      testType: 'visreg',
    },
    scenario._testDef?.options?.beforeNavigate,
  );

  // --- READY EVENT SETUP (before navigation to avoid missing early events) ---
  const readyEvent = scenario.readyEvent || config.readyEvent;
  const readyTimeout = scenario.readyTimeout || config.readyTimeout || 30000;
  let readyPromise: Promise<void> | undefined;
  let readyResolve: (() => void) | undefined;
  let readyTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let onConsole: ((msg: ConsoleMessage) => void) | undefined;

  if (readyEvent) {
    readyPromise = new Promise<void>(function (resolve) {
      readyResolve = resolve;
      readyTimeoutTimer = setTimeout(function () {
        logger.error('ReadyEvent not detected within readyTimeout limit. (' + readyTimeout + ' ms) ' + url);
        page.removeListener('console', onConsole!);
        resolve();
      }, readyTimeout);
    });

    onConsole = function (msg: ConsoleMessage) {
      if (new RegExp(readyEvent).test(msg.text())) {
        clearTimeout(readyTimeoutTimer);
        page.removeListener('console', onConsole!);
        readyResolve!();
      }
    };
    page.on('console', onConsole);
  }

  // --- OPEN URL + WAIT FOR READY EVENT ---
  try {
    await page.goto(translateUrl(url), gotoParameters);
    await injectVisregTools(page);

    if (readyPromise) {
      await page.evaluate(function (v: string) { window._readyEvent = v; }, readyEvent!);
      await readyPromise;
    }
  } finally {
    if (readyTimeoutTimer) {
      clearTimeout(readyTimeoutTimer);
    }
    if (onConsole) {
      page.removeListener('console', onConsole);
    }
  }

  // --- WAIT FOR SELECTOR ---
  if (scenario.readySelector) {
    await page.waitForSelector(scenario.readySelector, { timeout: readyTimeout });
  }

  // --- DELAY ---
  if (scenario.delay && scenario.delay > 0) {
    await new Promise(function (resolve) { setTimeout(resolve, scenario.delay); });
  }

  // --- REMOVE SELECTORS ---
  if (_.has(scenario, 'removeSelectors')) {
    await Promise.all(
      scenario.removeSelectors!.map(function (sel: string) {
        return page.evaluate(function (s: string) {
          document.querySelectorAll(s).forEach(function (el: Element) {
            (el as HTMLElement).style.cssText = 'display: none !important;';
            el.classList.add('__86d');
          });
        }, sel);
      })
    );
  }

  // --- ON READY / TEST FN ---
  if (scenario._testFn) {
    // abTest flow: testFn replaces default onReady behavior.
    try {
      await runWithTestAnnotationContext(() => scenario._testFn!({
        page,
        browserContext: browserOrContext,
        isControl,
        scenario: scenario._testDef!,
        viewport,
        testType: 'visreg',
        annotate: createTestAnnotate(),
      }));
    } catch (err) {
      const filePath = failureScreenshotPath(config, scenario, viewport, isControl);
      try {
        await captureFailureScreenshot(page, filePath);
      } catch (captureErr) {
        logger.warn(`Could not capture ${isControl ? 'control' : 'experiment'} failure screenshot: ${(captureErr as Error).message}`);
      }
      throw err;
    }
  } else {
    await waitUntilPageSettled(page);
    await clickAndHoverHelper(page, scenario);
  }

  // reinstall tools in case testFn has loaded a new URL.
  await injectVisregTools(page);

  // --- HIDE SELECTORS ---
  if (_.has(scenario, 'hideSelectors')) {
    await Promise.all(
      scenario.hideSelectors!.map(function (sel: string) {
        return page.evaluate(function (s: string) {
          document.querySelectorAll(s).forEach(function (el: Element) {
            (el as HTMLElement).style.visibility = 'hidden';
          });
        }, sel);
      })
    );
  }

  // --- HANDLE NO-SELECTORS ---
  if (!_.has(scenario, 'selectors') || !scenario.selectors!.length) {
    scenario.selectors = [DOCUMENT_SELECTOR];
  }

  // --- EXPAND SELECTORS ---
  const selectorExpansion = scenario.selectorExpansion === true || scenario.selectorExpansion === 'true';
  const selectors: string[] = scenario.selectors!;

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
