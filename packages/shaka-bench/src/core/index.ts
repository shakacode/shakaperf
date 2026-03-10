export {
  compareNetworkActivity,
  default as createLighthouseBenchmark,
} from './create-lighthouse-benchmark';
export type {
  Marker,
  NavigationSample,
  PhaseSample,
  LighthouseBenchmarkOptions,
  LighthouseConfig,
} from './create-lighthouse-benchmark';
export { defineConfig, DEFAULT_LH_CONFIG } from './create-lighthouse-benchmark';
export { default as gc } from './util/gc';
export { default as run } from './run';
export type {
  Benchmark,
  BenchmarkSampler,
  SampleGroup,
  SampleProgressCallback,
  RunOptions,
} from './run';
