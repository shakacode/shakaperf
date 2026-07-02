/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { crossMatch, ScreenshotPool, type PoolFrame } from './screenshotPool';
import defaultPreparePage from './preparePage';
import createLogger from './logger';
import type { PlaywrightPage, Scenario, Viewport, BrowserContext, DecoratedCompareConfig } from '../types';

const logger = createLogger('retryCompare');

type CaptureScreenshotFn = (page: PlaywrightPage, selector: string, selectorMap: Record<string, { filePath?: string }>, viewport: Viewport, config: DecoratedCompareConfig, useBoundingBox?: boolean) => Promise<Buffer | null>;
type PreparePageFn = (...args: unknown[]) => Promise<unknown>;

export interface RetryCompareOptions {
  captureScreenshot: CaptureScreenshotFn;
  refPage: PlaywrightPage;
  testPage: PlaywrightPage;
  selector: string;
  selectorMap: Record<string, { filePath?: string }>;
  viewport: Viewport;
  config: DecoratedCompareConfig;
  scenario: Scenario;
  initialRefBuffer: Buffer;
  initialTestBuffer: Buffer;
  refBrowserOrContext: BrowserContext;
  testBrowserOrContext: BrowserContext;
  preparePage?: PreparePageFn;
  pixelmatchThreshold?: number;
  useBoundingBoxViewportForSelectors?: boolean;
  /** Dir holding accumulated control frames (the unit's control_screenshots). */
  controlDir: string;
  /** Dir holding accumulated experiment frames (the unit's experiment_screenshots). */
  experimentDir: string;
  /** Stable per-comparison key (the screenshot filename template). */
  poolKey: string;
}

export interface RetryCompareResult {
  pass: boolean;
  /** Chosen (matching or closest) control frame — its path is already on disk. */
  refFrame: PoolFrame;
  /** Chosen (matching or closest) experiment frame. */
  testFrame: PoolFrame;
  diffBuffer: Buffer | null;
  /** Matched, but only by reaching past the first clean capture pair. */
  savedByRetries: boolean;
}

/**
 * Crash-resumable, accumulate-and-cross-match comparison.
 *
 * Rendering can be unstable AND the whole stage can crash/time-out and be
 * restarted. Every captured frame is persisted to the unit's screenshot dirs
 * via {@link ScreenshotPool}. On entry we re-load everything earlier attempts
 * captured (so a restart resumes), fold in this attempt's fresh initial pair,
 * and cross-match every control frame against every experiment frame: a match
 * if ANY pair matches, otherwise — once BOTH sides hold more frames than the
 * retry budget (i.e. 1 + retries each) — the CLOSEST pair as the mismatch.
 *
 * Resolves to a single result whose chosen frames are already on disk, so the
 * report references them in place (no canonical re-write) and a flaky/restarted
 * unit yields one comparison, not one per attempt.
 */
