import { abTest } from 'shaka-bench';

abTest('Click Shop Now on homepage', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['[data-cy="features-section"]'],
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="hero-section"]');
  await page.click('text=Shop Now');
  await page.waitForURL('**/products');
});
