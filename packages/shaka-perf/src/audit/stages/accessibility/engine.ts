/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright-core';
import { createTestAnnotate, runWithTestAnnotationContext } from '../../../test-annotation';
import type { AbTestDefinition } from 'shaka-shared';
import { runBeforeNavigateHooks } from '../../../before-navigate';
import { scanLandedOnBotWall } from '../../bot-wall';
import { applyRealChrome, realChromeMobileEmulation, waitForBotWallToClear } from '../../real-chrome';
import { clearBrowserData } from '../../../bench/core/clear-browser-data';
import { bufferToAvifDataUri } from '../../../pipeline/artifact-compression';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import { StageFailureError } from '../../../stage/stage-failure';
import { toPosixRelative } from '../../../pipeline/path-utils';
import {
  accessibilityConfigForTest,
  type AccessibilityEffectiveConfig,
  type AccessibilityStageConfig,
} from './config';
import {
  ACCESSIBILITY_RAW_REPORT_FILENAME,
  ACCESSIBILITY_SCREENSHOT_FILENAME,
  normalizeViolation,
  projectAccessibilityRawArtifact,
} from './artifacts';
import type {
  AccessibilityNodeBounds,
  AccessibilityRawArtifact,
  AccessibilityResult,
  AccessibilityScan,
  AccessibilityViolation,
} from './types';

interface AccessibilitySlotState extends PoolWorkerState {
  accessibilityBrowser?: Browser;
}

type PageGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

async function disposeAccessibilityBrowser(state: Record<string, unknown>): Promise<void> {
  const slot = state as AccessibilitySlotState;
  const browser = slot.accessibilityBrowser;
  if (!browser) return;
  slot.accessibilityBrowser = undefined;
  await browser.close().catch(() => {});
}

export async function runAccessibilityStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: AccessibilityStageConfig,
): Promise<AccessibilityResult> {
  return workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<AccessibilitySlotState>(state, disposeAccessibilityBrowser);
    if (!slot.accessibilityBrowser) {
      slot.accessibilityBrowser = await launchBrowser(config, ctx.runtime.headed);
    }
    return scanAccessibility(ctx, slot.accessibilityBrowser, config);
  }, { key: ctx.testAndViewportId });
}

async function launchBrowser(config: AccessibilityStageConfig, headed = false): Promise<Browser> {
  const engine = config.engineOptions.browser ?? 'chromium';
  const launchOptions: LaunchOptions = {
    headless: headed ? false : config.engineOptions.headless ?? true,
    args: config.engineOptions.args,
  };
  if (engine === 'firefox') return firefox.launch(launchOptions);
  if (engine === 'webkit') return webkit.launch(launchOptions);
  return chromium.launch(applyRealChrome(launchOptions));
}

async function scanAccessibility(
  ctx: TestContext,
  browser: Browser,
  config: AccessibilityStageConfig,
): Promise<AccessibilityResult> {
  const effective = accessibilityConfigForTest(config, ctx.test);
  const scan = await scanViewport(ctx, browser, effective, config);
  const raw: AccessibilityRawArtifact = {
    testName: ctx.test.name,
    experimentURL: ctx.experimentURL,
    effectiveConfig: {
      tags: effective.tags,
      disableRules: effective.disableRules,
      includeRules: effective.includeRules,
    },
    scans: [scan],
  };
  await ctx.artifacts.writeJson(ACCESSIBILITY_RAW_REPORT_FILENAME, raw);
  const rawArtifactHref = toPosixRelative(
    ctx.runtime.resultsRoot,
    path.join(ctx.artifacts.dir, ACCESSIBILITY_RAW_REPORT_FILENAME),
  );
  return projectAccessibilityRawArtifact(raw, {
    failOnViolation: config.failOnViolation,
    rawArtifactHref,
  });
}

async function scanViewport(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
): Promise<AccessibilityScan> {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      viewport: {
        width: ctx.viewport.width,
        height: ctx.viewport.height,
      },
      deviceScaleFactor: ctx.viewport.deviceScaleFactor,
      isMobile: ctx.viewport.formFactor === 'mobile',
      // Real-Chrome only: serve the phone layout (no-op headless).
      ...realChromeMobileEmulation(ctx.viewport.formFactor),
    });
    page = await context.newPage();
    if (config.engineOptions.waitTimeout) {
      page.setDefaultTimeout(config.engineOptions.waitTimeout);
      page.setDefaultNavigationTimeout(config.engineOptions.waitTimeout);
    }
    await preparePageForAccessibility(page, context, browser, ctx.test, ctx, config);

    let builder = new AxeBuilder({ page });
    if (effective.includeRules && effective.includeRules.length > 0) {
      builder = builder.withRules(effective.includeRules);
    } else {
      if (effective.tags.length > 0) builder = builder.withTags(effective.tags);
      if (effective.disableRules.length > 0) builder = builder.disableRules(effective.disableRules);
    }

    const results = await builder.analyze();
    const violations = results.violations.map(normalizeViolation);
    await attachNodeBounds(page, violations);
    const screenshot = await captureScanScreenshot(ctx, page);
    const probe = await page
      .evaluate(() => ({ title: document.title, html: document.documentElement.outerHTML.slice(0, 4000) }))
      .catch(() => ({ title: '', html: '' }));
    const blocked = scanLandedOnBotWall(probe, screenshot?.height, ctx.viewport.height);
    return {
      viewportLabel: ctx.viewport.label,
      viewport: ctx.viewport,
      url: results.url ?? ctx.experimentURL,
      screenshot,
      violations,
      blocked,
    };
  } catch (err) {
    const screenshot = page ? await captureFailureScreenshot(ctx, page) : undefined;
    if (screenshot) {
      throw new StageFailureError(err, { media: screenshot });
    }
    throw err;
  } finally {
    await context?.close().catch(() => {});
  }
}

