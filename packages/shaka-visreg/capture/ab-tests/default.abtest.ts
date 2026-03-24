import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

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
