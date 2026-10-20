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
import { ScreenshotPreview } from '../../../pipeline/screenshot-preview';
import { CoverageMetricLabel } from './report-tooltip';
import type { CodeCoverageResult } from './stage';

const count = (value: number) => value.toLocaleString('en-US');

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
        {measurements.map((entry, index) => (
          <div key={`${entry.viewport.label}-${index}`} className="stage-stack__viewport coverage-preview">
            <div className="stage-section__head">{entry.viewport.label}</div>
            <CoveragePreview measurement={entry.measurement} />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function CoveragePreview({ measurement: m }: { measurement: CodeCoverageResult }) {
  const percent = m.totalStatements > 0
    ? Math.round((m.coveredStatements / m.totalStatements) * 100)
    : 0;
  return (
    <div className={`coverage-preview__layout${m.screenshotHref ? '' : ' coverage-preview__layout--no-image'}`}>
      {m.screenshotHref ? (
        <div className="coverage-preview__media">
          <DetailedArtifactDialog
            image
                    href={m.screenshotHref}
            label="page the visibility map describes"
            className="coverage-preview__button"
          >
            <ScreenshotPreview src={m.screenshotHref} alt="page the visibility map describes" />
            <span className="coverage-preview__image-label">View full screenshot ↗</span>
          </DetailedArtifactDialog>
        </div>
      ) : null}
      <div className="coverage-preview__metrics">
        <table className="coverage-preview__table" aria-label="Code coverage metrics">
          <tbody>
            <tr>
              <th scope="row">
                <CoverageMetricLabel
                  label="Statements executed"
                  explanation={`Of the ${count(m.totalStatements)} tracked statements in the source files loaded during this test, ${count(m.coveredStatements)} ran at least once.`}
                />
              </th>
              <td>
                {count(m.coveredStatements)}/{count(m.totalStatements)}{' '}
                <span className="coverage-preview__percent">{percent}%</span>
                <progress className="coverage-preview__progress" max={100} value={percent} aria-label="Statements executed">
                  {percent}%
                </progress>
              </td>
            </tr>
            <tr>
              <th scope="row">
                <CoverageMetricLabel
                  label="Instrumented files loaded"
                  explanation={`During this test, ${count(m.files)} source ${m.files === 1 ? 'file was' : 'files were'} loaded with counters that track which code instructions ran.`}
                />
              </th>
              <td>{count(m.files)}</td>
            </tr>
            {m.sourceAttribution ? (
              <tr>
                <th scope="row">Elements traced to a source line</th>
                <td>{count(m.sourceAttribution.located)}/{count(m.sourceAttribution.elements)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {m.sourceAttribution ? (
          <div className="coverage-preview__source">Source attribution · {m.sourceAttribution.plugin}</div>
        ) : null}
        {m.screenshotHref ? (
          <details className="coverage-preview__scope">
            <summary>What this screenshot covers</summary>
            <p>
              Whole page — the map scores each element against the capture regions in its header,
              so content outside them shows here but counts as 0% visible.
            </p>
          </details>
        ) : null}
        <FullReportOnly>
          <div className="artifact-links">
            {m.visibilityMapHref ? (
              <DetailedArtifactDialog href={m.visibilityMapHref} label="visibility-map.txt">
                visibility-map.txt
              </DetailedArtifactDialog>
            ) : null}
            {m.coverageHref ? (
              <DetailedArtifactDialog href={m.coverageHref} label="coverage.json">
                coverage.json
              </DetailedArtifactDialog>
            ) : null}
          </div>
        </FullReportOnly>
      </div>
    </div>
  );
}
