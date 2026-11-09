/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { buildMeasurementSettings, type MeasurementSettingsModel } from '../../../pipeline/measurement-settings-model';
import { relatedStageOutcome, type StageReportContext } from '../../../pipeline/stage-report-model';
import type { StageRenderEntry } from '../../../stage/stage';
import type { PerfArtifact } from '../perf';

export interface PerfReportEntry extends StageRenderEntry<PerfArtifact> {
  readonly settings: MeasurementSettingsModel;
}

/** The performance stage owns which saved result explains its artifact count. */
export function buildPerfReportEntries(
  measurements: readonly StageRenderEntry<PerfArtifact>[],
  countStage: string,
  context: StageReportContext,
): PerfReportEntry[] {
  return measurements.map((entry) => {
    const countOutcome = relatedStageOutcome(entry, countStage, context);
    return {
      ...entry,
      settings: buildMeasurementSettings(
        entry.outcome ? [entry.outcome] : [],
        countOutcome ? [countOutcome] : [],
        entry.outcome?.runMetadata?.numberOfMeasurements,
      ),
    };
  });
}