async function captureScanScreenshot(ctx: TestContext, page: Page): Promise<AccessibilityScan['screenshot']> {
  const shot = await page.screenshot({
    type: 'png',
    fullPage: true,
    scale: 'css',
  });
  await ctx.artifacts.writeFile(ACCESSIBILITY_SCREENSHOT_FILENAME, shot);
  const meta = await sharp(shot).metadata();
  const width = meta.width ?? ctx.viewport.width;
  const height = meta.height ?? ctx.viewport.height;
  const imageHref = toPosixRelative(
    ctx.runtime.resultsRoot,
    path.join(ctx.artifacts.dir, ACCESSIBILITY_SCREENSHOT_FILENAME),
  );
  const scale = Math.min(1, 960 / Math.max(1, width));
  // The inline AVIF is best-effort: the violations and the on-disk PNG are
  // already captured, so a failed encode must degrade to a card without crop
  // frames - never sink the whole accessibility stage for the page.
  let imageDataUri: string | undefined;
  try {
    imageDataUri = await bufferToAvifDataUri(shot, 45, scale);
  } catch (err) {
    console.warn(
      `[shaka-perf a11y] inline screenshot encode failed (${width}x${height}px); ` +
        `card will render without crop frames: ${(err as Error).message}`,
    );
  }
  return {
    width,
    height,
    imageHref,
    imageDataUri,
  };
}

// Resolve every node's box in one in-page pass. The old per-node parallel
// locator.boundingBox() timed out under contention and returned no bounds.
async function attachNodeBounds(page: Page, violations: AccessibilityViolation[]): Promise<void> {
  const targets = violations.flatMap((violation) => violation.nodes.map((node) => node.target));
  if (targets.length === 0) return;
  let boxes: (AccessibilityNodeBounds | null)[];
  try {
    boxes = await page.evaluate((targetList): (AccessibilityNodeBounds | null)[] => {
      const sx = window.scrollX;
      const sy = window.scrollY;
      const r2 = (value: number): number => Math.round(value * 100) / 100;
      return targetList.map((target): AccessibilityNodeBounds | null => {
        // length > 1 = iframe descent; querySelector can't cross frames, so skip.
        if (!Array.isArray(target) || target.length !== 1) return null;
        const segment = target[0];
        // string[] segment = shadow-DOM path (pierce each open shadow root).
        const steps = typeof segment === 'string' ? [segment] : Array.isArray(segment) ? segment : [];
        let element: Element | null = null;
        let scope: Document | ShadowRoot = document;
        for (let i = 0; i < steps.length; i += 1) {
          const step = steps[i];
          if (!step) { element = null; break; }
          let found: Element | null = null;
          try { found = scope.querySelector(step); } catch { found = null; }
          if (!found) { element = null; break; }
          element = found;
          if (i < steps.length - 1) {
            // intermediate step must descend a shadow root; if none, bail (don't box a stale match).
            if (!found.shadowRoot) { element = null; break; }
            scope = found.shadowRoot;
          }
        }
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: r2(rect.x + sx), y: r2(rect.y + sy), width: r2(rect.width), height: r2(rect.height) };
      });
    }, targets);
  } catch {
    return; // page closed/detached mid-measure - leave nodes unbounded
  }
  let index = 0;
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const bounds = boxes[index];
      index += 1;
      if (bounds) node.bounds = bounds;
    }
  }
}

async function preparePageForAccessibility(
  page: Page,
  context: BrowserContext,
  browser: Browser,
  test: AbTestDefinition,
  ctx: TestContext,
  config: AccessibilityStageConfig,
): Promise<void> {
  const gotoOptions = accessibilityGotoOptions(config);

  await context.clearCookies();

  await runBeforeNavigateHooks(
    {
      context,
      page,
      url: ctx.experimentURL,
      viewport: ctx.viewport,
      isControl: false,
      testType: 'accessibility',
    },
    test.options.beforeNavigate,
  );
  await clearBrowserData(browser, ctx.experimentURL);

  await page.goto(ctx.experimentURL, gotoOptions);
  await waitForBotWallToClear(page);

  await runWithTestAnnotationContext(() => test.testFn({
    page,
    browserContext: context,
    isControl: false,
    scenario: test,
    viewport: ctx.viewport,
    testType: 'accessibility',
    annotate: createTestAnnotate(),
  }));
}

function accessibilityGotoOptions(config: AccessibilityStageConfig): PageGotoOptions {
  const candidate = config.engineOptions.gotoParameters;
  if (candidate && typeof candidate === 'object') {
    return candidate as PageGotoOptions;
  }
  return { waitUntil: 'networkidle' };
}

async function captureFailureScreenshot(ctx: TestContext, page: Page): Promise<string | undefined> {
  try {
    const filename = 'accessibility-failure-screenshot.png';
    const shot = await page.screenshot({ type: 'png', fullPage: true });
    await ctx.artifacts.writeFile(filename, shot);
    return ctx.artifacts.inlineDataUri(filename);
  } catch {
    return undefined;
  }
}
