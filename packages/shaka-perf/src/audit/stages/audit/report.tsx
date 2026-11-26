/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import { DetailedArtifactDialog } from '../../../report-ui/artifacts/DetailedArtifactDialog';
import { StageArtifact } from '../../../report-ui/artifacts/StageArtifact';
import { StageArtifactTitle } from '../../../report-ui/artifacts/StageArtifactTitle';
import { PerformanceViewportSection } from '../../../report-ui/sections/PerformanceViewportSection';
import { FullReportOnly } from '../../../report-ui/FullReportOnly';
import { ScreenshotPreview } from '../../../report-ui/artifacts/ScreenshotPreview';
import { METRIC_LEVEL_CSS_VAR } from './metrics';
import type { AuditMetric, AuditMetricGroup, AuditResult } from './stage';

const GROUPS: { id: AuditMetricGroup; label: string }[] = [
  { id: 'vitals', label: 'LH & Vitals' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

const METRIC_COLUMNS_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'stretch',
  flexWrap: 'wrap',
};

// minWidth 160 so the three columns (Vitals + Diagnostics + Lighthouse
// thumb) all fit in a 560px-min card without wrapping the thumb to a new
// row. flex-grow lets them share extra width when the card is stretched.
const METRIC_COLUMN_STYLE: CSSProperties = {
  flex: '1 1 160px',
  minWidth: 160,
  background: 'var(--bg-sunken)',
  border: '1px solid var(--border)',
  padding: '8px 10px',
};

function metricValueStyle(level: AuditMetric['level']): CSSProperties | undefined {
  if (!level) return undefined;
  return { color: METRIC_LEVEL_CSS_VAR[level], fontWeight: 600 };
}

export function AuditArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<AuditResult>[];
}) {
  const rows = measurements.filter(({ measurement }) => hasRenderableData(measurement));
  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle title="audit" />
      <div className="stage-stack">
        {rows.map((entry, index) => (
          <MetricTable key={`${entry.executionDetails.viewport.label}-${index}`} entry={entry} />
        ))}
      </div>
    </StageArtifact>
  );
}

function MetricTable({ entry }: { entry: StageRenderEntry<AuditResult> }) {
  const { measurement: audit, latestRun } = entry;
  const viewportLabel = entry.executionDetails.viewport.label;
  const metrics = audit.metrics ?? [];
  if (metrics.length === 0 && !hasArtifacts(audit)) return null;
  return (
    <PerformanceViewportSection
      sectionKey={`audit:viewport:${viewportLabel}`}
      executionDetails={entry.executionDetails}
      latestRun={latestRun}
    >
      <div style={METRIC_COLUMNS_STYLE}>
        {GROUPS.map((group) => {
          const groupMetrics = metrics.filter((metric) => metric.group === group.id);
          if (groupMetrics.length === 0) return null;
          return <MetricGroupColumn key={group.id} title={group.label} metrics={groupMetrics} />;
        })}
        {audit.lighthouseHref ? (
          <FullReportOnly>
            <LighthouseColumn entry={entry} />
          </FullReportOnly>
        ) : null}
      </div>
      <ArtifactLinks entry={entry} />
    </PerformanceViewportSection>
  );
}

// The single-side halves of compare's "profile diff" / "network diff" — the
// profile timeline this stage renders, and the network log every run already
// wrote but nothing surfaced.
function ArtifactLinks({ entry }: { entry: StageRenderEntry<AuditResult> }) {
  const audit = entry.measurement;
  const links = [
    audit.performanceProfileHref ? ['performance profile', audit.performanceProfileHref] : null,
    audit.networkActivityHref ? ['network activity', audit.networkActivityHref] : null,
  ].filter((link): link is string[] => link !== null);
  if (links.length === 0) return null;
  return (
    <FullReportOnly>
      <div className="artifact-links">
        {links.map(([label, href]) => (
          <DetailedArtifactDialog
            executionDetails={entry.executionDetails}
            key={label}
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

function MetricGroupColumn({ title, metrics }: { title: string; metrics: readonly AuditMetric[] }) {
  return (
    <div style={METRIC_COLUMN_STYLE}>
      <table className="stage-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric, index) => (
            <tr key={`${metric.label}-${index}`}>
              <td>{metric.label}</td>
              <td style={metricValueStyle(metric.level)}>{metric.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LighthouseColumn({ entry }: { entry: StageRenderEntry<AuditResult> }) {
  const audit = entry.measurement;
  if (!audit.lighthouseHref) return null;
  return (
    <div style={METRIC_COLUMN_STYLE}>
      <DetailedArtifactDialog
        executionDetails={entry.executionDetails}
        title={`${entry.executionDetails.viewport.label} Lighthouse report`}
        href={audit.lighthouseHref}
        label="Lighthouse report"
        variant="preview"
      >
        <span style={LIGHTHOUSE_BUTTON_STYLE}>
          <span style={LIGHTHOUSE_BUTTON_LABEL_STYLE}>Lighthouse report</span>
          {audit.lighthouseThumbHref ? (
            <ScreenshotPreview
              src={audit.lighthouseThumbHref}
              alt="Lighthouse report preview"
            />
          ) : null}
        </span>
      </DetailedArtifactDialog>
    </div>
  );
}

const LIGHTHOUSE_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'stretch',
};

const LIGHTHOUSE_BUTTON_LABEL_STYLE: CSSProperties = {
  fontWeight: 600,
  textAlign: 'center',
};

function hasArtifacts(audit: AuditResult): boolean {
  return audit.lighthouseHref != null ||
    audit.performanceProfileHref != null ||
    audit.networkActivityHref != null;
}

function hasRenderableData(audit: AuditResult): boolean {
  return (audit.metrics?.length ?? 0) > 0 || hasArtifacts(audit);
}
