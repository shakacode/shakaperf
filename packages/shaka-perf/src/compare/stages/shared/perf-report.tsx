/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { StageRenderEntry } from '../../../stage/stage';
import type { PerfArtifact, PerfMetric, PerfMetricGroup } from '../perf';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
  ReportHeading,
  StageNote,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';
import { FramePlayer } from './frame-player';
import { useReportSection } from '../../../pipeline/report-section';
import { PerformanceViewportSection } from '../../../report-ui/PerformanceViewportSection';

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
  const perfs = measurements.filter(({ measurement }) => hasRenderableData(measurement));
  if (perfs.length === 0) return null;
  const rows = perfs.filter(({ measurement: perf }) => (
    significantMetrics(perf).length > 0 ||
    hasAttachments(perf) ||
    hasNoDifferenceMetrics(perf)
  ));

  return (
    <StageArtifact>
      <StageArtifactTitle verbatim title={title} />
      <div className="stage-stack">
        {rows.map((entry, index) => (
          <PerfViewportBlock key={`${entry.executionDetails.viewport.label}-${index}`} entry={entry} />
        ))}
      </div>
    </StageArtifact>
  );
}

function PerfViewportBlock({ entry }: { entry: StageRenderEntry<PerfArtifact> }) {
  const { measurement: perf, latestRun } = entry;
  const viewportLabel = entry.executionDetails.viewport.label;
  const section = useReportSection();
  const sectionKey = `${section ?? 'perf'}:viewport:${viewportLabel}`;
  return (
    <PerformanceViewportSection
      sectionKey={sectionKey}
      executionDetails={entry.executionDetails}
      latestRun={latestRun}
    >
      <PerfBody
        entry={entry}
        hasNoDifference={hasNoDifferenceMetrics(perf)}
        hasSignificantMetrics={significantMetrics(perf).length > 0}
      />
    </PerformanceViewportSection>
  );
}

function PerfBody({
  entry,
  hasNoDifference,
  hasSignificantMetrics,
}: {
  entry: StageRenderEntry<PerfArtifact>;
  hasNoDifference: boolean;
  hasSignificantMetrics: boolean;
}) {
  const perf = entry.measurement;
  const viewportLabel = entry.executionDetails.viewport.label;
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
              executionDetails={entry.executionDetails}
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
      <ArtifactLinks entry={entry} />
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

function ArtifactLinks({ entry }: { entry: StageRenderEntry<PerfArtifact> }) {
  const perf = entry.measurement;
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
          <DetailedArtifactDialog
            href={perf.framesHref}
            label="play frames"
            title={`${entry.executionDetails.viewport.label} frames side by side`}
            dialogVariant="wide"
            executionDetails={entry.executionDetails}
            body={<FramePlayer href={perf.framesHref} />}
          />
        ) : null}
        {links.map(([label, href]) => (
          <DetailedArtifactDialog
            executionDetails={entry.executionDetails}
            key={`${label}-${href}`}
            href={href}
            label={label}
            title={`${entry.executionDetails.viewport.label} ${label}`}
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
