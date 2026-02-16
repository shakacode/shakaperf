import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from '../types';
import clickAndHoverHelper from './clickAndHoverHelper';

const PAGE_SETTLE_CHECKING_INTERVAL_MS = 700;
const PAGE_SETTLE_TIMEOUT_MS = 30000;
const SKELETON_SELECTOR = '';
const SPINNER_SELECTOR = '';

/**
 * Wait until the page has settled - DOM mutations stopped, network idle, fonts loaded, images rendered.
 * Adapted from helper.ts waitUntilPageSettled for BackstopJS context.
 */
export async function waitUntilPageSettled(page: Page): Promise<void> {
  const url = page.url();

  // Wait for DOM mutations to stop (debounced) and loading indicators to disappear
  const mutationsStopped = page.evaluate(([checkingInterval]) => {
    type PromiseResolver = (value: unknown) => void;

    const debounce = (func: PromiseResolver, delay: number) => {
      let timerId: number | undefined;
      return () => {
        const later = () => {
          timerId = undefined;
          func(undefined);
        };
        clearTimeout(timerId);
        timerId = setTimeout(later, delay) as unknown as number;
      };
    };

    /**
     * Count visible loading indicators (skeletons and spinners) on the page.
     * Used to detect if the page is still loading content.
     *
     * Checks for:
     * - SKELETON_SELECTOR components example: (.MuiSkeleton-root)
     * - SPINNER_SELECTOR components example: (.pm-loading-wrap)
     *
     * @returns Object with skeletonCount and spinnerCount, both are optional and will be 0 if not set
     */
    const countLoadingIndicators = () => {
      const countDisplayedElements = (selector: string) => {
        const elements = document.querySelectorAll(selector);
        let count = 0;
        elements.forEach((element) => {
          if (element instanceof HTMLElement && element.offsetParent !== null) {
            count += 1;
          }
        });
        return count;
      };

      const skeletonCount = SKELETON_SELECTOR ? countDisplayedElements(SKELETON_SELECTOR) : 0;
      const spinnerCount =
        SPINNER_SELECTOR ? countDisplayedElements(SPINNER_SELECTOR) : 0;

      return { skeletonCount, spinnerCount };
    };

    let onPageActivity: PromiseResolver = () => {};
    const pageSettledPromise = new Promise((resolve) => {
      onPageActivity = debounce(resolve, checkingInterval);
    });

    const observer = new MutationObserver((mutations) => {
      const hasUsefulMutations = mutations.some(
        (mutation) =>
          !((mutation.target as HTMLElement).tagName === 'BODY' && mutation.type === 'attributes')
      );
      if (hasUsefulMutations) {
        console.log('Page is not settled: document body has mutated.');
        onPageActivity(undefined);
      }
    });
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    // Poll for loading indicators at half the debounce interval
    const intervalId = setInterval(() => {
      const { skeletonCount, spinnerCount } = countLoadingIndicators();

      if (skeletonCount > 0 || spinnerCount > 0) {
        console.log(
          `Page is not settled: ${skeletonCount} skeletons, ${spinnerCount} spinners remaining.`
        );
        onPageActivity(undefined);
      }
    }, checkingInterval / 2);

    onPageActivity(undefined);
    return pageSettledPromise.then(() => {
      observer.disconnect();
      clearInterval(intervalId);
    });
  }, [PAGE_SETTLE_CHECKING_INTERVAL_MS] as const);

  // Wait for fonts to be ready
  const fontsReady = page
    .evaluate(async () => {
      await document.fonts.ready;
    })
    .then(() => console.log(`Fonts for ${url} are ready`));

  // Wait for all images to be rendered (not just downloaded)
  const imagesLoaded = page
    .evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve());
            img.addEventListener('error', () => resolve());
          });
        })
      );
      return images.length;
    })
    .then((count) => console.log(`All ${count} images loaded for ${url}`));

  // Wait for network to be idle
  const networkIdle = page
    .waitForLoadState('networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS })
    .then(() => console.log('Network idle'))
    .catch(() => console.warn('Network idle timeout - continuing anyway'));

  // Race all conditions against a timeout
  const pageSettled = Promise.all([networkIdle, fontsReady, imagesLoaded, mutationsStopped]).then(() => {
    console.log(`Page ${url} has settled`);
    return true;
  });

  const timeout = new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log(`Page settle timeout after ${PAGE_SETTLE_TIMEOUT_MS}ms - continuing anyway`);
      resolve(false);
    }, PAGE_SETTLE_TIMEOUT_MS);
    pageSettled.then(
      () => {
        clearTimeout(timeoutId);
        resolve(true);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(false);
      }
    );
  });

  await Promise.race([pageSettled, timeout]);
}

async function onReady(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);

  // Wait for page to settle before interactions
  await waitUntilPageSettled(page);

  // Perform click/hover interactions
  await clickAndHoverHelper(page, scenario);

  // Optional: Wait again after interactions for any triggered animations/requests
  // await waitUntilPageSettled(page);
}

export default onReady;
module.exports = onReady;
module.exports.waitUntilPageSettled = waitUntilPageSettled;
