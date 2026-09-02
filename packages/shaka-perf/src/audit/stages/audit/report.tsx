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
  const rows = measurements
    .map((entry) => ({
      audit: entry.measurement,
      viewportLabel: entry.viewport.label,
    }))
    .filter(({ audit }) => hasRenderableData(audit));
  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle>audit</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((row, index) => (
          <div key={`${row.viewportLabel}-${index}`} className="stage-stack__viewport">
            <AuditBody audit={row.audit} viewportLabel={row.viewportLabel} />
          </div>
        ))}
      </div>
    </StageArtifact>
  );
}

function AuditBody({ audit, viewportLabel }: { audit: AuditResult; viewportLabel: string }) {
  return <MetricTable audit={audit} viewportLabel={viewportLabel} />;
}

function MetricTable({
  audit,
  viewportLabel,
}: {
  audit: AuditResult;
  viewportLabel: string;
}) {
  const metrics = audit.metrics ?? [];
  if (metrics.length === 0 && !hasArtifacts(audit)) return null;
  return (
    <div className="stage-section">
      <div className="stage-section__head">{viewportLabel}</div>
      <div style={METRIC_COLUMNS_STYLE}>
        {GROUPS.map((group) => {
          const groupMetrics = metrics.filter((metric) => metric.group === group.id);
          if (groupMetrics.length === 0) return null;
          return (
            <MetricGroupColumn key={group.id} title={group.label} metrics={groupMetrics} />
          );
        })}
        {audit.lighthouseHref ? (
          <FullReportOnly>
            <LighthouseColumn audit={audit} />
          </FullReportOnly>
        ) : null}
      </div>
      <ArtifactLinks audit={audit} />
    </div>
  );
}

// The single-side halves of compare's "profile diff" / "network diff" — the
// profile timeline this stage renders, and the network log every run already
// wrote but nothing surfaced.
function ArtifactLinks({ audit }: { audit: AuditResult }) {
  const links = [
    audit.performanceProfileHref ? ['performance profile', audit.performanceProfileHref] : null,
    audit.networkActivityHref ? ['network activity', audit.networkActivityHref] : null,
  ].filter((link): link is string[] => link !== null);
  if (links.length === 0) return null;
  return (
    <FullReportOnly>
      <div className="artifact-links">
        {links.map(([label, href]) => (
          <DetailedArtifactDialog key={label} href={href} label={label}>
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

function LighthouseColumn({ audit }: { audit: AuditResult }) {
  if (!audit.lighthouseHref) return null;
  return (
    <div style={METRIC_COLUMN_STYLE}>
      <DetailedArtifactDialog
        href={audit.lighthouseHref}
        label="Lighthouse report"
        variant="preview"
      >
        <span style={LIGHTHOUSE_BUTTON_STYLE}>
          <span style={LIGHTHOUSE_BUTTON_LABEL_STYLE}>Lighthouse report</span>
          {audit.lighthouseThumbHref ? (
            <img
              src={audit.lighthouseThumbHref}
              alt=""
              style={LIGHTHOUSE_THUMB_STYLE}
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

const LIGHTHOUSE_THUMB_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
};

function hasArtifacts(audit: AuditResult): boolean {
  return audit.lighthouseHref != null ||
    audit.performanceProfileHref != null ||
    audit.networkActivityHref != null;
}

function hasRenderableData(audit: AuditResult): boolean {
  return (audit.metrics?.length ?? 0) > 0 || hasArtifacts(audit);
}
