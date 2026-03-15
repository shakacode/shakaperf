import path from 'node:path';
import { pathToFileURL } from 'node:url';
import _ from 'lodash';
import { existsSync } from 'node:fs';
import injectVisregTools from '../../capture/visregTools.js';
import createLogger from './logger.js';
import type { PlaywrightPage, Scenario, Viewport, VisregConfig, BrowserContext, VisregTools } from '../types.js';
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

/**
 * Dynamically import a script file, supporting .js, .mjs, and .ts (via tsx).
 * Resolves through default export wrapping (tsx can double-wrap: { default: { default: fn } }).
 */
async function importScript(scriptPath: string): Promise<unknown> {
  let mod;
  if (scriptPath.endsWith('.ts')) {
    const { tsImport } = await import('tsx/esm/api');
    const tsModule = await tsImport(scriptPath, import.meta.url);
    mod = tsModule.default?.default ?? tsModule.default ?? tsModule;
  } else {
    const jsModule = await import(pathToFileURL(scriptPath).href);
    mod = jsModule.default ?? jsModule;
  }
  return mod;
}

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
 * Shared by runCompareScenario (liveCompare) and runPlaywright.
 */
async function preparePage (page: PlaywrightPage, url: string, scenario: Scenario, viewport: Viewport, config: VisregConfig, isReference: boolean, browserOrContext: BrowserContext, engineScriptsPath: string) {
  const gotoParameters = scenario?.engineOptions?.gotoParameters || config?.engineOptions?.gotoParameters || {};

  // --- BEFORE SCRIPT ---
  const onBeforeScript = scenario.onBeforeScript || config.onBeforeScript;
  if (onBeforeScript) {
    const beforeScriptPath = path.resolve(engineScriptsPath, onBeforeScript);
    if (existsSync(beforeScriptPath)) {
      const beforeFn = await importScript(beforeScriptPath) as (...args: unknown[]) => Promise<void>;
      await beforeFn(page, scenario, viewport, isReference, browserOrContext, config);
    } else {
      logger.warn('WARNING: script not found: ' + beforeScriptPath);
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

  // Define __name as a no-op in the page context. tsx/esbuild injects __name() calls
  // when transpiling .ts engine scripts at runtime, and those calls end up inside
  // page.evaluate callbacks where __name doesn't exist in the browser.
  // Using addInitScript so it persists across navigations.
  await page.addInitScript(function () {
    (window as unknown as Record<string, unknown>).__name = function (fn: unknown) { return fn; };
  });

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

  // --- ON READY SCRIPT / TEST FN ---
  if (scenario._testFn) {
    // abTest flow: testFn replaces onReadyScript
    await scenario._testFn({ page, browserContext: browserOrContext, isReference });
  } else {
    const onReadyScript = scenario.onReadyScript || config.onReadyScript;
    if (onReadyScript) {
      const readyScriptPath = path.resolve(engineScriptsPath, onReadyScript);
      if (existsSync(readyScriptPath)) {
        const readyFn = await importScript(readyScriptPath) as (...args: unknown[]) => Promise<void>;
        await readyFn(page, scenario, viewport, isReference, browserOrContext, config);
      } else {
        logger.warn('WARNING: script not found: ' + readyScriptPath);
      }
    }
  }

  // reinstall tools in case onReadyScript/testFn has loaded a new URL.
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
