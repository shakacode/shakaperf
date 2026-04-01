import path from 'node:path';
import _ from 'lodash';
import injectVisregTools from '../../capture/visregTools';
import { loadCookies } from '../../capture/helpers/loadCookies';
import { waitUntilPageSettled } from '../../capture/helpers/waitUntilPageSettled';
import { clickAndHoverHelper } from '../../capture/helpers/clickAndHoverHelper';
import createLogger from './logger';
import AnnotatedError from './AnnotatedError';
import { TestType } from 'shaka-shared';
import type { PlaywrightPage, Scenario, Viewport, VisregConfig, BrowserContext, VisregTools } from '../types';
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

function translateUrl (url: string) {
  const RE = /^[./]/;
  if (RE.test(url)) {
    return 'file://' + path.join(process.cwd(), url);
  }
  return url;
}

/**
 * Prepare a page: navigate to url, inject tools, wait for ready, handle selectors.
 * Returns the expanded selectors and selectorMap.
 *
 * Shared by runCompareScenario (compare) and runPlaywright.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: VisregConfig, isReference: boolean, browserOrContext: BrowserContext) {
  const gotoParameters = scenario?.engineOptions?.gotoParameters || config?.engineOptions?.gotoParameters || {};

  // --- BEFORE: LOAD COOKIES ---
  if (scenario.cookiePath) {
    await loadCookies(browserOrContext, scenario);
  }

  // --- BEFORE: USER HOOK ---
  if (scenario.onBefore) {
    let lastAnnotation: string | undefined;
    const annotate = (label: string) => { lastAnnotation = label; };
    try {
      await scenario.onBefore({
        page,
        browserContext: browserOrContext,
        isReference,
        scenario: scenario._testDef!,
        viewport: { label: viewport.label, width: viewport.width, height: viewport.height },
        testType: TestType.VisualRegression,
        annotate,
      });
    } catch (err: unknown) {
      if (err instanceof Error && lastAnnotation) {
        throw new AnnotatedError(err, lastAnnotation);
      }
      throw err;
    }
  }

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
    // Track the last annotate() label per invocation so errors can report
    // which step was in progress when the failure occurred.
    let lastAnnotation: string | undefined;
    const annotate = (label: string) => { lastAnnotation = label; };

    try {
      await scenario._testFn({
        page,
        browserContext: browserOrContext,
        isReference,
        scenario: scenario._testDef!,
        viewport: { label: viewport.label, width: viewport.width, height: viewport.height },
        testType: TestType.VisualRegression,
        annotate,
      });
    } catch (err: unknown) {
      if (err instanceof Error && lastAnnotation) {
        throw new AnnotatedError(err, lastAnnotation);
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
