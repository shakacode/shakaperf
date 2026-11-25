/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';

import * as engineTools from './engineTools';
import defaultPreparePage from './preparePage';
import createLogger from './logger';
import { withLogPrefix } from './testContext';
import { formatLogPrefix } from '../../../pipeline/log-prefix-format';
import {
  formatWindowLabel,
  labelWindow,
  placeWindow,
  windowPlacementFor,
} from '../../../troubleshoot/window-placement';
import { createComparisonSide as defaultCreateComparisonSide, type ComparisonSide } from './createComparisonSide';
import { withPreparedSide, type CreateSideFn, type PreparePageFn } from './preparedSide';
import { ScreenshotPool, crossMatch, type PoolFrame, type CrossMatchResult } from './screenshotPool';
import { assertConsoleClean, type BrowserConsolePolicy } from '../../../browser-console';
import { reconstructEffectiveConfig } from '../../../effective-config';
import type { Browser, BrowserContext, PlaywrightPage, Scenario, Viewport, TestPair, DecoratedCompareConfig } from '../types';

const logger = createLogger('runCompareAttempts');

export type CaptureScreenshotFn = (
  page: PlaywrightPage,
  selector: string,
) => Promise<Buffer | null>;

/** Injected collaborators — defaulted to the real implementations; overridden in tests. */
export interface CompareAttemptsDeps {
  captureScreenshot: CaptureScreenshotFn;
  createSide?: CreateSideFn;
  preparePage?: PreparePageFn;
  sleep?: (ms: number) => Promise<void>;
  captureFailure?: (
    err: unknown,
    page: PlaywrightPage,
    isControl: boolean,
  ) => Promise<unknown>;
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
const DOCUMENT_SELECTOR = 'document';

interface CaptureComparisonSideParams {
  browser: Browser;
  config: DecoratedCompareConfig;
  viewport: Viewport;
  scenario: Scenario;
  url: string;
  isControl: boolean;
  beforeNavigate: Awaited<ReturnType<typeof reconstructEffectiveConfig>>['shared']['beforeNavigate'];
  browserConsole: BrowserConsolePolicy;
  runs: SelectorRun[];
  activeSides: Set<ComparisonSide>;
  createSide: NonNullable<CompareAttemptsDeps['createSide']>;
  preparePage: PreparePageFn;
  captureScreenshot: CaptureScreenshotFn;
  captureFailure?: NonNullable<CompareAttemptsDeps['captureFailure']>;
}

/**
 * Capture one comparison side's selectors. The side's whole lifecycle —
 * context, navigation, test body, teardown — belongs to `withPreparedSide`,
 * which the audit's `code_coverage` stage drives too, so both engines read the
 * same page. All that is compare-specific lives in the callback: screenshot
 * every pending selector, then assert the console stayed clean.
 */
async function captureComparisonSide(
  params: CaptureComparisonSideParams,
): Promise<Map<string, Buffer>> {
  const { scenario, viewport, isControl, runs, captureScreenshot } = params;
  const group = isControl ? 'control' : 'experiment';

  return withPreparedSide({
    browser: params.browser,
    config: params.config,
    viewport,
    scenario,
    url: params.url,
    isControl,
    beforeNavigate: params.beforeNavigate,
    browserConsole: params.browserConsole,
    activeSides: params.activeSides,
    createSide: params.createSide,
    preparePage: params.preparePage,
    ...(params.captureFailure ? { captureFailure: params.captureFailure } : {}),
    // One browser, two contexts — so the window is moved, not launched placed.
    ...(params.config.keepBrowserOpen
      ? {
        onSideReady: async (side: ComparisonSide) => {
          await placeWindow(side.page, windowPlacementFor('visreg', group, viewport));
        },
      }
      : {}),
    onKeptOpen: async (side) => {
      await labelWindow(side.page, formatWindowLabel('visreg', scenario.label, viewport.label));
    },
  }, async (side) => {
    const captures = new Map<string, Buffer>();
    for (const run of runs) {
      if (run.done) continue;
      const screenshot = await captureScreenshot(side.page, run.selector);
      if (!screenshot) {
        const pageLabel = isControl ? 'reference page' : 'test page';
        throw new Error(
          `Selector "${run.selector}" not found on ${pageLabel} for "${scenario.label}"`,
        );
      }
      captures.set(run.selector, screenshot);
    }

    assertConsoleClean(side.context);

    return captures;
  });
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
  const preparePage = deps.preparePage ?? defaultPreparePage;
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
  const browserConsole = effectiveConfig.shared.browserConsole;

  for (let attempt = 0; attempt <= maxRetries && (attempt === 0 || runs.some((r) => !r.done)); attempt++) {
    if (attempt > 0) {
      // Linear backoff: 5s, 10s, 15s, ...
      const delay = retryDelayMs * attempt;
      logger.log(`Retry ${attempt}/${maxRetries} for "${scenario.label}" - chilling for ${delay}ms`);
      await sleep(delay);
    }

    // The selector set is declarative on the scenario. Build the pools before
    // launching the concurrent side lifecycles so both sides capture the same
    // set of still-pending selectors.
    if (attempt === 0) {
      const selectors = scenario.selectors?.length
        ? scenario.selectors
        : [DOCUMENT_SELECTOR];
      runs = selectors.map((selector, selectorIndex) => {
        const testPair = engineTools.generateTestPair(
          config,
          scenario,
          viewport,
          scenarioLabelSafe,
          selectorIndex,
          selector,
        );
        const pool = new ScreenshotPool(
          path.dirname(testPair.reference),
          path.dirname(testPair.test),
          path.basename(testPair.test, engineTools.OUTPUT_FORMAT_SUFFIX),
        );
        return {
          selector,
          testPair,
          pool,
          control: pool.load('control'),
          experiment: pool.load('experiment'),
          result: null,
          done: false,
        };
      });
    }

    const activeSides = new Set<ComparisonSide>();
    const commonSideParams = {
      browser,
      config,
      viewport,
      scenario,
      beforeNavigate,
      browserConsole,
      runs,
      activeSides,
      createSide,
      preparePage,
      captureScreenshot,
      captureFailure: deps.captureFailure,
    };
    const captureSide = (url: string, isControl: boolean) =>
      withLogPrefix(
        formatLogPrefix(isControl ? 'control' : 'experiment'),
        () => captureComparisonSide({ ...commonSideParams, url, isControl }),
      );
    const [refCaptures, testCaptures] = await Promise.all([
      captureSide(scenario.referenceUrl!, true),
      captureSide(scenario.url, false),
    ]);

    for (const run of runs) {
      if (run.done) continue;
      const refBuffer = refCaptures.get(run.selector)!;
      const testBuffer = testCaptures.get(run.selector)!;

      // Frames are content-addressed, so identical re-captures are no-ops and
      // the pools only grow by genuinely new frames.
      const framesBefore = run.control.length + run.experiment.length;
      run.pool.add('control', refBuffer);
      run.pool.add('experiment', testBuffer);
      run.control = run.pool.load('control');
      run.experiment = run.pool.load('experiment');

      run.result = crossMatch(
        run.control.map((f) => f.buffer),
        run.experiment.map((f) => f.buffer),
        compareOpts,
      );
      const budgetSpent = run.control.length > maxRetries &&
        run.experiment.length > maxRetries;
      // A retry that added no frames is pixel-stable — retrying can't change it.
      const pixelStable = attempt > 0 &&
        run.control.length + run.experiment.length === framesBefore;
      run.done = run.result.pass || budgetSpent || pixelStable;
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
