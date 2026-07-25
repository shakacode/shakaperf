/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';

import * as engineTools from './engineTools';
import defaultPreparePage, { captureFailureScreenshot, failureScreenshotPath } from './preparePage';
import createLogger from './logger';
import { withLogPrefix } from './testContext';
import { formatLogPrefix } from '../../../pipeline/log-prefix-format';
import { createComparisonSide as defaultCreateComparisonSide, type ComparisonSide, type ComparisonSideName } from './createComparisonSide';
import { ScreenshotPool, crossMatch, type PoolFrame, type CrossMatchResult } from './screenshotPool';
import { setUpContextForNavigation } from '../../../pre-navigation';
import { reconstructEffectiveConfig } from '../../../effective-config';
import type { Browser, BrowserContext, PlaywrightPage, Scenario, Viewport, TestPair, DecoratedCompareConfig } from '../types';

const logger = createLogger('runCompareAttempts');

export type CaptureScreenshotFn = (
  page: PlaywrightPage,
  selector: string,
  selectorMap: Record<string, { filePath?: string }>,
) => Promise<Buffer | null>;

type PreparePageFn = (...args: unknown[]) => Promise<{
  selectors: string[];
  selectorMap: Record<string, { filePath?: string }>;
}>;

/** Injected collaborators — defaulted to the real implementations; overridden in tests. */
export interface CompareAttemptsDeps {
  captureScreenshot: CaptureScreenshotFn;
  createSide?: (browser: Browser, config: DecoratedCompareConfig, viewport: Viewport, side: ComparisonSideName, onContextReady?: (context: BrowserContext) => Promise<void>) => Promise<ComparisonSide>;
  preparePage?: PreparePageFn;
  sleep?: (ms: number) => Promise<void>;
}

export interface CompareAttemptsParams {
  browser: Browser;
  config: DecoratedCompareConfig;
  viewport: Viewport;
  scenario: Scenario;
  scenarioLabelSafe: string;
  pixelmatchThreshold: number;
}

/** Per-selector verdict the caller turns into a report entry. */
export interface CompareSelectorOutcome {
  selector: string;
  testPair: TestPair;
  result: CrossMatchResult;
  /** Chosen (matching or closest) frames; their paths become the report's ref/test. */
  refFrame: PoolFrame;
  testFrame: PoolFrame;
  /** Matched, but not by a single clean capture pair (retried or crash-resumed frames). */
  savedByRetries: boolean;
}

