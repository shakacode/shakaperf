/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Homepage', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: [
        '[data-cy="hero-section"]',
        '[data-cy="features-section"]',
        'document',
      ],
      delay: 50,
      misMatchThreshold: 0.01,
    },
  },
}, async ({ page, annotate, testType }) => {
  annotate('Wait for homepage to settle');
  await waitUntilPageSettled(page);
});
