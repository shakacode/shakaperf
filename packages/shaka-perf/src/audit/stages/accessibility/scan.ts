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
import type { AxeResults } from 'axe-core';
import sharp from 'sharp';
import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright-core';
import { setUpContextForNavigation } from '../../../pre-navigation';
import { bufferToAvifDataUri } from '../../../pipeline/artifact-compression';
import { toPosixRelative } from '../../../pipeline/path-utils';
import type { TestContext } from '../../../stage/stage';
import { runWithLastAnnotation } from '../../../test-annotation';
import { scanLandedOnBotWall } from '../../bot-wall';
import { applyRealChrome, realChromeContextOptions, waitForBotWallToClear } from '../../real-chrome';
import { normalizeViolation } from './artifacts';
import type { AccessibilityEffectiveConfig, AccessibilityStageConfig } from './config';
import type {
  AccessibilityNodeBounds,
  AccessibilityScreenshot,
  AccessibilityViolation,
} from './types';

type PageGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

interface AccessibilityFailureArtifacts {
  media?: string;
  screenshot?: AccessibilityScreenshot;
}

export class AccessibilityPageScanError extends Error {
  readonly artifacts: AccessibilityFailureArtifacts;

  constructor(
    readonly cause: unknown,
    artifacts: AccessibilityFailureArtifacts,
  ) {
    const message = cause instanceof Error
      ? cause.message
      : (typeof cause === 'string' ? cause : 'accessibility scan failed');
    super(message, { cause });
    this.name = 'AccessibilityPageScanError';
    this.artifacts = artifacts;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

export interface AccessibilityPageScanResult {
  url: string;
  screenshot: AccessibilityScreenshot;
  violations: AccessibilityViolation[];
  blocked: boolean;
  axeResults: AxeResults;
}

export interface AccessibilityPageScanOptions {
  url: string;
  isControl: boolean;
  screenshotFilename: string;
  inlineEncodeWarningPrefix: string;
  captureFailure?: (input: {
    page: Page;
  }) => Promise<AccessibilityFailureArtifacts>;
}

export async function launchAccessibilityBrowser(
  config: AccessibilityStageConfig,
  headed = false,
): Promise<Browser> {
  const engine = config.engineOptions.browser ?? 'chromium';
  const launchOptions: LaunchOptions = {
    headless: headed ? false : config.engineOptions.headless ?? true,
    args: config.engineOptions.args,
  };
  if (engine === 'firefox') return firefox.launch(launchOptions);
  if (engine === 'webkit') return webkit.launch(launchOptions);
  return chromium.launch(applyRealChrome(launchOptions));
}

export async function scanAccessibilityPage(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
  options: AccessibilityPageScanOptions,
): Promise<AccessibilityPageScanResult> {
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
      ...realChromeContextOptions(ctx.viewport.formFactor, browser.version?.()),
    });
    // Clear state and run the beforeNavigate hooks on the context BEFORE the page
    // is created, uniform with the other engines — context init scripts/routes
    // then cover the page's first navigation.
    await setUpContextForNavigation({
      context,
      url: options.url,
      viewport: ctx.viewport,
      isControl: options.isControl,
      testType: 'accessibility',
      beforeNavigate: ctx.test.options.beforeNavigate,
    });
    page = await context.newPage();
    if (config.engineOptions.waitTimeout) {
      page.setDefaultTimeout(config.engineOptions.waitTimeout);
      page.setDefaultNavigationTimeout(config.engineOptions.waitTimeout);
    }
    await navigateAccessibilityPage(page, context, ctx, config, options);

    let builder = new AxeBuilder({ page });
    if (effective.includeRules && effective.includeRules.length > 0) {
      builder = builder.withRules(effective.includeRules);
    } else {
      if (effective.tags.length > 0) builder = builder.withTags(effective.tags);
      if (effective.disableRules.length > 0) builder = builder.disableRules(effective.disableRules);
    }

