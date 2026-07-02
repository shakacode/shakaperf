/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export { saveNetworkActivity } from './network-activity';
export { default as createLighthouseBenchmark } from './create-lighthouse-benchmark';
export type {
  Marker,
  NavigationSample,
  PhaseSample,
  LighthouseBenchmarkOptions,
  LighthouseConfig,
} from './lighthouse-config';
export {
  DEFAULT_LH_CONFIG,
  DEFAULT_MARKERS,
  lhConfigForViewport,
} from './lighthouse-config';
export {
  createWorkerLighthouseSamplingPool,
} from './lighthouse-sampling-worker-pool';
export type { LighthouseSamplingPool } from './lighthouse-sampling-worker-pool';
export type {
  Benchmark,
  BenchmarkSamplingPool,
  BenchmarkSampler,
  SampleGroup,
  RunTestOptions,
  SamplingMode,
} from './run';
export { measureTest } from './run';
export { abTest, getRegisteredTests, clearRegistry, TestType } from './ab-test-registry';
export type { AbTestDefinition, AbTestOptions, AbTestVisregConfig, TestFnContext } from './ab-test-registry';
export { summarizePerformanceProfile } from './summarize-performance-profile';
export { generateHtmlDiffs } from './html-diff';
export type { GenerateHtmlDiffsOptions } from './html-diff';
export {
  attachPwInteractionsToKeptFrames,
  bucketEventsToFrames,
  copyPreviousFramesForAnnotations,
  deriveInteractionsPath,
  deriveScreencastVideoPath,
  deriveScreencastStartPath,
  frameImageFilename,
  generateTimelineComparison,
  generateTimelinePreviewSvg,
  loadPlaywrightInteractions,
  loadScreenshotsFromVideo,
  parseProfile,
  profileFramesWithAnnotations,
  syncDedupedVideoToTraceViaPixelmatchAnchors,
} from './timeline-comparison';
export type {
  ArrowSpec,
  CopiedAnnotationFramesResult,
  DedupedScreencastSyncResult,
  FrameAnnotation,
  GenerateTimelineComparisonOptions,
  GenerateTimelinePreviewOptions,
  ProfileData,
  ProfileFrame,
  ScreencastSyncStats,
  Screenshot,
} from './timeline-comparison';
