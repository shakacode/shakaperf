import type { Page } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_PREFIX = '[waitForFontsReady]';

export interface WaitForFontsReadyOptions {
  /** Outer timeout. Default 30 000 ms. */
  timeout?: number;
}

/**
 * Wait for `document.fonts.ready` — resolves once all pending font loads
 * have settled. Without this, visreg screenshots can race FOUT/layout-
 * shift and produce flaky pixel diffs. Swallows its own timeout with a
 * `[waitForFontsReady]` warn so the caller can keep going.
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
        `${LOG_PREFIX} fonts ready for ${url} (${Date.now() - start} ms)`,
      );
    } else {
      console.warn(
        `${LOG_PREFIX} timed out after ${timeout} ms for ${url} — continuing anyway`,
      );
    }
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      console.warn(
        `${LOG_PREFIX} timed out for ${url}: ${(err as Error).message} — continuing anyway`,
      );
      return;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
