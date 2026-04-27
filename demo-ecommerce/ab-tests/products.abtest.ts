import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Products List', {
  startingPath: '/products',
  testTypes: ['visreg'],
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for products list to settle');
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
}, async ({ page, annotate }) => {
  annotate('Wait for products page to load');
  await page.waitForLoadState('networkidle');
  annotate('Open category dropdown');
  await page.click('[data-cy="category-select"]');
  annotate('Wait for electronics option to appear');
  await page.waitForSelector('[data-cy="category-option-electronics"]', { state: 'visible' });
  annotate('Select electronics category filter');
  await page.click('[data-cy="category-option-electronics"]');
  annotate('Wait for filtered results to settle');
  await waitUntilPageSettled(page);
});
