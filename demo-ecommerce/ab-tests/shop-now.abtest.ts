/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Click Shop Now on the homepage', {
  startingPath: '/',
  config: {
    visreg: { viewports: ['phone'], maxNumDiffPixels: 5 },
    perf: { viewports: ['phone'] },
    audit: { viewports: ['phone'] },
    accessibility: { viewports: ['phone'] },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for hero section to load');
  await page.waitForSelector('[data-cy="hero-section"]');
  annotate('Click Shop Now button');
  await page.click('text=Shop Now');
  annotate('Wait for navigation to products page');
  await page.waitForURL('**/products');
  await waitUntilPageSettled(page);
});
