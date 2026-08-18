/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { resolvePlaywrightOptions, type PlaywrightOptions } from '../../../config';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import { StageFailureError, captureFailureScreenshot } from '../../../stage/stage-failure';
import { setUpContextForNavigation } from '../../../pre-navigation';
import { runWithLastAnnotation } from '../../../test-annotation';
import {
  captureVisibilitySnapshot,
  formatVisibilityMap,
  VISIBILITY_MAP_FILENAME,
} from '../../../bench/core/visibility-map';
import { realChromeContextOptions, waitForBotWallToClear } from '../../real-chrome';
import { launchStageBrowser, stageContextOptions } from '../../stage-browser';
import {
  COVERAGE_FILENAME,
  COVERAGE_STATEMENT_IDS_FILENAME,
  mirrorCoverageToNycOutput,
  summarizeCoverage,
} from './coverage-artifacts';
import type { CodeCoverageResult } from './stage';

type PageGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

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
      slot.codeCoverageBrowser = await launchStageBrowser(
        resolvePlaywrightOptions(ctx.runtime.config, 'visreg'),
        ctx.runtime.headed === true,
      );
    }
    return collectCoverage(ctx, slot.codeCoverageBrowser);
  }, { key: ctx.testAndViewportId });
}

async function collectCoverage(ctx: TestContext, browser: Browser): Promise<CodeCoverageResult> {
  const playwrightOptions = resolvePlaywrightOptions(ctx.config, 'visreg');
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      ...stageContextOptions(ctx.viewport, playwrightOptions),
      ...realChromeContextOptions(
        ctx.viewport.formFactor,
        browser.version?.(),
        playwrightOptions.browser === 'chromium',
      ),
    });
    await setUpContextForNavigation({
      context,
      url: ctx.experimentURL,
      viewport: ctx.viewport,
      isControl: false,
      testType: 'visreg',
      beforeNavigate: ctx.config.shared.beforeNavigate,
    });
    page = await context.newPage();
    page.setDefaultTimeout(playwrightOptions.waitTimeout);
    page.setDefaultNavigationTimeout(playwrightOptions.waitTimeout);
    await page.goto(ctx.experimentURL, gotoOptions(playwrightOptions));
    await waitForBotWallToClear(page);
    // The same body visreg runs, told the same `testType`, so the coverage
    // drained below belongs to the rendering visreg screenshots.
    await runWithLastAnnotation((annotate) => ctx.test.testFn({
      page: page!,
      browserContext: context!,
      isControl: false,
      scenario: ctx.test,
      viewport: ctx.viewport,
      testType: 'visreg',
      annotate,
    }));
    // Both lenses come off the SAME finished page, in the same browser visreg
    // screenshots: which statements ran, and which of the elements they
    // rendered would land inside this test's `visregSelectors`.
    return {
      ...await drainCoverage(ctx, page),
      ...await writeVisibilityMap(ctx, page),
    };
  } catch (err) {
    const media = page
      ? await captureFailureScreenshot(
        ctx.artifacts,
        () => page!.screenshot({ type: 'png', fullPage: true }),
        'code-coverage-failure-screenshot.png',
      )
      : undefined;
    throw media ? new StageFailureError(err, { media }) : err;
  } finally {
    await context?.close().catch(() => {});
  }
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
  const coverageStatementIdsHref = await ctx.artifacts.writeJson(
    COVERAGE_STATEMENT_IDS_FILENAME,
    summary.statementIds,
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
    coverageStatementIdsHref,
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

function gotoOptions(playwrightOptions: PlaywrightOptions): PageGotoOptions {
  const candidate = playwrightOptions.gotoParameters;
  if (candidate && typeof candidate === 'object') return candidate as PageGotoOptions;
  return { waitUntil: 'networkidle' };
}
