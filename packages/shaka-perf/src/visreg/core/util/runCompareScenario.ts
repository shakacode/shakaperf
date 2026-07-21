/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ensureDirectoryPath from './ensureDirectoryPath';
import * as engineTools from './engineTools';
import { analyzeWhitePixels } from './compare/pixelmatch-inline';
import { runCompareAttempts } from './runCompareAttempts';
import type { PlaywrightPage, Scenario, Viewport, Browser, TestPair, DecoratedCompareConfig } from '../types';

type ConsoleMethod = 'error' | 'warn' | 'log' | 'info';
interface CompareLogger {
  logged: string[][];
  error: (color: string, message: string, ...rest: unknown[]) => void;
  warn: (color: string, message: string, ...rest: unknown[]) => void;
  log: (color: string, message: string, ...rest: unknown[]) => void;
  info: (color: string, message: string, ...rest: unknown[]) => void;
}

const DEFAULT_FILENAME_TEMPLATE = '{configId}_{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}';
const DEFAULT_EXPERIMENT_SCREENSHOT_DIR = 'experiment_screenshots';
const DEFAULT_CONTROL_SCREENSHOT_DIR = 'control_screenshots';
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
async function captureScreenshot (page: PlaywrightPage, selector: string, _selectorMap: Record<string, { filePath?: string }>) {
  const fullPage = (selector === NOCLIP_SELECTOR || selector === DOCUMENT_SELECTOR);

  if (selector === BODY_SELECTOR || selector === DOCUMENT_SELECTOR || selector === NOCLIP_SELECTOR) {
    return await page.screenshot({ fullPage });
  } else if (selector === VIEWPORT_SELECTOR) {
    return await page.screenshot();
  } else {
    // Element selector. Captured clipped to its bounding box within the current
    // viewport — the viewport is NOT resized to fit the element. An element
    // taller than the viewport must run at a tall viewport (see *_TALL_VIEWPORT).
    const el = await page.$(selector);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      if (box) {
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
async function processCompareView (scenario: Scenario, variantOrScenarioLabelSafe: string, scenarioLabelSafe: string, viewport: Viewport, config: DecoratedCompareConfig, browser: Browser, logger: CompareLogger) {
  const { scenarioDefaults = {} } = config;
  scenario = { ...scenarioDefaults, ...scenario };

  config._experimentScreenshotPath = config.env.experimentScreenshotDir || DEFAULT_EXPERIMENT_SCREENSHOT_DIR;
  config._controlScreenshotPath = config.env.controlScreenshotDir || DEFAULT_CONTROL_SCREENSHOT_DIR;
  config._fileNameTemplate = config.fileNameTemplate || DEFAULT_FILENAME_TEMPLATE;
  config._outputFileFormatSuffix = '.' + ((config.outputFormat && config.outputFormat.match(/jpg|jpeg/)) || 'png');
  config._configId = config.id || engineTools.genHash(config.configFileName);

  const compareConfig: { testPairs: TestPair[] } = { testPairs: [] };
  const pixelmatchThreshold = scenario.comparePixelmatchThreshold != null
    ? scenario.comparePixelmatchThreshold
    : (config.comparePixelmatchThreshold != null ? config.comparePixelmatchThreshold : 0.1);
  logger.log('blue', 'LIVE COMPARE: opening reference (' + scenario.referenceUrl + ') and test (' + scenario.url + ') simultaneously');

  // A single attempt loop where attempt 0 IS the initial capture and every
  // retry rebuilds fresh, isolated sides the same way (see runCompareAttempts).
  // Per-selector cross-matching and crash-resume live in there too; it hands
  // back one outcome per selector for us to turn into a report entry.
  const outcomes = await runCompareAttempts(
    { captureScreenshot },
    { browser, config, viewport, scenario, variantOrScenarioLabelSafe, scenarioLabelSafe, pixelmatchThreshold },
  );
  const selectors = outcomes.map((o) => o.selector);

  for (const outcome of outcomes) {
    const { selector, testPair, result, refFrame, testFrame } = outcome;

    const refAnalysis = analyzeWhitePixels(refFrame.buffer);
    const testAnalysis = analyzeWhitePixels(testFrame.buffer);
    testPair.refWhitePixelPercent = refAnalysis.whitePixelPercent;
    testPair.testWhitePixelPercent = testAnalysis.whitePixelPercent;
    testPair.refIsBottomSeventyPercentWhite = refAnalysis.isBottomSeventyPercentWhite;
    testPair.testIsBottomSeventyPercentWhite = testAnalysis.isBottomSeventyPercentWhite;

    // The chosen (matching or closest) frames are already on disk in the
    // accumulation dirs — reference them in place, no re-write.
    testPair.reference = refFrame.path;
    testPair.test = testFrame.path;

    // Save pixelmatch diff PNG (transparent BG, red changed pixels) if failed.
    // This becomes the diff thumbnail in the React report — clearer than the
    // resemble failed_diff (which overlays diffs on top of the test image).
    if (!result.pass && result.diffBuffer) {
      const diffPath = testPair.test.replace(/\.png$/, '_pixelmatch_diff.png');
      ensureDirectoryPath(diffPath);
      await writeFile(diffPath, result.diffBuffer);
      testPair.pixelmatchDiffImage = diffPath;
    }

    if (result.pass) {
      // Matched. `savedByRetries` distinguishes a clean first-capture match from
      // one that only matched via accumulated/cross-matched frames (the "Flaky
      // (saved by retries)" chip).
      testPair.savedByRetries = outcome.savedByRetries;
      logger.log('green', (outcome.savedByRetries ? 'PASS after retries: "' : 'PASS: "') + scenario.label + '" [' + selector + ']');
    } else {
      logger.log('red', 'FAIL: "' + scenario.label + '" [' + selector + ']');
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

// ── Playwright entry point ─────────────────────────────────────────

export async function playwright ({ scenario, viewport, config, _playwrightBrowser: browser }: { scenario: Scenario; viewport: Viewport; config: DecoratedCompareConfig; _playwrightBrowser: Browser }) {
  const scenarioLabelSafe = engineTools.makeSafe(scenario.label);
  const variantOrScenarioLabelSafe = scenario._parent ? engineTools.makeSafe(scenario._parent.label) : scenarioLabelSafe;
  const logger = createLogger();

  // The attempt loop (runCompareAttempts, via processCompareView) owns the
  // per-attempt context lifecycle now — including attempt 0 — so it builds and
  // tears down its own isolated sides. We just hand it the browser.
  return await processCompareView(
    scenario, variantOrScenarioLabelSafe, scenarioLabelSafe,
    viewport, config, browser, logger
  );
};