interface SelectorRun {
  selector: string;
  testPair: TestPair;
  pool: ScreenshotPool;
  control: PoolFrame[];
  experiment: PoolFrame[];
  result: CrossMatchResult | null;
  done: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function attachFailureScreenshotPath<T>(err: T, screenshotPath: string | null): T {
  if (!screenshotPath || !err || typeof err !== 'object') return err;
  try {
    Object.defineProperty(err, 'failureScreenshotPath', {
      value: screenshotPath,
      configurable: true,
      writable: true,
    });
  } catch {
    // Never let metadata attachment mask the user's original failure.
  }
  return err;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Drive one compare unit (scenario × viewport, across its selectors) through a
 * single attempt loop: every attempt builds two fresh isolated sides via the
 * shared factory (so a state-mutating testFn can't stack across retries),
 * prepares both pages, and captures each still-pending selector. Frames
 * accumulate per selector in a crash-resumable {@link ScreenshotPool}; a
 * selector passes if ANY control frame matches ANY experiment frame, otherwise
 * it yields the closest pair once the retry budget is spent.
 *
 * Three outcomes only: pass, mismatch, or throw. Selectors are expected to
 * exist on both pages on every attempt — a null capture throws, and the
 * framework's unit-level retry/error reporting takes it from there.
 */
export async function runCompareAttempts(
  deps: CompareAttemptsDeps,
  params: CompareAttemptsParams,
): Promise<CompareSelectorOutcome[]> {
  const { browser, config, viewport, scenario, scenarioLabelSafe, pixelmatchThreshold } = params;
  const captureScreenshot = deps.captureScreenshot;
  const createSide = deps.createSide ?? defaultCreateComparisonSide;
  const preparePage = (deps.preparePage ?? defaultPreparePage) as PreparePageFn;
  const sleep = deps.sleep ?? defaultSleep;

  // All comparison tuning is read straight off the effective config (the compare
  // stage already merged `config.visreg` and wrote it into the bridge config).
  const maxRetries = config.compareRetries ?? 0;
  const retryDelayMs = config.compareRetryDelay ?? 5000;
  const maxNumDiffPixels = config.maxNumDiffPixels;
  const compareOpts = { maxNumDiffPixels, pixelmatchThreshold };

  let runs: SelectorRun[] = [];

  // JSON-bridge boundary: the engine's config crosses as data (no functions), so
  // rebuild this test's effective config here and read from it.
  const effectiveConfig = await reconstructEffectiveConfig(scenario._testDef);
  const beforeNavigate = effectiveConfig.shared.beforeNavigate;

  // Grab a side's live full page into the dir the report reads. Best effort:
  // path generation and page capture are both inside the guard so neither can
  // mask the original scenario error.
  const captureFailure = async (side: ComparisonSide): Promise<string | null> => {
    try {
      const screenshotPath = failureScreenshotPath(config, scenario, viewport, side.side === 'control');
      await captureFailureScreenshot(side.page, screenshotPath);
      return screenshotPath;
    } catch (captureErr) {
      logger.warn(`Could not capture ${side.side} failure screenshot: ${errorMessage(captureErr)}`);
      return null;
    }
  };

  for (let attempt = 0; attempt <= maxRetries && (attempt === 0 || runs.some((r) => !r.done)); attempt++) {
    if (attempt > 0) {
      // Linear backoff: 5s, 10s, 15s, ...
      const delay = retryDelayMs * attempt;
      logger.log(`Retry ${attempt}/${maxRetries} for "${scenario.label}" - chilling for ${delay}ms`);
      await sleep(delay);
    }

    // Pre-nav setup, run via createComparisonSide's onContextReady before the
    // page is created — the shared clear → beforeNavigate sequence.
    const setUpSide = (url: string, isControl: boolean) => (context: BrowserContext): Promise<void> =>
      setUpContextForNavigation({
        context,
        url,
        viewport,
        isControl,
        testType: 'visreg',
        beforeNavigate,
      });

    // Two throwaway sides per attempt, torn down on every exit path.
    const sides: ComparisonSide[] = [];
    const capturedFailurePaths = new Map<ComparisonSide, string | null>();
    let sideSpecificFailure = false;

    const captureFailureOnce = async (side: ComparisonSide): Promise<string | null> => {
      if (capturedFailurePaths.has(side)) return capturedFailurePaths.get(side) ?? null;
      const screenshotPath = await captureFailure(side);
      capturedFailurePaths.set(side, screenshotPath);
      return screenshotPath;
    };

    const captureFailures = async (failedSides: ComparisonSide[]): Promise<Map<ComparisonSideName, string | null>> => {
      const entries = await Promise.all(failedSides.map(async (side) => [
        side.side,
        await captureFailureOnce(side),
      ] as const));
      return new Map(entries);
    };

    // Prepare one side (navigate + run the scenario's testFn) under its
    // side-scoped log label. On a throw, screenshot THIS side at its true
    // failure point before teardown.
    const prepareSide = (side: ComparisonSide, url: string) =>
      withLogPrefix(formatLogPrefix(side.side), async () => {
        try {
          return await preparePage(side.page, url, scenario, viewport, config, side.side === 'control', side.context);
        } catch (err) {
          const screenshotPath = await captureFailureOnce(side);
          throw attachFailureScreenshotPath(err, screenshotPath);
        }
      });

    try {
      const refSide = await createSide(browser, config, viewport, 'control', setUpSide(scenario.referenceUrl!, true));
      sides.push(refSide);
      const testSide = await createSide(browser, config, viewport, 'experiment', setUpSide(scenario.url, false));
      sides.push(testSide);

      // Navigate + prepare both pages concurrently. allSettled (not all) so a
      // throw on one side lets the other reach a terminal state before the
      // finally disposes it. That trades off latency when the surviving side is
      // slow, but it keeps failure screenshots anchored to completed side state.
      const [refPrep, testPrep] = await Promise.allSettled([
        prepareSide(refSide, scenario.referenceUrl!),
        prepareSide(testSide, scenario.url),
      ]);
      // Surface the experiment side's failure first — it's the side under test.
      if (testPrep.status === 'rejected') {
        sideSpecificFailure = true;
        if (refPrep.status === 'rejected') {
          logger.warn(`Control side prepare failed while experiment also failed: ${errorMessage(refPrep.reason)}`);
        }
        throw testPrep.reason;
      }
      if (refPrep.status === 'rejected') {
        sideSpecificFailure = true;
        throw refPrep.reason;
      }
      const refResult = refPrep.value;
      const testResult = testPrep.value;

      // Attempt 0 discovers the selector set (from the test/experiment page);
      // later attempts re-capture that fixed set so pool keys stay stable.
      if (attempt === 0) {
        runs = testResult.selectors.map((selector, selectorIndex) => {
          const testPair = engineTools.generateTestPair(config, scenario, viewport, scenarioLabelSafe, selectorIndex, selector);
          if (testResult.selectorMap[selector]) testResult.selectorMap[selector].filePath = testPair.test;
          if (refResult.selectorMap[selector]) refResult.selectorMap[selector].filePath = testPair.reference;
          const pool = new ScreenshotPool(path.dirname(testPair.reference), path.dirname(testPair.test), path.basename(testPair.test, engineTools.OUTPUT_FORMAT_SUFFIX));
          return { selector, testPair, pool, control: pool.load('control'), experiment: pool.load('experiment'), result: null, done: false };
        });
      }

      for (const run of runs) {
        if (run.done) continue;

        const [refCapture, testCapture] = await Promise.allSettled([
          withLogPrefix(formatLogPrefix('control'), () => captureScreenshot(refSide.page, run.selector, refResult.selectorMap)),
          withLogPrefix(formatLogPrefix('experiment'), () => captureScreenshot(testSide.page, run.selector, testResult.selectorMap)),
        ]);
        if (refCapture.status === 'rejected' || testCapture.status === 'rejected') {
          sideSpecificFailure = true;
          const failedSides: ComparisonSide[] = [];
          if (refCapture.status === 'rejected') failedSides.push(refSide);
          if (testCapture.status === 'rejected') failedSides.push(testSide);
          const pathsBySide = await captureFailures(failedSides);
          if (refCapture.status === 'rejected') {
            attachFailureScreenshotPath(refCapture.reason, pathsBySide.get('control') ?? null);
          }
          if (testCapture.status === 'rejected') {
            attachFailureScreenshotPath(testCapture.reason, pathsBySide.get('experiment') ?? null);
          }
          if (refCapture.status === 'rejected' && testCapture.status === 'rejected') {
            logger.warn(`Control side screenshot capture failed while experiment also failed: ${errorMessage(refCapture.reason)}`);
          }
          if (testCapture.status === 'rejected') throw testCapture.reason;
          if (refCapture.status === 'rejected') throw refCapture.reason;
        }

        const refBuffer = refCapture.value;
        const testBuffer = testCapture.value;
        if (!refBuffer || !testBuffer) {
          sideSpecificFailure = true;
          // Both pages prepared successfully and are still alive here, so
          // screenshot the side(s) actually missing the selector.
          const missingSides: ComparisonSide[] = [];
          if (!refBuffer) missingSides.push(refSide);
          if (!testBuffer) missingSides.push(testSide);
          const pathsBySide = await captureFailures(missingSides);
          const where = !refBuffer && !testBuffer ? 'reference and test pages' : (!refBuffer ? 'reference page' : 'test page');
          const err = new Error(`Selector "${run.selector}" not found on ${where} for "${scenario.label}"`);
          const screenshotPath = !testBuffer
            ? pathsBySide.get('experiment') ?? null
            : pathsBySide.get('control') ?? null;
          throw attachFailureScreenshotPath(err, screenshotPath);
        }

        // Frames are content-addressed, so identical re-captures are no-ops and
        // the pools only grow by genuinely new frames.
        const framesBefore = run.control.length + run.experiment.length;
        run.pool.add('control', refBuffer);
        run.pool.add('experiment', testBuffer);
        run.control = run.pool.load('control');
        run.experiment = run.pool.load('experiment');

        run.result = crossMatch(run.control.map((f) => f.buffer), run.experiment.map((f) => f.buffer), compareOpts);
        const budgetSpent = run.control.length > maxRetries && run.experiment.length > maxRetries;
        // A retry that added no frames is pixel-stable — retrying can't change it.
        const pixelStable = attempt > 0 && run.control.length + run.experiment.length === framesBefore;
        run.done = run.result.pass || budgetSpent || pixelStable;
      }
    } catch (err) {
      if (!sideSpecificFailure && sides.length > 0) {
        const pathsBySide = await captureFailures(sides);
        attachFailureScreenshotPath(
          err,
          pathsBySide.get('experiment') ?? pathsBySide.get('control') ?? null,
        );
      }
      throw err;
    } finally {
      for (const side of sides) await side.dispose();
    }
  }

  return runs.map((run) => {
    const result = run.result!;
    if (!result.pass) {
      logger.log(`No matching pair for "${scenario.label}" [${run.selector}] across ${run.control.length} control × ${run.experiment.length} experiment frames. Closest: ${result.leastDiffPixels} diff pixels.`);
    }
    return {
      selector: run.selector,
      testPair: run.testPair,
      result,
      refFrame: run.control[result.controlIndex],
      testFrame: run.experiment[result.experimentIndex],
      // Clean = the single first capture pair matched. Anything that needed a
      // second frame (a retry or a crash-resumed leftover) was saved by retries.
      savedByRetries: result.pass && (run.control.length > 1 || run.experiment.length > 1),
    };
  });
}
