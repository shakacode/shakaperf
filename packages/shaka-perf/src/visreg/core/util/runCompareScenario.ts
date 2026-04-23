import { writeFile } from 'node:fs/promises';
import { copy } from 'fs-extra';
import chalk from 'chalk';
import ensureDirectoryPath from './ensureDirectoryPath';
import * as engineTools from './engineTools';
import { compareBuffers, analyzeWhitePixels } from './compare/pixelmatch-inline';
import retryCompare from './retryCompare';
import preparePage from './preparePage';
import { AnnotatedError } from 'shaka-shared';
import type { PlaywrightPage, Scenario, Viewport, BrowserContext, Browser, TestPair, DecoratedCompareConfig } from '../types';

type ConsoleMethod = 'error' | 'warn' | 'log' | 'info';
interface CompareLogger {
  logged: string[][];
  error: (color: string, message: string, ...rest: unknown[]) => void;
  warn: (color: string, message: string, ...rest: unknown[]) => void;
  log: (color: string, message: string, ...rest: unknown[]) => void;
  info: (color: string, message: string, ...rest: unknown[]) => void;
}

const TEST_TIMEOUT = 60000;
const DEFAULT_FILENAME_TEMPLATE = '{configId}_{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}';
const DEFAULT_EXPERIMENT_SCREENSHOT_DIR = 'experiment_screenshot';
const DEFAULT_CONTROL_SCREENSHOT_DIR = 'control_screenshot';
const SELECTOR_NOT_FOUND_PATH = '/capture/resources/notFound.png';
const ERROR_SELECTOR_PATH = '/capture/resources/unexpectedErrorSm.png';
const BODY_SELECTOR = 'body';
const DOCUMENT_SELECTOR = 'document';
const NOCLIP_SELECTOR = 'body:noclip';
const VIEWPORT_SELECTOR = 'viewport';

function loggerAction (this: { logged: string[][] }, action: string, color: string, message: string, ...rest: unknown[]) {
  this.logged.push([action, color, message.toString(), JSON.stringify(rest)]);
  console[action as ConsoleMethod]((chalk as unknown as Record<string, (s: string) => string>)[color](message), ...rest);
}

function createLogger (): CompareLogger {
  const logged: string[][] = [];
  const base = { logged };
  const logger: CompareLogger = {
    logged,
    error: loggerAction.bind(base, 'error'),
    warn: loggerAction.bind(base, 'warn'),
    log: loggerAction.bind(base, 'log'),
    info: loggerAction.bind(base, 'info')
  };
  return logger;
}

/**
 * Capture a single selector to a PNG buffer (no disk write).
 */
async function captureScreenshot (page: PlaywrightPage, selector: string, _selectorMap: Record<string, { filePath?: string }>, viewport: Viewport, config: DecoratedCompareConfig, useBoundingBox?: boolean) {
  const fullPage = (selector === NOCLIP_SELECTOR || selector === DOCUMENT_SELECTOR);

  if (selector === BODY_SELECTOR || selector === DOCUMENT_SELECTOR || selector === NOCLIP_SELECTOR) {
    return await page.screenshot({ fullPage });
  } else if (selector === VIEWPORT_SELECTOR) {
    return await page.screenshot();
  } else {
    // Element selector
    const el = await page.$(selector);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      let box = await el.boundingBox();
      if (box) {
        if ((useBoundingBox ?? config.useBoundingBoxViewportForSelectors) !== false) {
          const bodyHandle = await page.$('body');
          const boundingBox = await bodyHandle!.boundingBox();
          await page.setViewportSize({
            width: Math.max(viewport.width || viewport.viewport!.width, Math.ceil(boundingBox!.width)),
            height: Math.max(viewport.height || viewport.viewport!.height, Math.ceil(boundingBox!.height))
          });
          // Re-fetch bounding box after viewport resize — layout may have shifted
          const updatedBox = await el.boundingBox();
          if (updatedBox) {
            box = updatedBox;
          }
        }

        return await page.screenshot({ clip: box });
      }
    }
    return null; // selector not found or not visible
  }
}

function writeScenarioLogs (config: DecoratedCompareConfig, logFilePath: string, logger: CompareLogger) {
  if (config.scenarioLogsInReports) {
    return writeFile(logFilePath, JSON.stringify(logger.logged));
  }
  return Promise.resolve(true);
}

/**
 * Core comparison logic for live compare scenarios.
 */
