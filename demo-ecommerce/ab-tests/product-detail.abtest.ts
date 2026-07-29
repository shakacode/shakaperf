/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Product Detail', {
  startingPath: '/products/1',
  config: {
    // Plain page load — safe to scan for AI legibility (see homepage.abtest.ts).
    // The interaction tests on this same URL below stay opted out.
    agentReadiness: { enabled: true },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for product detail page to settle');
  await waitUntilPageSettled(page);
});

abTest('Product Detail - Desktop Actions', {
  startingPath: '/products/1',
  testTypes: ['visreg'],
  visregSelectors: ['[data-cy="product-actions-desktop"]'],
  config: {
    // Per-test viewports are per-category — pin audit too, or it runs this
    // test at its own default (desktop + phone).
    visreg: { viewports: ['tablet', 'desktop'], mismatchThreshold: 0.01 },
    audit: { viewports: ['tablet', 'desktop'] },
  },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="product-actions-desktop"]');
  await waitUntilPageSettled(page);
});


abTest('Product Detail - Show Product Journey Toggle', {
  startingPath: '/products/1',
  testTypes: ['visreg'],
  config: {
    visreg: { viewports: ['phone'] },
    audit: { viewports: ['phone'] },
    accessibility: { disableRules: ['color-contrast', 'aria-progressbar-name'] },
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
  testTypes: ['visreg'],
  config: {
    visreg: { viewports: ['desktop'], maxNumDiffPixels: 5 },
    audit: { viewports: ['desktop'] },
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
  testTypes: ['visreg'],
  config: {
    visreg: { viewports: ['desktop'], maxNumDiffPixels: 5 },
    audit: { viewports: ['desktop'] },
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