    const axeResults = await builder.analyze();
    const violations = axeResults.violations.map(normalizeViolation);
    await attachNodeBounds(page, violations);
    const screenshot = await captureAccessibilityScreenshot(
      ctx,
      page,
      options.screenshotFilename,
      options.inlineEncodeWarningPrefix,
    );
    const probe = await page
      .evaluate(() => ({ title: document.title, html: document.documentElement.outerHTML.slice(0, 4000) }))
      .catch(() => ({ title: '', html: '' }));
    const blocked = scanLandedOnBotWall(probe, screenshot?.height, ctx.viewport.height);
    return {
      url: axeResults.url ?? options.url,
      screenshot,
      violations,
      blocked,
      axeResults,
    };
  } catch (err) {
    const artifacts = page && options.captureFailure
      ? await options.captureFailure({ page }).catch(() => ({}))
      : {};
    throw new AccessibilityPageScanError(err, artifacts);
  } finally {
    await context?.close().catch(() => {});
  }
}

export async function captureAccessibilityScreenshot(
  ctx: TestContext,
  page: Page,
  filename: string,
  warningPrefix: string,
): Promise<AccessibilityScreenshot> {
  const shot = await page.screenshot({
    type: 'png',
    fullPage: true,
    scale: 'css',
  });
  await ctx.artifacts.writeFile(filename, shot);
  const meta = await sharp(shot).metadata();
  const width = meta.width ?? ctx.viewport.width;
  const height = meta.height ?? ctx.viewport.height;
  const scale = Math.min(1, 960 / Math.max(1, width));
  let imageDataUri: string | undefined;
  try {
    imageDataUri = await bufferToAvifDataUri(shot, 45, scale);
  } catch (err) {
    console.warn(
      `${warningPrefix} inline screenshot encode failed (${width}x${height}px); ` +
        `card will render without crop frames: ${(err as Error).message}`,
    );
  }
  return {
    width,
    height,
    imageHref: relativeArtifactHref(ctx, filename),
    imageDataUri,
  };
}

export async function captureAccessibilityScreenshotIfPossible(
  ctx: TestContext,
  page: Page,
  filename: string,
  warningPrefix: string,
): Promise<AccessibilityScreenshot | undefined> {
  try {
    return await captureAccessibilityScreenshot(ctx, page, filename, warningPrefix);
  } catch {
    return undefined;
  }
}

export async function captureAccessibilityFailureMedia(
  ctx: TestContext,
  page: Page,
  filename: string,
): Promise<string | undefined> {
  try {
    const shot = await page.screenshot({ type: 'png', fullPage: true });
    await ctx.artifacts.writeFile(filename, shot);
    return ctx.artifacts.inlineDataUri(filename);
  } catch {
    return undefined;
  }
}

async function navigateAccessibilityPage(
  page: Page,
  context: BrowserContext,
  ctx: TestContext,
  config: AccessibilityStageConfig,
  options: AccessibilityPageScanOptions,
): Promise<void> {
  await page.goto(options.url, accessibilityGotoOptions(config));
  await waitForBotWallToClear(page);
  await runWithLastAnnotation((annotate) =>
    ctx.test.testFn({
      page,
      browserContext: context,
      isControl: options.isControl,
      scenario: ctx.test,
      viewport: ctx.viewport,
      testType: 'accessibility',
      annotate,
    }),
  );
}

function accessibilityGotoOptions(config: AccessibilityStageConfig): PageGotoOptions {
  const candidate = config.engineOptions.gotoParameters;
  if (candidate && typeof candidate === 'object') {
    return candidate as PageGotoOptions;
  }
  return { waitUntil: 'networkidle' };
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
            // Intermediate step must descend a shadow root; if none, bail.
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
    return;
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

function relativeArtifactHref(ctx: TestContext, filename: string): string {
  return toPosixRelative(ctx.runtime.resultsRoot, path.join(ctx.artifacts.dir, filename));
}
