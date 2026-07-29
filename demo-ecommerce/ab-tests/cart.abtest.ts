/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Cart', {
  startingPath: '/cart',
  testTypes: ['visreg'],
  config: {
    // Plain page load — safe to scan for AI legibility (see homepage.abtest.ts).
    agentReadiness: { enabled: true },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for cart page to settle');
  await waitUntilPageSettled(page);
});
