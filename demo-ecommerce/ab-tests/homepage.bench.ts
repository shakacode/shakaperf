import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

abTest('Homepage', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: [
        '[data-cy="hero-section"]',
        '[data-cy="features-section"]',
        'document',
      ],
      delay: 50,
      misMatchThreshold: 0.01,
    },
  },
}, async ({ page }) => {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 100));
    window.scrollTo(0, 0);
  });
  await waitUntilPageSettled(page);
});
