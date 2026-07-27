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
import { createComparisonSide as defaultCreateComparisonSide, type ComparisonSide } from './createComparisonSide';
import { ScreenshotPool, crossMatch, type PoolFrame, type CrossMatchResult } from './screenshotPool';
import { setUpContextForNavigation } from '../../../pre-navigation';
import { reconstructEffectiveConfig } from '../../../effective-config';
import {
  findVisregSideFailure,
  VisregSideFailure,
  type VisregSide,
} from '../side-failure';
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
  createSide?: (browser: Browser, config: DecoratedCompareConfig, viewport: Viewport, onContextReady?: (context: BrowserContext) => Promise<void>) => Promise<ComparisonSide>;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function settleSidePair<C, E>(
  control: Promise<C>,
  experiment: Promise<E>,
): Promise<[C, E]> {
  const [controlResult, experimentResult] = await Promise.allSettled([
    control,
    experiment,
  ]);
  if (experimentResult.status === 'rejected') {
    if (controlResult.status === 'rejected') {
      logger.warn(
        `Control side failed while experiment also failed: ${errorMessage(controlResult.reason)}`,
      );
    }
    throw experimentResult.reason;
  }
  if (controlResult.status === 'rejected') throw controlResult.reason;
  return [controlResult.value, experimentResult.value];
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

  const toSideFailure = async (
    side: VisregSide,
    resources: ComparisonSide | undefined,
    cause: unknown,
  ): Promise<VisregSideFailure> => {
    if (!resources) return new VisregSideFailure(side, cause);
    try {
      const screenshotPath = failureScreenshotPath(
        config,
        scenario,
        viewport,
        side === 'control',
      );
      await captureFailureScreenshot(resources.page, screenshotPath);
      return new VisregSideFailure(side, cause, screenshotPath);
    } catch (captureErr) {
      logger.warn(`Could not capture ${side} failure screenshot: ${errorMessage(captureErr)}`);
      return new VisregSideFailure(side, cause);
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

    const createSideFor = async (
      side: VisregSide,
      url: string,
      isControl: boolean,
    ): Promise<ComparisonSide> => {
      try {
        return await createSide(
          browser,
          config,
          viewport,
          setUpSide(url, isControl),
        );
      } catch (cause) {
        throw new VisregSideFailure(side, cause);
      }
    };

    let controlSide: ComparisonSide | undefined;
    let experimentSide: ComparisonSide | undefined;

    const runOnSide = async <T>(
      side: VisregSide,
      resources: ComparisonSide,
      body: () => Promise<T>,
    ): Promise<T> => {
      try {
        return await withLogPrefix(formatLogPrefix(side), body);
      } catch (cause) {
        throw await toSideFailure(side, resources, cause);
      }
    };

    try {
      controlSide = await createSideFor('control', scenario.referenceUrl!, true);
      experimentSide = await createSideFor('experiment', scenario.url, false);
      const control = controlSide;
      const experiment = experimentSide;

      const [refResult, testResult] = await settleSidePair(
        runOnSide('control', control, () => preparePage(
          control.page,
          scenario.referenceUrl!,
          scenario,
          viewport,
          config,
          true,
          control.context,
        )),
        runOnSide('experiment', experiment, () => preparePage(
          experiment.page,
          scenario.url,
          scenario,
          viewport,
          config,
          false,
          experiment.context,
        )),
      );

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

        const [refBuffer, testBuffer] = await settleSidePair(
          runOnSide('control', control, () =>
            captureScreenshot(control.page, run.selector, refResult.selectorMap)),
          runOnSide('experiment', experiment, () =>
            captureScreenshot(experiment.page, run.selector, testResult.selectorMap)),
        );
        if (!refBuffer || !testBuffer) {
          const where = !refBuffer && !testBuffer ? 'reference and test pages' : (!refBuffer ? 'reference page' : 'test page');
          const side = !testBuffer ? 'experiment' : 'control';
          const resources = side === 'experiment' ? experiment : control;
          throw await toSideFailure(
            side,
            resources,
            new Error(`Selector "${run.selector}" not found on ${where} for "${scenario.label}"`),
          );
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
    } catch (error) {
      if (findVisregSideFailure(error) || !experimentSide) throw error;
      throw await toSideFailure('experiment', experimentSide, error);
    } finally {
      for (const side of [controlSide, experimentSide]) {
        if (side) await side.dispose();
      }
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
