import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Click Shop Now on the homepage', {
  startingPath: '/',
  testTypes: [TestType.Performance],
  options: {
    visreg: {
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page, testType, annotate }) => {
  annotate('Wait for hero section to load');
  await page.waitForSelector('[data-cy="hero-section"]');
  annotate('Click Shop Now button');
  await page.click('text=Shop Now');
  annotate('Wait for navigation to products page');
  await page.waitForURL('**/products');
});
