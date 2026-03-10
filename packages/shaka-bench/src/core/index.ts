export { compareNetworkActivity } from './network-activity';
export { default as createLighthouseBenchmark } from './create-lighthouse-benchmark';
export type {
  Marker,
  NavigationSample,
  PhaseSample,
  LighthouseBenchmarkOptions,
  LighthouseConfig,
} from './lighthouse-config';
export { defineConfig, DEFAULT_LH_CONFIG, DEFAULT_MARKERS } from './lighthouse-config';
export { default as gc } from './util/gc';
export { default as run } from './run';
export type {
  Benchmark,
  BenchmarkSampler,
  SampleGroup,
  SampleProgressCallback,
  RunOptions,
} from './run';