export default async function retryCompare(options: RetryCompareOptions): Promise<RetryCompareResult> {
  const {
    captureScreenshot,
    refPage, testPage,
    selector, selectorMap, viewport, config, scenario,
    initialRefBuffer, initialTestBuffer,
    refBrowserOrContext, testBrowserOrContext,
    preparePage: preparePageOverride,
    pixelmatchThreshold: pixelmatchThresholdOpt,
    controlDir, experimentDir, poolKey,
  } = options;

  const preparePage = preparePageOverride || defaultPreparePage;
  const pixelmatchThreshold = pixelmatchThresholdOpt ?? 0.1;

  const maxRetries = scenario.compareRetries != null
    ? scenario.compareRetries
    : (config.compareRetries != null ? config.compareRetries : 0);
  const retryDelayMs = scenario.compareRetryDelay != null
    ? scenario.compareRetryDelay
    : (config.compareRetryDelay != null ? config.compareRetryDelay : 5000);
  const maxNumDiffPixels = scenario.maxNumDiffPixels != null
    ? scenario.maxNumDiffPixels
    : (config.maxNumDiffPixels != null ? config.maxNumDiffPixels : 0);

  const pool = new ScreenshotPool(controlDir, experimentDir, poolKey);

  // Fold this attempt's fresh captures into whatever earlier (possibly crashed)
  // attempts already accumulated. `load()` returns distinct frames (filenames
  // are content hashes), so the in-memory pools mirror disk exactly.
  const hadPriorFrames = pool.load('control').length > 0 || pool.load('experiment').length > 0;
  pool.add('control', initialRefBuffer);
  pool.add('experiment', initialTestBuffer);
  let control = pool.load('control');
  let experiment = pool.load('experiment');

  const compareOpts = { maxNumDiffPixels, pixelmatchThreshold };
  let result = crossMatch(control.map((f) => f.buffer), experiment.map((f) => f.buffer), compareOpts);

  const bothExceededBudget = () => control.length > maxRetries && experiment.length > maxRetries;
  // A clean pass is the very first capture pair matching with nothing
  // accumulated before it. If this initial comparison didn't match, any later
  // match was saved by retried/resumed frames.
  const cleanFirstTry = result.pass && !hadPriorFrames && control.length === 1 && experiment.length === 1;

  let retry = 0;
  while (!result.pass && !bothExceededBudget() && retry < maxRetries) {
    // Linear backoff: 5s, 10s, 15s, ...
    const delay = retryDelayMs * (retry + 1);
    logger.log(`Retry ${retry + 1}/${maxRetries} for "${scenario.label}" [${selector}] - chilling for ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // captureScreenshot may expand the viewport for element bounding boxes, and
    // page.goto() does NOT reset it — causing dimension mismatches and false
    // diff pixels from transparent padding. Reset both viewports first.
    const VP_W = viewport.width || viewport.viewport!.width;
    const VP_H = viewport.height || viewport.viewport!.height;
    await Promise.all([
      refPage.setViewportSize({ width: VP_W, height: VP_H }),
      testPage.setViewportSize({ width: VP_W, height: VP_H }),
    ]);

    // Re-navigate and re-prepare both pages before re-capturing. A navigation
    // failure shouldn't abort the loop and lose the best match found so far.
    logger.log(`Re-navigating both pages for retry ${retry + 1}...`);
    try {
      await Promise.all([
        preparePage(testPage, scenario.url, scenario, viewport, config, false, testBrowserOrContext),
        preparePage(refPage, scenario.referenceUrl!, scenario, viewport, config, true, refBrowserOrContext),
      ]);
    } catch (e: unknown) {
      logger.log(`preparePage failed on retry ${retry + 1}: ${e instanceof Error ? e.message : String(e)}. Skipping to next retry...`);
      retry++;
      continue;
    }

    const [newTestBuffer, newRefBuffer] = await Promise.all([
      captureScreenshot(testPage, selector, selectorMap, viewport, config, options.useBoundingBoxViewportForSelectors),
      captureScreenshot(refPage, selector, selectorMap, viewport, config, options.useBoundingBoxViewportForSelectors),
    ]);

    // Persist new frames; `add` is content-addressed so identical re-captures
    // are no-ops and the pools only grow by genuinely new frames.
    const beforeControl = control.length;
    const beforeExperiment = experiment.length;
    if (newRefBuffer) pool.add('control', newRefBuffer);
    if (newTestBuffer) pool.add('experiment', newTestBuffer);
    control = pool.load('control');
    experiment = pool.load('experiment');

    result = crossMatch(control.map((f) => f.buffer), experiment.map((f) => f.buffer), compareOpts);
    if (result.pass) {
      logger.log(`Match found on retry ${retry + 1} (control[${result.controlIndex}] vs experiment[${result.experimentIndex}])`);
      break;
    }

    // No new frames this round (selector vanished, or rendering is pixel-stable
    // yet still mismatched) — further retries can't change the outcome.
    if (control.length === beforeControl && experiment.length === beforeExperiment) {
      logger.log(`No new frames captured on retry ${retry + 1} for "${scenario.label}" [${selector}]; stopping early.`);
      break;
    }
    retry++;
  }

  const refFrame = control[result.controlIndex];
  const testFrame = experiment[result.experimentIndex];

  if (result.pass) {
    return { pass: true, refFrame, testFrame, diffBuffer: null, savedByRetries: !cleanFirstTry };
  }

  logger.log(`No matching pair for "${scenario.label}" [${selector}] across ${control.length} control × ${experiment.length} experiment frames. Closest: ${result.leastDiffPixels} diff pixels.`);
  return { pass: false, refFrame, testFrame, diffBuffer: result.diffBuffer, savedByRetries: false };
}
