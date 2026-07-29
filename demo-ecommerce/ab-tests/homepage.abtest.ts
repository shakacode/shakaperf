/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Homepage', {
  startingPath: '/',
  visregSelectors: [
    '[data-cy="hero-section"]',
    '[data-cy="features-section"]',
    'document',
  ],
  config: {
    visreg: { mismatchThreshold: 0.01 },
    // The AI-legibility scan measures `startingPath` cold, as an anonymous
    // crawler — so it is opted in only on tests that just load a page.
    agentReadiness: { enabled: true },
  },
}, async ({ page, annotate, testType }) => {
  annotate('Wait for homepage to settle');
  await waitUntilPageSettled(page);
});
