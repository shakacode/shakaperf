/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import type { Browser, Page } from 'playwright-core';
import { resolvePlaywrightOptions } from '../../../config';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import { StageFailureError, captureFailureScreenshot } from '../../../stage/stage-failure';
import {
  captureVisibilitySnapshot,
  formatVisibilityMap,
  VISIBILITY_MAP_FILENAME,
} from '../../../bench/core/visibility-map';
import { createPlaywrightBrowser } from '../../../visreg/core/util/runPlaywright';
import { withPreparedSide } from '../../../visreg/core/util/preparedSide';
import { convertAbTestToScenario } from '../../../visreg/core/util/convertAbTestToScenario';
import type { EngineBrowserConfig } from '../../../visreg/core/types';
import {
  COVERAGE_FILENAME,
  COVERAGE_SCREENSHOT_FILENAME,
  mirrorCoverageToNycOutput,
  summarizeCoverage,
} from './coverage-artifacts';
import type { CodeCoverageResult } from './stage';

interface CodeCoverageSlotState extends PoolWorkerState {
  codeCoverageBrowser?: Browser;
}

async function disposeCodeCoverageBrowser(state: Record<string, unknown>): Promise<void> {
  const slot = state as CodeCoverageSlotState;
  const browser = slot.codeCoverageBrowser;
  if (!browser) return;
  slot.codeCoverageBrowser = undefined;
  await browser.close().catch(() => {});
}

export async function runCodeCoverageStage(
  ctx: TestContext,
  workerPool: WorkerPool,
): Promise<CodeCoverageResult> {
  return workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<CodeCoverageSlotState>(state, disposeCodeCoverageBrowser);
    if (!slot.codeCoverageBrowser) {
      // Launch options can't vary once the browser is up, so the shared
      // per-slot browser takes the FILE-level visreg options; the per-scan
      // context below re-resolves them per test.
      slot.codeCoverageBrowser = await createPlaywrightBrowser(
        engineConfig(resolvePlaywrightOptions(ctx.runtime.config, 'visreg'), ctx),
      );
    }
    return collectCoverage(ctx, slot.codeCoverageBrowser);
  }, { key: ctx.testAndViewportId });
}

// The engine helpers read nothing but these two fields (see EngineBrowserConfig),
// so the stage drives them directly instead of building a bridge config.
function engineConfig(
  playwrightOptions: ReturnType<typeof resolvePlaywrightOptions>,
  ctx: TestContext,
): EngineBrowserConfig {
  return { playwrightOptions, headed: ctx.runtime.headed === true };
}

/**
 * Drain both coverage lenses off a page built by `withPreparedSide` — the SAME
 * function visreg captures its screenshots from. Everything about the page is
 * therefore visreg's: its context and device emulation, its navigation
 * defaults, the `_visregTools` it injects, and the test body it runs. All this
 * stage adds is what it does with the finished page.
 *
 * It deliberately passes no `browserConsole`: capture only pays for itself
 * when someone asserts on it, and visreg already fails the test for a dirty
 * console. Failing twice for one cause would just double the noise.
 */
async function collectCoverage(ctx: TestContext, browser: Browser): Promise<CodeCoverageResult> {
  const config = engineConfig(resolvePlaywrightOptions(ctx.config, 'visreg'), ctx);
  const scenario = convertAbTestToScenario(ctx.test, ctx.controlURL, ctx.experimentURL, {
    controlURL: ctx.controlURL,
    experimentURL: ctx.experimentURL,
  });
  return withPreparedSide({
    browser,
    config,
    viewport: ctx.viewport,
    scenario,
    url: scenario.url,
    isControl: false,
    beforeNavigate: ctx.config.shared.beforeNavigate,
    captureFailure: async (err, page) => {
      const media = await captureFailureScreenshot(
        ctx.artifacts,
        () => page.screenshot({ type: 'png', fullPage: true }),
        'code-coverage-failure-screenshot.png',
      );
      return media ? new StageFailureError(err, { media }) : err;
    },
  }, async (side) => ({
    // Both lenses come off one finished page, at the moment visreg would
    // photograph it: which statements ran, and which of the elements they
    // rendered would land inside this test's `visregSelectors`.
    ...await drainCoverage(ctx, side.page),
    ...await writeVisibilityMap(ctx, side.page),
    // LAST, deliberately: a fullPage screenshot scrolls the page to stitch it,
    // and the map above reads scroll-dependent state (the viewport rect, and
    // hit-testing that only works on what is currently on screen).
    ...await writeScreenshot(ctx, side.page),
  }));
}

