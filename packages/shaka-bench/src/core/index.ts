export {
  compareNetworkActivity,
  default as createLighthouseBenchmark,
} from './create-lighthouse-benchmark';
export type {
  Marker,
  NavigationSample,
  PhaseSample,
  LighthouseBenchmarkOptions,
} from './create-lighthouse-benchmark';
export { default as gc } from './util/gc';
export { default as run } from './run';
export type {
  Benchmark,
  BenchmarkSampler,
  SampleGroup,
  SampleProgressCallback,
  RunOptions,
} from './run';
