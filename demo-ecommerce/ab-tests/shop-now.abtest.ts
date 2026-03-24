import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Visits the homepage', {
  startingPath: '/',
}, async () => {
});


abTest('Click Shop Now on the homepage', {
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
