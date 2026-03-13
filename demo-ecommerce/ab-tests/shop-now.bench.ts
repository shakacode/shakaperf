import { abTest } from 'shaka-bench';

abTest('Visits the homepage', {
  startingPath: '/',
}, async ({ page }) => {
});


abTest('Click Shop Now on the homepage', {
  startingPath: '/',
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="hero-section"]');
  await page.click('text=Shop Now');
  await page.waitForURL('**/products');
});
