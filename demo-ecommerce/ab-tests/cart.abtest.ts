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

abTest('Cart', {
  startingPath: '/cart',
  testTypes: ['visreg'],
}, async ({ page, annotate }) => {
  annotate('Wait for cart page to settle');
  await waitUntilPageSettled(page);
});
