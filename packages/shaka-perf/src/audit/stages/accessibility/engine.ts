/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Browser } from 'playwright-core';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import { StageFailureError } from '../../../stage/stage-failure';
import {
  type AccessibilityEffectiveConfig,
  type AccessibilityStageConfig,
} from './config';
import {
  ACCESSIBILITY_RAW_REPORT_FILENAME,
  ACCESSIBILITY_SCREENSHOT_FILENAME,
  projectAccessibilityRawArtifact,
} from './artifacts';
import {
  AccessibilityPageScanError,
  captureAccessibilityFailureMedia,
  launchAccessibilityBrowser,
  scanAccessibilityPage,
} from './scan';
import type {
  AccessibilityRawArtifact,
  AccessibilityResult,
  AccessibilityScan,
} from './types';

interface AccessibilitySlotState extends PoolWorkerState {
  accessibilityBrowser?: Browser;
}

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
      slot.accessibilityBrowser = await launchAccessibilityBrowser(config, ctx.runtime.headed);
    }
    return scanAccessibility(ctx, slot.accessibilityBrowser, config);
  }, { key: ctx.testAndViewportId });
}

async function scanAccessibility(
  ctx: TestContext,
  browser: Browser,
  config: AccessibilityStageConfig,
): Promise<AccessibilityResult> {
  const acc = ctx.config.accessibility;
  const effective = { tags: acc.tags, disableRules: acc.disableRules, includeRules: acc.includeRules ?? null };
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
  const rawArtifactHref = await ctx.artifacts.writeJson(
    ACCESSIBILITY_RAW_REPORT_FILENAME,
    raw,
  );
  return projectAccessibilityRawArtifact(raw, {
    // Per-test effective, like tags/disableRules/includeRules above.
    failOnViolation: acc.failOnViolation,
    rawArtifactHref,
  });
}

async function scanViewport(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
): Promise<AccessibilityScan> {
  try {
    const result = await scanAccessibilityPage(ctx, browser, effective, config, {
      url: ctx.experimentURL,
      isControl: false,
      screenshotFilename: ACCESSIBILITY_SCREENSHOT_FILENAME,
      captureFailure: async ({ page }) => ({
        media: await captureAccessibilityFailureMedia(ctx, page, 'accessibility-failure-screenshot.png'),
      }),
    });
    return {
      viewportLabel: ctx.viewport.label,
      viewport: ctx.viewport,
      url: result.url,
      screenshot: result.screenshot,
      violations: result.violations,
      blocked: result.blocked,
    };
  } catch (err) {
    if (err instanceof AccessibilityPageScanError) {
      if (err.artifacts.media) {
        throw new StageFailureError(err.cause, { media: err.artifacts.media });
      }
      throw err.cause;
    }
    throw err;
  }
}
