import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

abTest('Click Shop Now on homepage', {
  startingPath: '/',
  options: {
    visreg: {
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page, testType }) => {
  await page.waitForSelector('[data-cy="hero-section"]');
  await page.click('text=Shop Now');
  await page.waitForURL('**/products');
  if (testType === TestType.VisualRegression) {
    await waitUntilPageSettled(page);
  }
});
