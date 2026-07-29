/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Products List', {
  startingPath: '/products',
  testTypes: ['visreg'],
  config: {
    // Plain page load — safe to scan for AI legibility (see homepage.abtest.ts).
    // The Electronics Filter test below is deliberately NOT opted in: the scan
    // never runs the test body, so it would just re-score this same URL.
    agentReadiness: { enabled: true },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for products list to settle');
  await waitUntilPageSettled(page);
});

abTest('Products - Electronics Filter', {
  startingPath: '/products',
  testTypes: ['visreg'],
  config: {
    // Desktop-only in every pipeline: per-test viewports are per-category, so
    // `visreg` alone would leave audit running this test at desktop + phone.
    visreg: { viewports: ['desktop'] },
    audit: { viewports: ['desktop'] },
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
