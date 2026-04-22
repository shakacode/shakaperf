export { saveNetworkActivity } from './network-activity';
export { default as createLighthouseBenchmark } from './create-lighthouse-benchmark';
export { default as createLighthouseBenchmarkInProcess } from './create-lighthouse-benchmark-in-process';
export type {
  Marker,
  NavigationSample,
  PhaseSample,
  LighthouseBenchmarkOptions,
  LighthouseConfig,
} from './lighthouse-config';
export { defineConfig, DEFAULT_LH_CONFIG, DEFAULT_MARKERS } from './lighthouse-config';
export { default as run } from './run';
export type {
  Benchmark,
  BenchmarkSampler,
  SampleGroup,
  SampleProgressCallback,
  RunOptions,
} from './run';
export { abTest, getRegisteredTests, clearRegistry, TestType } from './ab-test-registry';
export type { AbTestDefinition, AbTestOptions, AbTestVisregConfig, TestFnContext } from './ab-test-registry';
export { summarizePerformanceProfile } from './summarize-performance-profile';
export { generateHtmlDiffs } from './html-diff';
export type { GenerateHtmlDiffsOptions } from './html-diff';
export { generateTimelineComparison, generateTimelinePreviewSvg } from './timeline-comparison';
export type { GenerateTimelineComparisonOptions, GenerateTimelinePreviewOptions } from './timeline-comparison';