type CoverageMeasurement = Omit<CodeCoverageResult, 'visibilityMapHref'>;

async function drainCoverage(ctx: TestContext, page: Page): Promise<CoverageMeasurement> {
  const coverage = await page.evaluate(
    () => (globalThis as { __coverage__?: unknown }).__coverage__,
  );
  if (!coverage || typeof coverage !== 'object') {
    // Nobody runs this category by accident, so "you asked for coverage and
    // there is none" is a failed measurement, not a note. Reporting zeros (or
    // the visibility map alone) would read downstream as "this test executed
    // nothing", which is a different — and false — statement.
    throw new Error(
      `window.__coverage__ is missing on ${ctx.experimentURL}: the served bundle is not ` +
      'instrumented. Instrument the build (babel-plugin-istanbul, `nyc instrument`, or ' +
      'swc-plugin-coverage-instrument) or drop code_coverage from --categories.',
    );
  }
  const summary = summarizeCoverage(coverage);
  const coverageHref = await ctx.artifacts.writeFile(
    COVERAGE_FILENAME,
    JSON.stringify(coverage),
  );
  mirrorCoverageToNycOutput(
    path.join(ctx.artifacts.dir, COVERAGE_FILENAME),
    ctx.runtime.resultsRoot,
    ctx.testAndViewportId,
  );
  console.log(chalk.dim(
    `coverage: ${summary.coveredStatements}/${summary.totalStatements} statements ` +
    `across ${summary.files} instrumented files`,
  ));
  return {
    files: summary.files,
    coveredStatements: summary.coveredStatements,
    totalStatements: summary.totalStatements,
    coverageHref,
  };
}

// Screenshot coverage: what the finished page SHOWS, scored against the region
// a visreg screenshot of this test would keep. Read alongside the code gutters
// (see the `shaka-perf-coverage` skill) — a statement a test executed whose
// element is 0% visible is a hole no coverage percentage can show.
async function writeVisibilityMap(
  ctx: TestContext,
  page: Page,
): Promise<{ visibilityMapHref?: string }> {
  try {
    const snapshot = await captureVisibilitySnapshot(page, {
      selectors: ctx.test.visregSelectors,
      testName: ctx.test.name,
      viewportLabel: ctx.viewport.label,
    });
    return {
      visibilityMapHref: await ctx.artifacts.writeFile(
        VISIBILITY_MAP_FILENAME,
        formatVisibilityMap(snapshot),
      ),
    };
  } catch (err) {
    // A map we could not take must not sink coverage we already drained.
    console.warn(chalk.yellow(
      `[shaka-perf visibility] could not snapshot ${ctx.experimentURL}: ${(err as Error).message}`,
    ));
    return {};
  }
}

// The map's evidence: one shot of the page it describes, so a reader can see
// the element it scored at 0% rather than trust the number. Whole document, not
// the capture region — the map walks the whole document too, and scoring an
// element "outside capture" only means something if you can see what was left
// out of the frame.
async function writeScreenshot(
  ctx: TestContext,
  page: Page,
): Promise<{ screenshotHref?: string }> {
  try {
    return {
      screenshotHref: await ctx.artifacts.writeFile(
        COVERAGE_SCREENSHOT_FILENAME,
        await page.screenshot({ type: 'png', fullPage: true }),
      ),
    };
  } catch (err) {
    // Same rule as the map: evidence is worth having, not worth failing over.
    console.warn(chalk.yellow(
      `[shaka-perf visibility] could not screenshot ${ctx.experimentURL}: ${(err as Error).message}`,
    ));
    return {};
  }
}
