import type { Page } from 'playwright-core';

/**
 * Injects a PerformanceObserver into the page that tracks INP (Interaction to Next Paint).
 * Must be called before user interactions occur.
 */
export async function injectINPObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const interactions = new Map<number, number>();

    (window as any).__shaka_inp = 0;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as any;
        if (e.interactionId) {
          const existing = interactions.get(e.interactionId) || 0;
          interactions.set(e.interactionId, Math.max(existing, e.duration));
        }
      }

      let worst = 0;
      for (const duration of interactions.values()) {
        if (duration > worst) {
          worst = duration;
        }
      }
      (window as any).__shaka_inp = worst;
    });

    observer.observe({ type: 'event', buffered: true, durationThreshold: 0 } as any);
  });
}

/**
 * Collects the INP value from the page after interactions have occurred.
 * Returns the INP duration in milliseconds, or null if no interactions were observed.
 */
export async function collectINP(page: Page): Promise<number | null> {
  // Give the browser time to process and report event timing entries
  await page.waitForTimeout(100);

  const inp = await page.evaluate(() => {
    return (window as any).__shaka_inp as number;
  });

  return inp > 0 ? inp : null;
}
