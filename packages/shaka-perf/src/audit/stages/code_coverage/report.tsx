/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { StageRenderEntry } from '../../../stage/stage';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import type { CodeCoverageResult } from './stage';

// Compact technical view: the per-test numbers, plus links to the raw istanbul
// map and the visibility map for the full report. The readable form of this
// data is the nyc HTML report the audit command generates from `.nyc_output/`,
// and the `shaka-perf-coverage` skill's per-line view, which reads the two
// artifacts side by side.
export function CodeCoverageArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<CodeCoverageResult>[];
}) {
  if (measurements.length === 0) return null;
  return (
    <StageArtifact>
      <StageArtifactTitle>code coverage</StageArtifactTitle>
      <div className="stage-stack">
        {measurements.map((entry, index) => {
          const m = entry.measurement;
          const percent = m.totalStatements > 0
            ? Math.round((m.coveredStatements / m.totalStatements) * 100)
            : 0;
          return (
            <div key={`${entry.viewport.label}-${index}`} className="stage-stack__viewport">
              <div className="stage-section__head">{entry.viewport.label}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                <li>
                  Statements executed: {m.coveredStatements}/{m.totalStatements} ({percent}%)
                </li>
                <li>Instrumented files loaded: {m.files}</li>
                {m.visibilityMapHref ? (
                  <FullReportOnly>
                    <li>
                      <DetailedArtifactDialog href={m.visibilityMapHref} label="visibility-map.txt">
                        visibility-map.txt
                      </DetailedArtifactDialog>
                    </li>
                  </FullReportOnly>
                ) : null}
                {m.coverageHref ? (
                  <FullReportOnly>
                    <li>
                      <DetailedArtifactDialog href={m.coverageHref} label="coverage.json">
                        coverage.json
                      </DetailedArtifactDialog>
                    </li>
                  </FullReportOnly>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </StageArtifact>
  );
}
