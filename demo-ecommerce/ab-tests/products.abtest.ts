import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Products List', {
  startingPath: '/products',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});

abTest('Products - Electronics Filter', {
  startingPath: '/products',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await page.waitForLoadState('networkidle');
  await page.click('[data-cy="category-select"]');
  await page.waitForSelector('[data-cy="category-option-electronics"]', { state: 'visible' });
  await page.click('[data-cy="category-option-electronics"]');
  await waitUntilPageSettled(page);
});
