import { abTest } from 'shaka-bench';

abTest('Click Shop Now on homepage', {
  startingPath: '/',
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="hero-section"]');
  await page.click('text=Shop Now');
  await page.waitForURL('**/products');
});
