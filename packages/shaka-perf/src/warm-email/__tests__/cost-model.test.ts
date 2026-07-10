/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DEFAULT_MOBILE_TRAFFIC_SHARE } from '../cost-model';

describe('cost model constants', () => {
  it('exports the researched default values', () => {
    expect(DEFAULT_MOBILE_TRAFFIC_SHARE).toBe(0.52);
  });
});