async function processCompareView (scenario: Scenario, variantOrScenarioLabelSafe: string, scenarioLabelSafe: string, viewport: Viewport, config: DecoratedCompareConfig, refPage: PlaywrightPage, testPage: PlaywrightPage, refBrowserOrContext: BrowserContext, testBrowserOrContext: BrowserContext, logger: CompareLogger) {
  const { scenarioDefaults = {} } = config;
  scenario = { ...scenarioDefaults, ...scenario };

  if (!config.paths) {
    config.paths = {};
  }

  config._experimentScreenshotPath = config.env.experimentScreenshotDir || DEFAULT_EXPERIMENT_SCREENSHOT_DIR;
  config._controlScreenshotPath = config.env.controlScreenshotDir || DEFAULT_CONTROL_SCREENSHOT_DIR;
  config._fileNameTemplate = config.fileNameTemplate || DEFAULT_FILENAME_TEMPLATE;
  config._outputFileFormatSuffix = '.' + ((config.outputFormat && config.outputFormat.match(/jpg|jpeg/)) || 'png');
  config._configId = config.id || engineTools.genHash(config.configFileName);

  const VP_W = viewport.width || viewport.viewport!.width;
  const VP_H = viewport.height || viewport.viewport!.height;

  // Set viewport on both pages
  await Promise.all([
    refPage.setViewportSize({ width: VP_W, height: VP_H }),
    testPage.setViewportSize({ width: VP_W, height: VP_H })
  ]);

  const navTimeout = engineTools.getEngineOption(config, 'waitTimeout', TEST_TIMEOUT);
  refPage.setDefaultNavigationTimeout(navTimeout);
  testPage.setDefaultNavigationTimeout(navTimeout);

  logger.log('blue', 'LIVE COMPARE: opening reference (' + scenario.referenceUrl + ') and test (' + scenario.url + ') simultaneously');

  // Prepare both pages in parallel
  const [refResult, testResult] = await Promise.all([
    preparePage(refPage, scenario.referenceUrl!, scenario, viewport, config, true, refBrowserOrContext),
    preparePage(testPage, scenario.url, scenario, viewport, config, false, testBrowserOrContext)
  ]);

  // Use selectors from test page (the main subject), fall back to reference
  const selectors = testResult.visregSelectorsExp;
  const testSelectorMap = testResult.visregSelectorsExpMap;
  const refSelectorMap = refResult.visregSelectorsExpMap;

  const compareConfig: { testPairs: TestPair[] } = { testPairs: [] };
  const maxNumDiffPixels = scenario.maxNumDiffPixels != null
    ? scenario.maxNumDiffPixels
    : (config.maxNumDiffPixels != null ? config.maxNumDiffPixels : 0);
  const pixelmatchThreshold = scenario.comparePixelmatchThreshold != null
    ? scenario.comparePixelmatchThreshold
    : (config.comparePixelmatchThreshold != null ? config.comparePixelmatchThreshold : 0.1);
  const useBoundingBox = scenario.useBoundingBoxViewportForSelectors != null
    ? scenario.useBoundingBoxViewportForSelectors
    : undefined;

  for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
    const selector = selectors[selectorIndex];
    const testPair = engineTools.generateTestPair(config, scenario, viewport, variantOrScenarioLabelSafe, scenarioLabelSafe, selectorIndex, selector);

    // Assign file paths to selectorMap entries
    if (testSelectorMap[selector]) {
      testSelectorMap[selector].filePath = testPair.test;
    }
    if (refSelectorMap[selector]) {
      refSelectorMap[selector].filePath = testPair.reference;
    }

    // Capture both screenshots to buffers
    const refBuffer = await captureScreenshot(refPage, selector, refSelectorMap, viewport, config, useBoundingBox);
    const testBuffer = await captureScreenshot(testPage, selector, testSelectorMap, viewport, config, useBoundingBox);

    if (!refBuffer || !testBuffer) {
      ensureDirectoryPath(testPair.reference);
      ensureDirectoryPath(testPair.test);

      if (!refBuffer && !testBuffer) {
        // Both pages missing the selector — always a failure
        logger.log('magenta', 'Selector "' + selector + '" not found on both reference and test pages');
        await copy(config.env.visregRoot + SELECTOR_NOT_FOUND_PATH, testPair.reference);
        await copy(config.env.visregRoot + SELECTOR_NOT_FOUND_PATH, testPair.test);
        testPair.hadEngineError = true;
        testPair.engineErrorMsg = `Selector "${selector}" not found on both reference and test pages`;
      } else {
        // Only one page missing the selector
        logger.log('magenta', 'Selector "' + selector + '" not found on ' + (!refBuffer ? 'reference' : 'test') + ' page');
        if (refBuffer) {
          await writeFile(testPair.reference, refBuffer);
        } else {
          await copy(config.env.visregRoot + SELECTOR_NOT_FOUND_PATH, testPair.reference);
        }
        if (testBuffer) {
          await writeFile(testPair.test, testBuffer);
        } else {
          await copy(config.env.visregRoot + SELECTOR_NOT_FOUND_PATH, testPair.test);
        }
      }

      compareConfig.testPairs.push(testPair);
      continue;
    }

    // Inline pixelmatch comparison
    const matchResult = compareBuffers(refBuffer, testBuffer, { threshold: pixelmatchThreshold });

    if (matchResult.numDiffPixels <= maxNumDiffPixels) {
      // Pass — save both screenshots
      logger.log('green', 'PASS: "' + scenario.label + '" [' + selector + '] (' + matchResult.numDiffPixels + ' diff pixels)');
      ensureDirectoryPath(testPair.reference);
      ensureDirectoryPath(testPair.test);
      const refAnalysis = analyzeWhitePixels(refBuffer);
      const testAnalysis = analyzeWhitePixels(testBuffer);
      testPair.refWhitePixelPercent = refAnalysis.whitePixelPercent;
      testPair.testWhitePixelPercent = testAnalysis.whitePixelPercent;
      testPair.refIsBottomSeventyPercentWhite = refAnalysis.isBottomSeventyPercentWhite;
      testPair.testIsBottomSeventyPercentWhite = testAnalysis.isBottomSeventyPercentWhite;
      await Promise.all([
        writeFile(testPair.reference, refBuffer),
        writeFile(testPair.test, testBuffer)
      ]);
      compareConfig.testPairs.push(testPair);
      continue;
    }

    // Mismatch — enter retry loop
    logger.log('yellow', 'MISMATCH: "' + scenario.label + '" [' + selector + '] (' + matchResult.numDiffPixels + ' diff pixels). Entering retry loop...');

    const retryResult = await retryCompare({
      captureScreenshot,
      refPage,
      testPage,
      selector,
      selectorMap: testSelectorMap,
      viewport,
      config,
      scenario,
      initialRefBuffer: refBuffer,
      initialTestBuffer: testBuffer,
      refBrowserOrContext,
      testBrowserOrContext,
      pixelmatchThreshold,
      useBoundingBoxViewportForSelectors: useBoundingBox,
    });

    const refAnalysis = analyzeWhitePixels(retryResult.refBuffer);
    const testAnalysis = analyzeWhitePixels(retryResult.testBuffer);
    testPair.refWhitePixelPercent = refAnalysis.whitePixelPercent;
    testPair.testWhitePixelPercent = testAnalysis.whitePixelPercent;
    testPair.refIsBottomSeventyPercentWhite = refAnalysis.isBottomSeventyPercentWhite;
    testPair.testIsBottomSeventyPercentWhite = testAnalysis.isBottomSeventyPercentWhite;

    // Save the best screenshots to disk
    ensureDirectoryPath(testPair.reference);
    ensureDirectoryPath(testPair.test);
    await Promise.all([
      writeFile(testPair.reference, retryResult.refBuffer),
      writeFile(testPair.test, retryResult.testBuffer)
    ]);

    // Save pixelmatch diff PNG (transparent BG, red changed pixels) if failed.
    // This becomes the diff thumbnail in the React report — clearer than the
    // resemble failed_diff (which overlays diffs on top of the test image).
    if (!retryResult.pass && retryResult.diffBuffer) {
      const diffPath = testPair.test.replace(/\.png$/, '_pixelmatch_diff.png');
      ensureDirectoryPath(diffPath);
      await writeFile(diffPath, retryResult.diffBuffer);
      testPair.pixelmatchDiffImage = diffPath;
    }

    if (retryResult.pass) {
      logger.log('green', 'PASS after retries: "' + scenario.label + '" [' + selector + ']');
    } else {
      logger.log('red', 'FAIL after retries: "' + scenario.label + '" [' + selector + ']');
    }

    compareConfig.testPairs.push(testPair);
  }

  // Write scenario logs
  if (selectors.length > 0) {
    const firstSelector = selectors[0];
    const logTestPair = engineTools.generateTestPair(config, scenario, viewport, variantOrScenarioLabelSafe, scenarioLabelSafe, 0, firstSelector);
    await writeScenarioLogs(config, logTestPair.testLog!, logger);
    await writeScenarioLogs(config, logTestPair.referenceLog!, logger);
  }

  return compareConfig;
}

