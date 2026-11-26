/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export const stageIds = {
  audit: 'audit',
  accessibility: 'accessibility',
  agentReadiness: 'agent-readiness',
  codeCoverage: 'code_coverage',
  buildAnnotatedTimeline: 'build_annotated_timeline',
  aiSummary: 'ai_summary',
  visreg: 'visreg',
  perfWarmup: 'perf-warmup',
  perf: 'perf',
  perfLowNoise: 'perf-low-noise',
} as const;
