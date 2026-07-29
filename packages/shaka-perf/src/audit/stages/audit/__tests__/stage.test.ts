/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AuditStage } from '../stage';

describe('AuditStage self-contained report stripping', () => {
  it('removes Lighthouse artifacts', () => {
    expect(new AuditStage({}).selfContainedReportStrip).toEqual({
      lighthouseHref: true,
      lighthouseThumbHref: true,
      coverageStatementIdsHref: true,
    });
  });
});
