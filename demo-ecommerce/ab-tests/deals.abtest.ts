/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('deals List', {
  startingPath: '/deals',
}, async ({ page, annotate }) => {
  annotate('Wait for deals list to settle');
  await waitUntilPageSettled(page);
});
