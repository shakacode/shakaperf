import type { Page } from 'playwright';

import { waitForAllImages } from './waitForAllImages';
import { waitForFontsReady } from './waitForFontsReady';
import { waitForNoMutations } from './waitForNoMutations';
import { waitForNetworkSettle } from './waitForNetworkSettle';

const LOG_PREFIX = '[waitUntilPageSettled]';

export interface WaitUntilPageSettledOptions {
  /** Per-helper outer timeout. Default 30 000 ms. */
  timeout?: number;
  /** `waitForNoMutations` debounce window. Default 700 ms. */
  quietMs?: number;
}

// Perf tests run this helper inside a page that Lighthouse may tear down
// mid-gather — treat those races as "settled or gone" rather than a failure.
function isPageClosedError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return /Target (?:page, context or browser has been )?closed|Execution context was destroyed|Protocol error .*: Target closed/i.test(msg);
}

/**
 * Umbrella "page is settled" wait — runs `waitForAllImages`,
 * `waitForFontsReady`, `waitForNoMutations`, and `waitForNetworkSettle`
 * in parallel. Each underlying helper swallows its own timeout, so this
 * one always resolves; composite outcome is summarised at the end.
 *
 * Prefer calling the individual helpers when only one of the four
 * matters to the test (e.g. a modal interaction that only needs images
 * ready, not DOM-quiet).
 */
export async function waitUntilPageSettled(
  page: Page,
  options: WaitUntilPageSettledOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();
  try {
    await Promise.all([
      waitForAllImages(page, options),
      waitForFontsReady(page, options),
      waitForNoMutations(page, options),
      waitForNetworkSettle(page, options),
    ]);
    console.log(`${LOG_PREFIX} all checks complete for ${url} (${Date.now() - start} ms)`);
  } catch (err) {
    if (isPageClosedError(err)) {
      console.log(`${LOG_PREFIX} ${url} closed during settle — treating as settled`);
      return;
    }
    throw err;
  }
}
