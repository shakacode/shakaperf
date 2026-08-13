/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Locator } from 'playwright-core';

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_QUIET_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_PREFIX = '[waitForStableElementSize]';

export interface WaitForStableElementSizeOptions {
  /** Time between bounding-box samples. Default 100 ms. */
  pollIntervalMs?: number;
  /** How long width and height must remain unchanged. Default 500 ms. */
  quietMs?: number;
  /** Outer timeout before giving up. Default 30 000 ms. */
  timeout?: number;
}

interface ElementSize {
  height: number;
  width: number;
}

function sizesMatch(left: ElementSize, right: ElementSize): boolean {
  return left.height === right.height && left.width === right.width;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until a locator's rendered width and height remain unchanged for a
 * quiet window. A detached or non-rendered element resets the quiet window.
 */
export async function waitForStableElementSize(
  locator: Locator,
  {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    quietMs = DEFAULT_QUIET_MS,
    timeout = DEFAULT_TIMEOUT_MS,
  }: WaitForStableElementSizeOptions = {},
): Promise<void> {
  const startedAt = Date.now();
  let stableSize: ElementSize | undefined;
  let stableSince: number | undefined;

  while (Date.now() - startedAt < timeout) {
    const box = await locator.boundingBox();
    const sampledAt = Date.now();

    if (!box) {
      stableSize = undefined;
      stableSince = undefined;
    } else {
      const size = { height: box.height, width: box.width };
      if (stableSize && stableSince !== undefined && sizesMatch(stableSize, size)) {
        if (sampledAt - stableSince >= quietMs) return;
      } else {
        stableSize = size;
        stableSince = sampledAt;
      }
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `${LOG_PREFIX} ${locator} did not remain the same size for ${quietMs} ms ` +
      `within ${timeout} ms.`,
  );
}
