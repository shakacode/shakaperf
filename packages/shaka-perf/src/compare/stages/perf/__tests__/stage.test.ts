/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { PerfEngineStage } from '../stage';
import type { PerfArtifact } from '../../perf';

describe('PerfEngineStage self-contained report stripping', () => {
  it('keeps the preview and removes local detail artifacts', () => {
    const stage = new PerfEngineStage<PerfArtifact>({
      name: 'perf',
      label: 'Perf',
      description: 'Perf',
      artifactTitle: 'Perf',
      config: {} as never,
      machineReadableSummary: () => ({}),
    });
    expect(stage.selfContainedReportStrip).toEqual({
      controlLighthouseHref: true,
      experimentLighthouseHref: true,
      timelineHref: true,
      benchReportHref: true,
      diffHrefs: true,
    });
  });
});
