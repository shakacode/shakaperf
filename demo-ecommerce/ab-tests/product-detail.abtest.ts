import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Product Detail', {
  startingPath: '/products/1',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for product detail page to settle');
  await waitUntilPageSettled(page);
});

abTest('Product Detail - Desktop Actions', {
  startingPath: '/products/1',
  testTypes: ['visreg'],
  options: {
    visreg: {
      selectors: ['[data-cy="product-actions-desktop"]'],
      viewports: [
        { label: 'tablet', width: 768, height: 1024 },
        { label: 'desktop', width: 1280, height: 800 },
      ],
      delay: 50,
      misMatchThreshold: 0.01,
    },
  },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="product-actions-desktop"]');
  await waitUntilPageSettled(page);
});


abTest('Product Detail - Show Product Journey Toggle', {
  startingPath: '/products/1',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  // Scroll to bottom to reveal the toggle, then enable it
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForSelector('input[role="switch"]');
  await page.locator('input[role="switch"]').click();
  await waitUntilPageSettled(page);
});

abTest('Click Reviews on Product Detail', {
  startingPath: '/products/1',
  options: {
    visreg: {
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page, viewport }) => {
  if (viewport.label === 'mobile') {
    // TODO: visreg should fail if we comment out this if
    // if says no diff
    await page.waitForSelector('[data-cy="product-actions-mobile"]');
    await page.click('[data-cy="product-actions-mobile"] >> text=Reviews');
  } else {
    await page.waitForSelector('[data-cy="product-actions-desktop"]');
    await page.click('[data-cy="product-actions-desktop"] >> text=Reviews');
  }
  await page.waitForURL('**/products/1/reviews');
  await waitUntilPageSettled(page);
});

abTest('Product Details => Click on Reviews => Click on Deals', {
  startingPath: '/products/1',
  options: {
    visreg: {
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page, viewport  }) => {
  if (viewport.label === 'mobile') {
    // TODO: visreg should fail if we comment out this if
    // if says no diff
    await page.waitForSelector('[data-cy="product-actions-mobile"]');
    await page.click('[data-cy="product-actions-mobile"] >> text=Reviews');
  } else {
    await page.waitForSelector('[data-cy="product-actions-desktop"]');
    await page.click('[data-cy="product-actions-desktop"] >> text=Reviews');
  }
  await page.waitForURL('**/products/1/reviews');
  // Click the "View Deals" button using both data-discover and text for disambiguation
  await page.locator('a[data-discover="true"]', { hasText: 'View Deals' }).click();
  await waitUntilPageSettled(page);
});
