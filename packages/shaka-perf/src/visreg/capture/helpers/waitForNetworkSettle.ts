import chalk from 'chalk';
import type { Page } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_PREFIX = '[waitForNetworkSettle]';

export interface WaitForNetworkSettleOptions {
  /** How long to wait for `networkidle` before giving up. Default 30 000 ms. */
  timeout?: number;
}

/**
 * Wait for playwright's `networkidle` load state (no network requests for
 * 500 ms). Throws on timeout so screenshots are not captured while network
 * activity is still ongoing.
 */
export async function waitForNetworkSettle(
  page: Page,
  { timeout = DEFAULT_TIMEOUT_MS }: WaitForNetworkSettleOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();
  try {
    await page.waitForLoadState('networkidle', { timeout });
    console.log(chalk.green(`${LOG_PREFIX} network idle for ${url} (${Date.now() - start} ms)`));
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
    }
    throw err;
  }
}
