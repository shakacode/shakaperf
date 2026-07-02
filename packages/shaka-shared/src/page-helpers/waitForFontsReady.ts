/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { Page } from 'playwright-core';

const DEFAULT_TIMEOUT_MS = 60_000;
const LOG_PREFIX = '[waitForFontsReady]';

export interface WaitForFontsReadyOptions {
  /** Outer timeout. Default 60 000 ms. */
  timeout?: number;
}

/**
 * Wait for `document.fonts.ready` — resolves once all pending font loads
 * have settled. Without this, visreg screenshots can race FOUT/layout-
 * shift and produce flaky pixel diffs. Throws on timeout so the run fails
 * before capturing known-unstable text rendering.
 */
export async function waitForFontsReady(
  page: Page,
  { timeout = DEFAULT_TIMEOUT_MS }: WaitForFontsReadyOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });

  try {
    const outcome = await Promise.race([
      page.evaluate(async () => {
        await document.fonts.ready;
      }).then(() => 'ready' as const),
      deadline,
    ]);

    if (outcome === 'ready') {
      console.log(
        chalk.green(`${LOG_PREFIX} fonts ready for ${url} (${Date.now() - start} ms)`),
      );
    } else {
      throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
    }
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new Error(`${LOG_PREFIX} timed out for ${url}: ${(err as Error).message}`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
