/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PerfArtifact,
  PerfDirection,
  PerfMetric,
  PerfMetricGroup,
} from '../perf';
import type { RegressionThresholdStat } from '../../../bench/cli/command-config/tb-config';
import { classifyPracticalDelta } from '../../../bench/cli/compare/regression-thresholds';
import { compressSvgEmbeddedImages } from '../../../pipeline/artifact-compression';
import { safeReaddir, toPosixRelative } from '../../../pipeline/path-utils';

function classifyGroup(heading: string | undefined): PerfMetricGroup {
  return heading && heading.toLowerCase().includes('diagnostic') ? 'diagnostics' : 'vitals';
}

function parseEstimatorDelta(str: string): { value: number; unit: string } {
  const m = str.match(/^(-?[\d.]+)(.*)$/);
  if (!m) return { value: 0, unit: '' };
  const value = parseFloat(m[1]);
  return { value: Number.isFinite(value) ? value : 0, unit: m[2] };
}

function formatWithUnit(value: number, unit: string): string {
  if (unit === 'ms' && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (unit === 'ms') return `${Math.round(value)}ms`;
  return `${value}${unit}`;
}

function formatDeltaWithUnit(value: number, unit: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatWithUnit(value, unit)}`;
}

function formatPercentDelta(percentMedian: number | undefined): string {
  if (percentMedian == null || !Number.isFinite(percentMedian)) return '—';
  const rounded = Math.abs(percentMedian) >= 10
    ? Math.round(percentMedian)
    : Math.round(percentMedian * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function thresholdDelta(
  entry: BenchJsonMetric,
  regressionThresholdStat: RegressionThresholdStat,
): { value: number; unit: string } {
  if (regressionThresholdStat === 'ci-lower') {
    return parseEstimatorDelta(entry.confidenceInterval?.[0] ?? entry.estimatorDelta);
  }
  if (regressionThresholdStat === 'ci-upper') {
    return parseEstimatorDelta(entry.confidenceInterval?.[1] ?? entry.estimatorDelta);
  }
  return parseEstimatorDelta(entry.estimatorDelta);
}

interface BenchSevenFigureSummary {
  '10'?: number;
  '25'?: number;
  '50'?: number;
  '75'?: number;
  '90'?: number;
  min?: number;
  max?: number;
}

interface BenchJsonMetric {
  heading?: string;
  phaseName: string;
  isSignificant: boolean;
  estimatorDelta: string;
  pValue: number;
  confidenceInterval?: string[];
  controlSevenFigureSummary?: BenchSevenFigureSummary;
  experimentSevenFigureSummary?: BenchSevenFigureSummary;
  asPercent?: { percentMedian?: number };
}

/**
 * Shape of the per-test `report.json` written by the bench engine. Engine
 * errors and logs are surfaced live through the framework's BufferedStageLogger
 * (IPC log frames from the worker) and persisted on `Outcome` — the stage
 * artifact payload only carries successful measurement output.
 */
interface BenchCompareJsonResults {
  vitalsTableData?: BenchJsonMetric[];
  diagnosticsTableData?: BenchJsonMetric[];
  regressionThresholdStat?: RegressionThresholdStat;
}

export interface ReadPerfArtifactOptions {
  perTestDir: string;
  reportRoot: string;
  regressionThreshold: number;
  regressionThresholdStat?: RegressionThresholdStat;
  saveArtifacts: boolean;
  statisticalAnalysis: boolean;
}

/**
 * Reads bench's per-test `<slug>/report.json` (shape: ICompareJSONResults)
 * plus sibling artifact files, and emits one PerfArtifact.
 */
export async function readPerfArtifact(opts: ReadPerfArtifactOptions): Promise<PerfArtifact> {
  const { perTestDir, reportRoot } = opts;
  const artifact: PerfArtifact = {};

  const metrics: PerfMetric[] = [];
  const regressedMetrics: string[] = [];
  const improvedMetrics: string[] = [];
  let hasSignificantDifference = false;
  const reportJsonPath = path.join(perTestDir, 'report.json');
  if (opts.statisticalAnalysis && fs.existsSync(reportJsonPath)) {
    let raw: BenchCompareJsonResults;
    try {
      raw = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8')) as BenchCompareJsonResults;
    } catch (err) {
      throw new Error(
        `perf report.json unreadable at ${reportJsonPath}: ${(err as Error).message}`,
      );
    }
    const allEntries = [
      ...(raw.vitalsTableData ?? []),
      ...(raw.diagnosticsTableData ?? []),
    ];
    const regressionThresholdStat = raw.regressionThresholdStat
      ?? opts.regressionThresholdStat
      ?? 'estimator';
    for (const entry of allEntries) {
      const { value: deltaValue, unit } = parseEstimatorDelta(entry.estimatorDelta);
      const threshold = thresholdDelta(entry, regressionThresholdStat);
      const controlValue = entry.controlSevenFigureSummary?.['50'] ?? 0;
      const experimentValue = entry.experimentSevenFigureSummary?.['50'] ?? 0;
      const direction: PerfDirection = classifyPracticalDelta({
        phaseName: entry.phaseName,
        directionDeltaValue: deltaValue,
        thresholdDeltaValue: threshold.value,
        unit: threshold.unit || unit,
        isSignificant: entry.isSignificant,
        controlValue,
        experimentValue,
        regressionThreshold: opts.regressionThreshold,
      });

      metrics.push({
        label: entry.phaseName,
        group: classifyGroup(entry.heading),
        controlDisplay: formatWithUnit(controlValue, unit),
        experimentDisplay: formatWithUnit(experimentValue, unit),
        deltaDisplay: formatDeltaWithUnit(deltaValue, unit),
        percentDisplay: formatPercentDelta(entry.asPercent?.percentMedian),
        deltaPercent: entry.asPercent?.percentMedian ?? 0,
        pValue: entry.pValue,
        direction,
      });

      if (direction === 'regression') {
        regressedMetrics.push(entry.phaseName);
        hasSignificantDifference = true;
      } else if (direction === 'improvement') {
        improvedMetrics.push(entry.phaseName);
        hasSignificantDifference = true;
      }
    }
    artifact.metrics = metrics;
    artifact.regressedMetrics = regressedMetrics;
    artifact.improvedMetrics = improvedMetrics;
  }

  if (!opts.saveArtifacts) return artifact;

  const files = safeReaddir(perTestDir);

  // All artifact HTMLs (Lighthouse profiles, bench-report, per-stat diffs,
  // timeline) are referenced by relative path. The full-report.html sits
  // alongside the artifact directories so links resolve natively; the
  // lightweight report.html hides these links via <FullReportOnly/>, so a
  // shared-elsewhere copy never surfaces dead relative URLs.
  const relativeHref = (name: string | null): string | null => {
    if (!name) return null;
    return toPosixRelative(reportRoot, path.join(perTestDir, name));
  };

  const controlLh = files.find((f) => f === 'control_lighthouse_report.html') ?? null;
  const experimentLh = files.find((f) => f === 'experiment_lighthouse_report.html') ?? null;
  const timeline = files.find((f) => f === 'timeline_comparison.html') ?? null;
  const timelinePreview = files.find((f) => f === 'timeline_preview.svg') ?? null;
  // Legacy bench Handlebars report: `artifact-<n>.html`. Pick the highest-numbered
  // one so re-runs into the same results folder surface the freshest render.
  const benchReport = files
    .filter((f) => /^artifact-\d+\.html$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0], 10);
      const nb = parseInt(b.match(/\d+/)![0], 10);
      return nb - na;
    })[0] ?? null;
  // bench emits one `<artifact>.diff.html` per txt pair (network_activity,
  // performance_profile.summary, …) so each gets its own button in the report.
  const diffFiles = files.filter((f) => f.endsWith('.diff.html')).sort();

  // Only inline the preview SVG when the test actually moved off
  // `no_difference` — a flat row doesn't need the glanceable triplet grid,
  // and the file can be multi-hundred-KB (10 embedded JPEGs + a PNG diff),
  // so skipping it saves ~1 MB × (no-diff tests count) in the report.
  // Artifact-only runs have no statistical verdict but still benefit from
  // the timeline at a glance, since that is the whole point of the pass.
  const shouldIncludePreview = hasSignificantDifference || !opts.statisticalAnalysis;
  const timelinePreviewSvg = shouldIncludePreview && timelinePreview
    ? (async () => {
        try {
          const raw = fs.readFileSync(path.join(perTestDir, timelinePreview), 'utf8');
          return await compressSvgEmbeddedImages(raw, {
            imageQuality: 40,
            maxWidthPx: 160,
          });
        } catch {
          return null;
        }
      })()
    : null;

  const controlLighthouseHref = relativeHref(controlLh);
  const experimentLighthouseHref = relativeHref(experimentLh);
  const benchReportHref = relativeHref(benchReport);
  const diffHrefs = diffFiles
    .map((f) => ({ label: prettyDiffLabel(f), href: relativeHref(f) }))
    .filter((d): d is { label: string; href: string } => d.href != null);

  if (controlLighthouseHref) artifact.controlLighthouseHref = controlLighthouseHref;
  if (experimentLighthouseHref) artifact.experimentLighthouseHref = experimentLighthouseHref;
  const timelineHref = relativeHref(timeline);
  if (timelineHref) artifact.timelineHref = timelineHref;
  const previewSvg = await timelinePreviewSvg;
  if (previewSvg) artifact.timelinePreviewSvg = previewSvg;
  if (benchReportHref) artifact.benchReportHref = benchReportHref;
  if (diffHrefs.length > 0) artifact.diffHrefs = diffHrefs;
  return artifact;
}

function prettyDiffLabel(filename: string): string {
  const base = filename.replace(/\.diff\.html$/, '');
  if (base === 'network_activity') return 'network diff';
  if (base === 'performance_profile.summary') return 'profile diff';
  return `${base.replace(/_/g, ' ')} diff`;
}
