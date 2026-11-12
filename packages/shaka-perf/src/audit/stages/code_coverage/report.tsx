/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { StageRenderEntry } from '../../../stage/stage';
import type { ExecutionDetails } from '../../../pipeline/outcome';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
  ReportHeading,
  OldRunChip,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import { ScreenshotPreview } from '../../../pipeline/screenshot-preview';
import { TooltipLabel } from '../../../pipeline/report-tooltip';
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
      <StageArtifactTitle title="code coverage" />
      <div className="stage-stack">
        {measurements.map((entry, index) => (
          <div key={`${entry.executionDetails.viewport.label}-${index}`} className="stage-stack__viewport coverage-preview">
            <ReportHeading className="stage-section__head" level={5} title={entry.executionDetails.viewport.label} badge={<OldRunChip latestRun={entry.latestRun} />} />
            <CoveragePreview measurement={entry.measurement} executionDetails={entry.executionDetails} />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function CoveragePreview({ measurement: m, executionDetails }: { measurement: CodeCoverageResult; executionDetails: ExecutionDetails }) {
  const percent = m.totalStatements > 0
    ? Math.round((m.coveredStatements / m.totalStatements) * 100)
    : 0;
  return (
    <div className={`coverage-preview__layout${m.screenshotHref ? '' : ' coverage-preview__layout--no-image'}`}>
      {m.screenshotHref ? (
        <div className="coverage-preview__media">
          <DetailedArtifactDialog
            executionDetails={executionDetails}
            title={`${executionDetails.viewport.label} code coverage screenshot`}
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
                <TooltipLabel
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
                <TooltipLabel
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
              <DetailedArtifactDialog
                executionDetails={executionDetails}
                href={m.visibilityMapHref}
                label="visibility-map.txt"
                title={`${executionDetails.viewport.label} visibility map`}
              >
                visibility-map.txt
              </DetailedArtifactDialog>
            ) : null}
            {m.coverageHref ? (
              <DetailedArtifactDialog
                executionDetails={executionDetails}
                href={m.coverageHref}
                label="coverage.json"
                title={`${executionDetails.viewport.label} code coverage`}
              >
                coverage.json
              </DetailedArtifactDialog>
            ) : null}
          </div>
        </FullReportOnly>
      </div>
    </div>
  );
}
