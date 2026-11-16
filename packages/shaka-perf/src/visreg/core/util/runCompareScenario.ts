/*
 * Copyright (c) 2026 ShakaCode LLC.
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
import type { PlaywrightPage, Scenario, Viewport, Browser, TestPair, DecoratedCompareConfig, VisregRunRuntime } from '../types';

type ConsoleMethod = 'error' | 'warn' | 'log' | 'info';
interface CompareLogger {
  error: (color: string, message: string, ...rest: unknown[]) => void;
  warn: (color: string, message: string, ...rest: unknown[]) => void;
  log: (color: string, message: string, ...rest: unknown[]) => void;
  info: (color: string, message: string, ...rest: unknown[]) => void;
}

const BODY_SELECTOR = 'body';
const DOCUMENT_SELECTOR = 'document';
const NOCLIP_SELECTOR = 'body:noclip';
const VIEWPORT_SELECTOR = 'viewport';

function loggerAction (action: string, color: string, message: string, ...rest: unknown[]) {
  console[action as ConsoleMethod]((chalk as unknown as Record<string, (s: string) => string>)[color](message), ...rest);
}

function createLogger (): CompareLogger {
  return {
    error: loggerAction.bind(null, 'error'),
    warn: loggerAction.bind(null, 'warn'),
    log: loggerAction.bind(null, 'log'),
    info: loggerAction.bind(null, 'info')
  };
}

/**
 * Capture a single selector to a PNG buffer (no disk write).
 */
async function captureScreenshot (page: PlaywrightPage, selector: string) {
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

/**
 * Core comparison logic for live compare scenarios.
 */
async function processCompareView (
  scenario: Scenario,
  scenarioLabelSafe: string,
  viewport: Viewport,
  config: DecoratedCompareConfig,
  browser: Browser,
  logger: CompareLogger,
  runtime: VisregRunRuntime,
) {
  const compareConfig: { testPairs: TestPair[] } = { testPairs: [] };
  const pixelmatchThreshold = config.comparePixelmatchThreshold;
  logger.log('blue', 'LIVE COMPARE: opening reference (' + scenario.referenceUrl + ') and test (' + scenario.url + ') simultaneously');

  // A single attempt loop where attempt 0 IS the initial capture and every
  // retry rebuilds fresh, isolated sides the same way (see runCompareAttempts).
  // Per-selector cross-matching and crash-resume live in there too; it hands
  // back one outcome per selector for us to turn into a report entry.
  const outcomes = await runCompareAttempts(
    { captureScreenshot, captureFailure: runtime.captureFailure },
    { browser, config, viewport, scenario, scenarioLabelSafe, pixelmatchThreshold },
  );

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

  return compareConfig;
}

// ── Playwright entry point ─────────────────────────────────────────

export async function playwright (
  { scenario, viewport, config, _playwrightBrowser: browser }: {
    scenario: Scenario;
    viewport: Viewport;
    config: DecoratedCompareConfig;
    _playwrightBrowser: Browser;
  },
  runtime: VisregRunRuntime,
) {
  const scenarioLabelSafe = engineTools.makeSafe(scenario.label);
  const logger = createLogger();

  // The attempt loop (runCompareAttempts, via processCompareView) owns the
  // per-attempt context lifecycle now — including attempt 0 — so it builds and
  // tears down its own isolated sides. We just hand it the browser.
  return await processCompareView(
    scenario, scenarioLabelSafe,
    viewport, config, browser, logger, runtime,
  );
};
