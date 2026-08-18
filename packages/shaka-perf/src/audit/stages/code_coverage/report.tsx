/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import type { CodeCoverageResult } from './stage';

// Compact technical view: one shot of the page the visibility map describes,
// the per-test numbers, plus links to the raw istanbul map and the map itself
// for the full report. The readable form of this
// data is the nyc HTML report the audit command generates from `.nyc_output/`,
// and the `shaka-perf-coverage` skill's per-line view, which reads the two
// artifacts side by side.
// Capped so a long page renders as a legible strip in the card rather than
// pushing the numbers off screen; the dialog shows it at full size.
const SCREENSHOT_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  maxHeight: 220,
  objectFit: 'cover',
  objectPosition: 'top',
};

const SCREENSHOT_CAPTION_STYLE: CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  margin: '4px 0 8px',
};

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
              {m.screenshotHref ? (
                <>
                  <DetailedArtifactDialog
                    href={m.screenshotHref}
                    label="page the visibility map describes"
                    variant="preview"
                  >
                    <img src={m.screenshotHref} alt="" style={SCREENSHOT_STYLE} />
                  </DetailedArtifactDialog>
                  {/* Without this the two artifacts read as contradicting each
                      other: the shot is the WHOLE page, while the map scores
                      against the capture regions in its own header, so anything
                      outside them is legitimately "0% visible" here. */}
                  <div style={SCREENSHOT_CAPTION_STYLE}>
                    whole page — the map scores each element against the capture regions in
                    its header, so content outside them shows here but counts as 0% visible
                  </div>
                </>
              ) : null}
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
