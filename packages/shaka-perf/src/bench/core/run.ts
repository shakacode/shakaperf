import type { RaceCancellation } from 'race-cancellation';

import { LighthouseSamplingWorkerPool } from './lighthouse-sampling-worker-pool';

export interface Benchmark<TSample> {
  readonly group: string;
  setup(raceCancellation: RaceCancellation): Promise<BenchmarkSampler<TSample>>;
}

export interface BenchmarkSampler<TSample> {
  dispose(): Promise<void>;
  sample(
    iteration: number,
    isTrial: boolean,
    raceCancellation: RaceCancellation
  ): Promise<TSample>;
}

export interface SampleGroup<TSample> {
  group: string;
  samples: TSample[];
}

export type SamplingMode = 'sequential' | 'simultaneous';

export type SampleEvent = (group: string, iteration: number, isTrial: boolean) => void;

const noop: SampleEvent = () => undefined;

export interface RunTestOptions {
  testKey: string;
  durationMs?: number;
  onProgress?: SampleEvent;
  onSampleStart?: SampleEvent;
}

export async function warmUpTest<TSample>(
  benchmarks: Benchmark<TSample>[],
  pool: LighthouseSamplingWorkerPool<TSample>,
  options: RunTestOptions
): Promise<void> {
  await pool.submitPair({
    testKey: options.testKey,
    benchmarks,
    iteration: 0,
    isTrial: true,
    onProgress: options.onProgress ?? noop,
    onSampleStart: options.onSampleStart,
  });
}

export async function measureTest<TSample>(
  benchmarks: Benchmark<TSample>[],
  iterations: number,
  pool: LighthouseSamplingWorkerPool<TSample>,
  options: RunTestOptions
): Promise<SampleGroup<TSample>[]> {
  const groupedSamples = new Map<string, TSample[]>();
  const sampleGroups = benchmarks.map((benchmark) => {
    const samples: TSample[] = options.durationMs ? [] : new Array(iterations);
    groupedSamples.set(benchmark.group, samples);
    return { group: benchmark.group, samples };
  });

  const onProgress = options.onProgress ?? noop;
  const { onSampleStart } = options;

  if (options.durationMs) {
    let index = 0;
    const start = Date.now();
    while (Date.now() - start < options.durationMs) {
      const results = await pool.submitPair({
        testKey: options.testKey,
        benchmarks,
        iteration: index + 1,
        isTrial: false,
        onProgress,
        onSampleStart,
      });
      for (const { group, sample } of results) {
        groupedSamples.get(group)!.push(sample);
      }
      index++;
    }
    return sampleGroups;
  }

  try {
    await Promise.all(
      Array.from({ length: iterations }, async (_, index) => {
        const results = await pool.submitPair({
          testKey: options.testKey,
          benchmarks,
          iteration: index + 1,
          isTrial: false,
          onProgress,
          onSampleStart,
        });
        for (const { group, sample } of results) {
          groupedSamples.get(group)![index] = sample;
        }
      })
    );
  } catch (err) {
    pool.cancelTest(options.testKey, err);
    throw err;
  }

  return sampleGroups;
}
