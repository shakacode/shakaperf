/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled, overrideCSS, interceptImages } from 'shaka-perf/visreg/helpers';

const CAROUSEL_PAUSE_CSS = `
  [data-cy="marketing-carousel-track"] {
    animation: none !important;
    transform: translateX(0) !important;
  }
`;

abTest('Carousel Demo - Without stubbing or overriding CSS', {
  startingPath: '/carousel-demo',
  testTypes: ['perf'],
  config: {
    // Per-test viewports are per-category — pin audit too, or it runs this
    // test at its own default (desktop + phone).
    perf: { viewports: ['phone'] },
    audit: { viewports: ['phone'] },
    // Plain page load — safe to scan for AI legibility (see homepage.abtest.ts).
    // The two carousel tests below hit this same URL but stub/override the page,
    // so they stay opted out.
    agentReadiness: { enabled: true },
  },
}, async () => {});


abTest('Carousel Demo - Pause With Override CSS', {
  startingPath: '/carousel-demo',
  testTypes: ['visreg'],
  config: {
    visreg: { viewports: ['desktop'] },
    audit: { viewports: ['desktop'] },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for carousel track to be visible');
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  annotate('Override default CSS');
  await overrideCSS(page);
  annotate('Inject CSS to pause carousel animation');
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  annotate('Wait for page to settle');
  await waitUntilPageSettled(page);
});

abTest('Carousel Demo - Stub Slider Images', {
  startingPath: '/carousel-demo',
  testTypes: ['visreg'],
}, async ({ page, annotate }) => {
  annotate('Intercept and stub slider images');
  await interceptImages(page);
  annotate('Reload page with image interception active');
  await page.goto(page.url());
  annotate('Wait for carousel track to be visible');
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  annotate('Override default CSS');
  await overrideCSS(page);
  annotate('Inject CSS to pause carousel animation');
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  annotate('Wait for page to settle');
  await waitUntilPageSettled(page);
});
