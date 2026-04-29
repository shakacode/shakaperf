import chalk from 'chalk';
import type { Page } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_PREFIX = '[waitForAllImages]';

export interface WaitForAllImagesOptions {
  /** Outer timeout. Default 30 000 ms. */
  timeout?: number;
  /**
   * Only wait for `<img>` elements that are currently visible (non-zero
   * bounding box and an `offsetParent`). Default `true`.
   *
   * Hidden images — modal previews, preloads — often never fire `load`.
   * Set `false` if your test needs hidden non-lazy images to complete too.
   *
   * Offscreen `loading="lazy"` images are always skipped, because without
   * scrolling the browser may never fetch them before the outer timeout.
   */
  onlyVisible?: boolean;
}

interface ImageInfo {
  src: string;
  currentSrc: string;
  visible: boolean;
  complete: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Wait for matching `<img>` elements currently in the DOM to finish loading
 * (fire `load` or `error`, or already be `complete`). Offscreen lazy-loaded
 * images are excluded because they may not fetch without scrolling.
 *
 * On timeout we re-enter the page to enumerate pending images, log the
 * offenders, and throw an error with a compact sample.
 */
export async function waitForAllImages(
  page: Page,
  {
    timeout = DEFAULT_TIMEOUT_MS,
    onlyVisible = true,
  }: WaitForAllImagesOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();

  const allLoaded = page.evaluate(async (visibleOnly: boolean) => {
    const isVisible = (img: HTMLImageElement): boolean => {
      const rect = img.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && img.offsetParent !== null;
    };
    // Lazy images outside the viewport will never fetch until the browser's
    // IntersectionObserver triggers — and it won't, because the test isn't
    // scrolling. Don't wait on them; they'd just burn the outer timeout.
    const isLazyOffscreen = (img: HTMLImageElement): boolean => {
      if (img.loading !== 'lazy') return false;
      const rect = img.getBoundingClientRect();
      return (
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= window.innerWidth ||
        rect.top >= window.innerHeight
      );
    };
    const images = Array.from(document.querySelectorAll('img'))
      .filter((img) => (visibleOnly ? isVisible(img) : true))
      .filter((img) => !isLazyOffscreen(img));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve());
          img.addEventListener('error', () => resolve());
        });
      }),
    );
    return images.length;
  }, onlyVisible);

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });

  try {
    const outcome = await Promise.race([
      allLoaded.then((count) => ({ count })),
      deadline,
    ]);

    if (outcome !== 'timeout') {
      const scope = onlyVisible ? 'visible images' : 'images';
      console.log(
        chalk.green(`${LOG_PREFIX} ${outcome.count} ${scope} loaded for ${url} (${Date.now() - start} ms)`),
      );
      return;
    }

    const pending = await page
      .evaluate<ImageInfo[], boolean>((visibleOnly) => {
        const isVisible = (img: HTMLImageElement): boolean => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && img.offsetParent !== null;
        };
        const isLazyOffscreen = (img: HTMLImageElement): boolean => {
          if (img.loading !== 'lazy') return false;
          const rect = img.getBoundingClientRect();
          return (
            rect.right <= 0 ||
            rect.bottom <= 0 ||
            rect.left >= window.innerWidth ||
            rect.top >= window.innerHeight
          );
        };
        return Array.from(document.querySelectorAll('img'))
          .filter((img) => (visibleOnly ? isVisible(img) : true))
          .filter((img) => !isLazyOffscreen(img))
          .filter((img) => !img.complete)
          .map((img): ImageInfo => {
            const rect = img.getBoundingClientRect();
            return {
              src: img.src,
              currentSrc: img.currentSrc,
              visible: isVisible(img),
              complete: img.complete,
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
            };
          });
      }, onlyVisible)
      .catch((err: Error) => {
        console.warn(
          chalk.yellow(`${LOG_PREFIX} could not enumerate pending images: ${err.message}`),
        );
        return [] as ImageInfo[];
      });

    const scope = onlyVisible ? 'visible image(s)' : 'image(s)';
    console.warn(
      chalk.yellow(`${LOG_PREFIX} timed out after ${timeout} ms for ${url} — ${pending.length} ${scope} still pending.`),
    );
    for (const img of pending.slice(0, 10)) {
      const visibility = img.visible ? 'visible' : 'hidden';
      const position = `${img.rect.x},${img.rect.y} ${img.rect.w}x${img.rect.h}`;
      const resolved =
        img.currentSrc && img.currentSrc !== img.src ? ` (currentSrc=${img.currentSrc})` : '';
      console.warn(
        chalk.yellow(`${LOG_PREFIX}   pending ${visibility} @ ${position}: ${img.src}${resolved}`),
      );
    }
    if (pending.length > 10) {
      console.warn(chalk.yellow(`${LOG_PREFIX}   …and ${pending.length - 10} more`));
    }
    const sample = pending
      .slice(0, 3)
      .map((img) => `${img.rect.x},${img.rect.y} ${img.rect.w}x${img.rect.h} ${img.src}`)
      .join('; ');
    const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : '';
    throw new Error(
      `${LOG_PREFIX} timed out after ${timeout} ms for ${url} — ${pending.length} ${scope} still pending: ${sample}${more}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
