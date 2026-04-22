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
   * Hidden images — modal previews, lazy-loaded `loading="lazy"` below-the-
   * fold assets, preloads — often never fire `load` because the browser
   * elides the fetch when they're not in viewport. They also can't appear
   * in a screenshot, so waiting on them is pointless. Set `false` if your
   * test needs to be sure *every* image in the DOM has completed.
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
 * Wait for every visible `<img>` currently in the DOM to finish loading
 * (fire `load` or `error`, or already be `complete`). Resolves even if
 * the outer timeout fires. On timeout we re-enter the page to enumerate
 * exactly which images are still pending — so the log points at the
 * actual offender(s) rather than just "timeout".
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
    const images = Array.from(document.querySelectorAll('img')).filter((img) =>
      visibleOnly ? isVisible(img) : true,
    );
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
        `${LOG_PREFIX} ${outcome.count} ${scope} loaded for ${url} (${Date.now() - start} ms)`,
      );
      return;
    }

    // Timeout path — enumerate still-pending images so the log points at
    // the actual offender.
    const pending = await page
      .evaluate<ImageInfo[], boolean>((visibleOnly) => {
        const isVisible = (img: HTMLImageElement): boolean => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && img.offsetParent !== null;
        };
        return Array.from(document.querySelectorAll('img'))
          .filter((img) => (visibleOnly ? isVisible(img) : true))
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
      .catch(() => [] as ImageInfo[]);

    const scope = onlyVisible ? 'visible image(s)' : 'image(s)';
    console.warn(
      `${LOG_PREFIX} timed out after ${timeout} ms for ${url} — ${pending.length} ${scope} still pending. Continuing anyway.`,
    );
    for (const img of pending.slice(0, 10)) {
      const visibility = img.visible ? 'visible' : 'hidden';
      const position = `${img.rect.x},${img.rect.y} ${img.rect.w}x${img.rect.h}`;
      const resolved =
        img.currentSrc && img.currentSrc !== img.src ? ` (currentSrc=${img.currentSrc})` : '';
      console.warn(
        `${LOG_PREFIX}   pending ${visibility} @ ${position}: ${img.src}${resolved}`,
      );
    }
    if (pending.length > 10) {
      console.warn(`${LOG_PREFIX}   …and ${pending.length - 10} more`);
    }
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} failed for ${url}: ${(err as Error).message} — continuing anyway`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
