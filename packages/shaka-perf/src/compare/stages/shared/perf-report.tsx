/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
  StageNote,
  svgWithFullWidthStyle,
} from '../../../pipeline/stage-report-components';
import { FullReportOnly } from '../../../pipeline/report-mode';

const GROUPS: PerfMetricGroup[] = ['vitals', 'diagnostics'];

// Switch to exponential below 1e-6 — at that point a decimal would need
// more than 5 leading zeros and the magnitude is easier to read in mantissa
// form. Trim trailing zeros so typical values stay compact (0.5, not 0.500000).
function formatPValue(p: number): string {
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
      viewportLabel: entry.viewport.label,
    }))
    .filter(({ perf }) => hasRenderableData(perf));
  if (perfs.length === 0) return null;
  const rows = perfs.filter(({ perf }) => significantMetrics(perf).length > 0 || hasAttachments(perf));
  const noDifference = perfs.filter(({ perf }) => hasNoDifferenceMetrics(perf));

  return (
    <StageArtifact>
      <StageArtifactTitle verbatim>{title}</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((row, index) => (
          <div key={`${row.viewportLabel}-${index}`} className="stage-stack__viewport">
            <PerfBody perf={row.perf} />
          </div>
        ))}
        <NoDifferenceNote perfs={noDifference} />
      </div>
    </StageArtifact>
  );
}

function PerfBody({ perf }: { perf: PerfArtifact }) {
  return (
    <>
      <MetricsBody perf={perf} />
      {perf.timelinePreviewSvg && perf.timelineHref ? (
        <DetailedArtifactDialog
          variant="preview"
          href={perf.timelineHref}
          label="timeline"
        >
          <span dangerouslySetInnerHTML={{ __html: svgWithFullWidthStyle(perf.timelinePreviewSvg) }} />
        </DetailedArtifactDialog>
      ) : null}
      <ArtifactLinks perf={perf} />
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
      <div className="stage-section__head">{group}</div>
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

function ArtifactLinks({ perf }: { perf: PerfArtifact }) {
  const links = [
    perf.benchReportHref ? ['bench report', perf.benchReportHref] : null,
    perf.controlLighthouseHref ? ['control lh', perf.controlLighthouseHref] : null,
    perf.experimentLighthouseHref ? ['experiment lh', perf.experimentLighthouseHref] : null,
    perf.timelineHref ? ['timeline', perf.timelineHref] : null,
    ...(perf.diffHrefs ?? []).map((link) => [link.label, link.href]),
  ].filter((link): link is string[] => link !== null);
  if (links.length === 0) return null;
  return (
    <FullReportOnly>
      <div className="artifact-links">
        {links.map(([label, href]) => (
          <DetailedArtifactDialog key={`${label}-${href}`} href={href} label={label}>
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
  perf: PerfArtifact;
  viewportLabel: string;
}

function NoDifferenceNote({ perfs }: { perfs: readonly PerfRow[] }) {
  if (perfs.length === 0) return null;
  return (
    <StageNote
      label={`${perfs.map((row) => row.viewportLabel.toUpperCase()).join(' & ')}:`}
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
    (perf.diffHrefs?.length ?? 0) > 0,
  );
}