async function buildErrorCompareConfig (config: DecoratedCompareConfig, scenario: Scenario, viewport: Viewport, variantOrScenarioLabelSafe: string, scenarioLabelSafe: string, error: Error, annotationMsg?: string, refBuffer?: Buffer, testBuffer?: Buffer) {
  config._experimentScreenshotPath = config.env.experimentScreenshotDir || DEFAULT_EXPERIMENT_SCREENSHOT_DIR;
  config._controlScreenshotPath = config.env.controlScreenshotDir || DEFAULT_CONTROL_SCREENSHOT_DIR;
  config._fileNameTemplate = config.fileNameTemplate || DEFAULT_FILENAME_TEMPLATE;
  config._outputFileFormatSuffix = '.' + ((config.outputFormat && config.outputFormat.match(/jpg|jpeg/)) || 'png');
  config._configId = config.id || engineTools.genHash(config.configFileName);

  const testPair = engineTools.generateTestPair(config, scenario, viewport, variantOrScenarioLabelSafe, scenarioLabelSafe, 0, (scenario.selectors || ['document']).join('__'));
  testPair.engineErrorMsg = error.message;
  testPair.hadEngineError = true;
  if (annotationMsg) {
    testPair.annotationErrorMsg = 'Failed while ' + annotationMsg;
  }

  const filePath = testPair.test;
  ensureDirectoryPath(testPair.reference);
  if (refBuffer) {
    await writeFile(testPair.reference, refBuffer);
  } else {
    await copy(config.env.visregRoot + ERROR_SELECTOR_PATH, testPair.reference);
  }
  ensureDirectoryPath(filePath);
  if (testBuffer) {
    await writeFile(filePath, testBuffer);
  } else {
    await copy(config.env.visregRoot + ERROR_SELECTOR_PATH, filePath);
  }

  if (refBuffer) {
    const refAnalysis = analyzeWhitePixels(refBuffer);
    testPair.refWhitePixelPercent = refAnalysis.whitePixelPercent;
    testPair.refIsBottomSeventyPercentWhite = refAnalysis.isBottomSeventyPercentWhite;
  }
  if (testBuffer) {
    const testAnalysis = analyzeWhitePixels(testBuffer);
    testPair.testWhitePixelPercent = testAnalysis.whitePixelPercent;
    testPair.testIsBottomSeventyPercentWhite = testAnalysis.isBottomSeventyPercentWhite;
  }

  return { testPairs: [testPair] };
}

