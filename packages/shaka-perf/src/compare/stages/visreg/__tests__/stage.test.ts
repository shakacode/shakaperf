/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createVisregStage } from '../../visreg';

describe('visreg self-contained artifact dictionary', () => {
  it('does not strip any rendered image fields', () => {
    const stage = createVisregStage({} as never);
    expect(stage.selfContainedReportStrip).toEqual({});
  });
});
