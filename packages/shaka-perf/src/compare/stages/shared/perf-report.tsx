/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useState } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import type { ExecutionDetails } from '../../../pipeline/outcome';
import type { PerfArtifact, PerfMetric, PerfMetricGroup } from '../perf';
import {
  DetailedArtifactDialog,
  ArtifactMetadataFields,
  StageArtifact,
  StageArtifactTitle,
  ReportHeading,
  OldRunChip,
  StageNote,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import { performanceMetadataFields } from '../perf/metadata-fields';
import { FramePlayerButton } from './frame-player';
import { ReportSection, useReportSection, useReportSectionExpanded } from '../../../pipeline/report-section';

const GROUPS: PerfMetricGroup[] = ['vitals', 'diagnostics'];

// Switch to exponential below 1e-6 — at that point a decimal would need
// more than 5 leading zeros and the magnitude is easier to read in mantissa
// form. Trim trailing zeros so typical values stay compact (0.5, not 0.500000).
export function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return String(p);
  if (p === 0) return '0';
  if (Math.abs(p) < 1e-6) return p.toExponential(1);
  return p.toFixed(6).replace(/\.?0+$/, '');
}

export function PerfArtifactView({
  measurements,
  title,
}: {
  measurements: readonly StageRenderEntry<PerfArtifact>[];
  title: string;
}) {
  const perfs = measurements
    .map((entry) => ({
      perf: entry.measurement,
      viewportLabel: entry.executionDetails.viewport.label,
      latestRun: entry.latestRun,
      executionDetails: entry.executionDetails,
    }))
    .filter(({ perf }) => hasRenderableData(perf));
  if (perfs.length === 0) return null;
  const rows = perfs.filter(({ perf }) => (
    significantMetrics(perf).length > 0 ||
    hasAttachments(perf) ||
    hasNoDifferenceMetrics(perf)
  ));

  return (
    <StageArtifact>
      <StageArtifactTitle verbatim title={title} />
      <div className="stage-stack">
        {rows.map((row, index) => (
          <PerfViewportBlock
            key={`${row.viewportLabel}-${index}`}
            perf={row.perf}
            viewportLabel={row.viewportLabel}
            latestRun={row.latestRun}
            executionDetails={row.executionDetails}
          />
        ))}
      </div>
    </StageArtifact>
  );
}

function PerfViewportBlock({ perf, viewportLabel, latestRun, executionDetails }: PerfRow) {
  const section = useReportSection();
  const sectionKey = `${section ?? 'perf'}:viewport:${viewportLabel}`;
  const expanded = useReportSectionExpanded(sectionKey);
  const viewport = executionDetails.viewport;
  const fields = performanceMetadataFields(executionDetails);
  const hasSettings = Object.keys(fields).length > 0;
  const [showSettings, setShowSettings] = useState(false);
  const settingsVisible = showSettings && expanded;
  const settingsId = useId();
  const hasSignificantMetrics = significantMetrics(perf).length > 0;
  const hasNoDifference = hasNoDifferenceMetrics(perf);
  return (
    <section className="stage-stack__viewport perf-viewport" aria-label={`${viewportLabel} performance`}>
      <ReportSection
        sectionKey={sectionKey}
        title={`${viewportLabel} performance`}
        badge={<>
          {settingsVisible ? <span className="perf-viewport__dimensions">{viewport.width} × {viewport.height}</span> : null}
          <OldRunChip latestRun={latestRun} />
        </>}
        actions={hasSettings && expanded ? (
          <button
            type="button"
            className="perf-run-settings-toggle"
            aria-expanded={settingsVisible}
            aria-controls={settingsId}
            onClick={() => setShowSettings(previous => !previous)}
          >
            {showSettings ? 'hide run settings' : 'show run settings'}
          </button>
        ) : null}
        nested
      >
        {hasSettings ? (
          <div id={settingsId} className="perf-run-settings" hidden={!settingsVisible}>
            <ArtifactMetadataFields fields={fields} />
          </div>
        ) : null}

      <PerfBody
        executionDetails={executionDetails}
        perf={perf}
        hasNoDifference={hasNoDifference}
        hasSignificantMetrics={hasSignificantMetrics}
        viewportLabel={viewportLabel}
      />
      </ReportSection>
    </section>
  );
}

