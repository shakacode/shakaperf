import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

abTest('Product Detail', {
  startingPath: '/products/1',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