// ── Playwright entry point ─────────────────────────────────────────

export async function playwright ({ scenario, viewport, config, _playwrightBrowser: browser }: { scenario: Scenario; viewport: Viewport; config: DecoratedCompareConfig; _playwrightBrowser: Browser }) {
  const scenarioLabelSafe = engineTools.makeSafe(scenario.label);
  const variantOrScenarioLabelSafe = scenario._parent ? engineTools.makeSafe(scenario._parent.label) : scenarioLabelSafe;
  const logger = createLogger();

  const { engineOptions = {} } = config;
  const ignoreHTTPSErrors = engineOptions.ignoreHTTPSErrors !== undefined ? engineOptions.ignoreHTTPSErrors : true;
  // storageState shape comes from user config — cast to satisfy Playwright's newContext
  const storageState = (engineOptions.storageState || undefined) as string | undefined;

  // Create two separate browser contexts
  const refContext = await browser.newContext({ ignoreHTTPSErrors, storageState });
  const testContext = await browser.newContext({ ignoreHTTPSErrors, storageState });
  const refPage = await refContext.newPage();
  const testPage = await testContext.newPage();

  let compareConfig;
  let error: Error | undefined;
  let lastAnnotation: string | undefined;
  let errorRefBuffer: Buffer | undefined;
  let errorTestBuffer: Buffer | undefined;

  try {
    compareConfig = await processCompareView(
      scenario, variantOrScenarioLabelSafe, scenarioLabelSafe,
      viewport, config, refPage, testPage, refContext, testContext, logger
    );
  } catch (e: unknown) {
    logger.log('red', 'Error during live compare for "' + scenario.label + '"');
    logger.log('red', String(e));
    error = e instanceof Error ? e : new Error(String(e));
    lastAnnotation = e instanceof AnnotatedError ? e.lastAnnotation : undefined;

    // Capture real screenshots from both pages at time of error (best-effort)
    const [refSnap, testSnap] = await Promise.allSettled([
      refPage.screenshot({ fullPage: true }),
      testPage.screenshot({ fullPage: true }),
    ]);
    errorRefBuffer = refSnap.status === 'fulfilled' ? refSnap.value : undefined;
    errorTestBuffer = testSnap.status === 'fulfilled' ? testSnap.value : undefined;
  } finally {
    logger.log('green', 'x Close Browser Contexts');
    await refContext.close();
    await testContext.close();
  }

  if (error) {
    compareConfig = await buildErrorCompareConfig(config, scenario, viewport, variantOrScenarioLabelSafe, scenarioLabelSafe, error, lastAnnotation, errorRefBuffer, errorTestBuffer);
  }

  return Promise.resolve(compareConfig);
};
