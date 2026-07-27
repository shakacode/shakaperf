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
   * Report-relative path to the timeline comparison HTML. Self-contained
   * report generation replaces it with a data URI.
   */
  timelineHref?: string;
  /**
   * Report-relative path to the timeline preview SVG (3xN triplet grid).
   * Only populated on viewports whose perf status moved off `no_difference`.
   */
  timelinePreviewHref?: string;
  benchReportHref?: string;
  diffHrefs?: { label: string; href: string }[];
}

export type PerfResult = PerfArtifact;
export type PerfLowNoiseResult = PerfArtifact;
export type PerfWarmupResult = PerfArtifact;
