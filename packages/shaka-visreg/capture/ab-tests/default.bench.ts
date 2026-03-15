import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

abTest('Homepage', {
  startingPath: '/',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.01,
    },
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
