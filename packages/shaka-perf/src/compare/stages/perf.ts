/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type { PerfStageConfig } from './perf/stage';

export type PerfDirection = 'regression' | 'improvement' | 'none';
export type PerfMetricGroup = 'vitals' | 'diagnostics';

export interface PerfMetric {
  label: string;
  group: PerfMetricGroup;
  controlValue: number;
  experimentValue: number;
  deltaValue: number;
  controlDisplay: string;
  experimentDisplay: string;
  deltaDisplay: string;
  percentDisplay: string;
  /**
   * Numeric median percent change (experiment vs control), signed in the
   * metric's own direction (e.g. +12 = 12% slower). Backs the report shell's
   * "Sort by" chips; `percentDisplay` is the formatted view of the same value.
   */
  deltaPercent: number;
  pValue: number;
  direction: PerfDirection;
}

export interface PerfArtifact {
  metrics?: PerfMetric[];
  regressedMetrics?: string[];
  improvedMetrics?: string[];
  controlLighthouseHref?: string;
  experimentLighthouseHref?: string;
  /**
   * Relative URL (from the report.html's directory) to the timeline comparison
   * HTML — e.g. `perf-desktop/homepage/timeline_comparison.html`. All artifact
   * hrefs in this struct are now relative paths (not base64 data URIs); the
   * full-report.html sits next to the artifact directories so the dialog
   * iframe loads them natively, and the lightweight report.html hides these
   * links behind <FullReportOnly/> so dead refs are never visible to clients.
   */
  timelineHref?: string;
  /**
   * Inline SVG string for the timeline preview (3xN triplet grid). Only
   * populated on viewports whose perf status actually moved off
   * `no_difference` — `no_difference` rows fall back to the plain
   * "timeline" button in the artifact link row.
   */
  timelinePreviewSvg?: string;
  benchReportHref?: string;
  diffHrefs?: { label: string; href: string }[];
}

export type PerfResult = PerfArtifact;
export type PerfLowNoiseResult = PerfArtifact;
export type PerfWarmupResult = PerfArtifact;
