/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PlaywrightPage } from '../types';

const FAILURE_SCREENSHOT_PROPERTY = 'visregFailureScreenshot';

/**
 * Capture the failing visreg side and keep the screenshot on that side's
 * original error. The visreg stage runs in-process, so the PNG buffer can
 * travel with the error until the stage persists it in its ArtifactScope.
 */
export async function captureAndAttachVisregFailureScreenshot(
  err: unknown,
  page: PlaywrightPage,
): Promise<void> {
  if (!err || typeof err !== 'object') return;
  const screenshot = await page.screenshot({ fullPage: true });
  try {
    Object.defineProperty(err, FAILURE_SCREENSHOT_PROPERTY, {
      value: screenshot,
      configurable: true,
      writable: true,
    });
  } catch {
    // Never let diagnostic attachment replace the user's original failure.
  }
}

/** Read the screenshot attached to the original visreg failure. */
export function getAttachedVisregFailureScreenshot(
  err: unknown,
): Buffer | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const screenshot = (err as Record<string, unknown>)[FAILURE_SCREENSHOT_PROPERTY];
  return Buffer.isBuffer(screenshot) ? screenshot : undefined;
}