function PerfBody({
  executionDetails,
  perf,
  hasNoDifference,
  hasSignificantMetrics,
  viewportLabel,
}: {
  perf: PerfArtifact;
  executionDetails: ExecutionDetails;
  hasNoDifference: boolean;
  hasSignificantMetrics: boolean;
  viewportLabel: string;
}) {
  const fields = performanceMetadataFields(executionDetails);
  const timelinePreview = perf.timelinePreviewHref ? (
    <img
      src={perf.timelinePreviewHref}
      alt="timeline preview"
      style={{ display: 'block', height: 'auto', width: '100%' }}
    />
  ) : null;
  return (
    <>
      {hasSignificantMetrics ? (
        <MetricsBody perf={perf} />
      ) : hasNoDifference ? (
        <NoDifferenceNote viewportLabel={viewportLabel} />
      ) : null}
      {timelinePreview ? (
        <div className="perf-timeline-preview">
          {perf.timelineHref ? (
            <DetailedArtifactDialog
              fields={fields}
              executionDetails={executionDetails}
              variant="preview"
              href={perf.timelineHref}
              label="timeline"
              title={`${viewportLabel} timeline`}
            >
              {timelinePreview}
            </DetailedArtifactDialog>
          ) : timelinePreview}
        </div>
      ) : null}
      <ArtifactLinks perf={perf} executionDetails={executionDetails} />
    </>
  );
}

function MetricsBody({ perf }: { perf: PerfArtifact }) {
  const significant = significantMetrics(perf);
  return (
    <>
      {GROUPS.map((group) => (
        <MetricsTable
          key={group}
          group={group}
          metrics={significant.filter((metric) => metric.group === group)}
        />
      ))}
    </>
  );
}

function MetricsTable({ group, metrics }: { group: PerfMetricGroup; metrics: readonly PerfMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="stage-section">
      <ReportHeading className="stage-section__head" level={6} title={group} />
      <div className="stage-table-scroll" role="region" aria-label={`${group} performance metrics`} tabIndex={0}>
      <table className="stage-table">
        <thead>
          <tr>
            <th>metric</th>
            <th>control</th>
            <th>experiment</th>
            <th>Delta</th>
            <th>%Delta</th>
            <th>p</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <MetricRow key={metric.label} metric={metric} />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function MetricRow({ metric }: { metric: PerfMetric }) {
  const deltaClass = metric.direction === 'regression'
    ? 'delta--regression'
    : metric.direction === 'improvement'
      ? 'delta--improvement'
      : 'delta--neutral';
  return (
    <tr>
      <td>{metric.label}</td>
      <td>{metric.controlDisplay}</td>
      <td>{metric.experimentDisplay}</td>
      <td className={deltaClass}>{metric.deltaDisplay}</td>
      <td className={deltaClass}>{metric.percentDisplay}</td>
      <td>{formatPValue(metric.pValue)}</td>
    </tr>
  );
}

function ArtifactLinks({ perf, executionDetails }: { perf: PerfArtifact; executionDetails: ExecutionDetails }) {
  const fields = performanceMetadataFields(executionDetails);
  const links = [
    perf.benchReportHref ? ['bench report', perf.benchReportHref] : null,
    perf.controlLighthouseHref ? ['control lh', perf.controlLighthouseHref] : null,
    perf.experimentLighthouseHref ? ['experiment lh', perf.experimentLighthouseHref] : null,
    perf.timelineHref ? ['timeline', perf.timelineHref] : null,
    ...(perf.diffHrefs ?? []).map((link) => [link.label, link.href]),
  ].filter((link): link is string[] => link !== null);
  if (links.length === 0 && !perf.framesHref) return null;
  return (
    <FullReportOnly>
      <div className="artifact-links">
        {perf.framesHref ? (
          <FramePlayerButton fields={fields} executionDetails={executionDetails} href={perf.framesHref} />
        ) : null}
        {links.map(([label, href]) => (
          <DetailedArtifactDialog
            fields={fields}
            executionDetails={executionDetails}
            key={`${label}-${href}`}
            href={href}
            label={label}
            title={`${executionDetails.viewport.label} ${label}`}
          >
            {label}
          </DetailedArtifactDialog>
        ))}
      </div>
    </FullReportOnly>
  );
}

function significantMetrics(perf: PerfArtifact): PerfMetric[] {
  return (perf.metrics ?? []).filter((metric) => metric.direction !== 'none');
}

interface PerfRow {
  latestRun: boolean;
  executionDetails: ExecutionDetails;
  perf: PerfArtifact;
  viewportLabel: string;
}

function NoDifferenceNote({ viewportLabel }: { viewportLabel: string }) {
  return (
    <StageNote
      label={`${viewportLabel}:`}
      body="No statistically significant differences."
    />
  );
}

function hasNoDifferenceMetrics(perf: PerfArtifact): boolean {
  return perf.metrics !== undefined && significantMetrics(perf).length === 0;
}

function hasRenderableData(perf: PerfArtifact): boolean {
  return Boolean(perf.metrics || hasAttachments(perf));
}

function hasAttachments(perf: PerfArtifact): boolean {
  return Boolean(
    perf.benchReportHref ||
    perf.controlLighthouseHref ||
    perf.experimentLighthouseHref ||
    perf.timelineHref ||
    perf.timelinePreviewHref ||
    perf.framesHref ||
    (perf.diffHrefs?.length ?? 0) > 0,
  );
}
