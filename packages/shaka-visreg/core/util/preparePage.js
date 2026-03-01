import path from 'node:path';
import _ from 'lodash';
import fs from './fs.js';
import injectBackstopTools from '../../capture/backstopTools.js';
import createLogger from './logger.js';

const logger = createLogger('preparePage');

const DOCUMENT_SELECTOR = 'document';

function translateUrl (url) {
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
async function preparePage (page, url, scenario, viewport, config, isReference, browserOrContext, engineScriptsPath) {
  const gotoParameters = scenario?.engineOptions?.gotoParameters || config?.engineOptions?.gotoParameters || {};

  // --- BEFORE SCRIPT ---
  const onBeforeScript = scenario.onBeforeScript || config.onBeforeScript;
  if (onBeforeScript) {
    const beforeScriptPath = path.resolve(engineScriptsPath, onBeforeScript);
    if (fs.existsSync(beforeScriptPath)) {
      const beforeMod = await import(beforeScriptPath);
      const beforeFn = beforeMod.default || beforeMod;
      await beforeFn(page, scenario, viewport, isReference, browserOrContext, config);
    } else {
      logger.warn('WARNING: script not found: ' + beforeScriptPath);
    }
  }

  // --- READY EVENT SETUP (before navigation to avoid missing early events) ---
  const readyEvent = scenario.readyEvent || config.readyEvent;
  const readyTimeout = scenario.readyTimeout || config.readyTimeout || 30000;
  let readyPromise;
  let readyResolve;
  let readyTimeoutTimer;
  let onConsole;

  if (readyEvent) {
    readyPromise = new Promise(function (resolve) {
      readyResolve = resolve;
      readyTimeoutTimer = setTimeout(function () {
        logger.error('ReadyEvent not detected within readyTimeout limit. (' + readyTimeout + ' ms) ' + url);
        page.removeListener('console', onConsole);
        resolve();
      }, readyTimeout);
    });

    onConsole = function (msg) {
      if (new RegExp(readyEvent).test(msg.text())) {
        clearTimeout(readyTimeoutTimer);
        page.removeListener('console', onConsole);
        readyResolve();
      }
    };
    page.on('console', onConsole);
  }

  // --- OPEN URL + WAIT FOR READY EVENT ---
  try {
    await page.goto(translateUrl(url), gotoParameters);
    await injectBackstopTools(page);

    if (readyPromise) {
      await page.evaluate(function (v) { window._readyEvent = v; }, readyEvent);
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
  if (scenario.delay > 0) {
    await new Promise(function (resolve) { setTimeout(resolve, scenario.delay); });
  }

  // --- REMOVE SELECTORS ---
  if (_.has(scenario, 'removeSelectors')) {
    await Promise.all(
      scenario.removeSelectors.map(function (sel) {
        return page.evaluate(function (s) {
          document.querySelectorAll(s).forEach(function (el) {
            el.style.cssText = 'display: none !important;';
            el.classList.add('__86d');
          });
        }, sel);
      })
    );
  }

  // --- ON READY SCRIPT ---
  const onReadyScript = scenario.onReadyScript || config.onReadyScript;
  if (onReadyScript) {
    const readyScriptPath = path.resolve(engineScriptsPath, onReadyScript);
    if (fs.existsSync(readyScriptPath)) {
      const readyMod = await import(readyScriptPath);
      const readyFn = readyMod.default || readyMod;
      await readyFn(page, scenario, viewport, isReference, browserOrContext, config);
    } else {
      logger.warn('WARNING: script not found: ' + readyScriptPath);
    }
  }

  // reinstall tools in case onReadyScript has loaded a new URL.
  await injectBackstopTools(page);

  // --- HIDE SELECTORS ---
  if (_.has(scenario, 'hideSelectors')) {
    await Promise.all(
      scenario.hideSelectors.map(function (sel) {
        return page.evaluate(function (s) {
          document.querySelectorAll(s).forEach(function (el) {
            el.style.visibility = 'hidden';
          });
        }, sel);
      })
    );
  }

  // --- HANDLE NO-SELECTORS ---
  if (!_.has(scenario, 'selectors') || !scenario.selectors.length) {
    scenario.selectors = [DOCUMENT_SELECTOR];
  }

  // --- EXPAND SELECTORS ---
  const selectorExpansion = scenario.selectorExpansion === true || scenario.selectorExpansion === 'true';
  const selectors = Array.isArray(scenario.selectors) ? scenario.selectors : [scenario.selectors];

  const result = await page.evaluate(function (args) {
    var expand = args.expand;
    var sels = args.sels;
    window._selectorExpansion = expand;
    window._backstopSelectors = sels;
    if (expand) {
      window._backstopSelectorsExp = window._backstopTools.expandSelectors(sels);
    } else {
      window._backstopSelectorsExp = sels;
    }
    window._backstopSelectorsExpMap = window._backstopSelectorsExp.reduce(function (acc, selector) {
      acc[selector] = {
        exists: window._backstopTools.exists(selector),
        isVisible: window._backstopTools.isVisible(selector)
      };
      return acc;
    }, {});
    return {
      backstopSelectorsExp: window._backstopSelectorsExp,
      backstopSelectorsExpMap: window._backstopSelectorsExpMap
    };
  }, { expand: selectorExpansion, sels: selectors });

  return result;
}

export default preparePage;
export { translateUrl };
