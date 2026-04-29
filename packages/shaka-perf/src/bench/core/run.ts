import type { RaceCancellation } from 'race-cancellation';

import { LighthouseSamplingWorkerPool } from './lighthouse-sampling-worker-pool';

const SETUP_TIMEOUT = 5000;
const SAMPLE_TIMEOUT = 30 * 1000;

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

/**
 * @param ellasped - time since starting to take samples
 * @param completed - number of samples completed across groups
 * @param remaining - remaining samples across groups
 * @param group - group name of sampler that just finished
 * @param iteration - current sample iteration
 * @param isTrial - whether this was a warmup/trial sample
 */
export type SampleProgressCallback = (
  ellasped: number,
  completed: number,
  remaining: number,
  group: string,
  iteration: number,
  isTrial?: boolean
) => void;

export type SamplingMode = 'sequential' | 'simultaneous';

export interface RunOptions {
  setupTimeoutMs: number;
  sampleTimeoutMs: number;
  parallelism: number;
  samplingMode: SamplingMode;
  retries?: number;
  retryDelay?: number;
  durationMs?: number;
  raceCancellation: RaceCancellation;
}

export interface RunTestOptions {
  testKey: string;
  setupTimeoutMs?: number;
  sampleTimeoutMs?: number;
  samplingMode?: SamplingMode;
  durationMs?: number;
  raceCancellation?: RaceCancellation;
}

interface ProgressState {
  start: number;
  completed: number;
}

export async function warmUpTest<TSample>(
  benchmarks: Benchmark<TSample>[],
  progress: SampleProgressCallback,
  pool: LighthouseSamplingWorkerPool<TSample>,
  options: RunTestOptions
): Promise<void> {
  checkUniqueNames(benchmarks);
  const progressState: ProgressState = { start: Date.now(), completed: 0 };
  await pool.submitPair({
    testKey: options.testKey,
    benchmarks,
    iteration: 0,
    isTrial: true,
    onProgress: createProgressReporter(
      progress,
      progressState,
      benchmarks.length,
      options.durationMs,
    ),
  });
}

export async function measureTest<TSample>(
  benchmarks: Benchmark<TSample>[],
  iterations: number,
  progress: SampleProgressCallback,
  pool: LighthouseSamplingWorkerPool<TSample>,
  options: RunTestOptions
): Promise<SampleGroup<TSample>[]> {
  checkUniqueNames(benchmarks);
  const groupedSamples = new Map<string, TSample[]>();
  const sampleGroups = benchmarks.map((benchmark) => {
    const samples: TSample[] = options.durationMs ? [] : new Array(iterations);
    groupedSamples.set(benchmark.group, samples);
    return { group: benchmark.group, samples };
  });
  const progressState: ProgressState = { start: Date.now(), completed: 0 };
  const reportProgress = createProgressReporter(
    progress,
    progressState,
    iterations * benchmarks.length,
    options.durationMs,
  );

  if (options.durationMs) {
    let index = 0;
    const start = Date.now();
    while (Date.now() - start < options.durationMs) {
      const results = await pool.submitPair({
        testKey: options.testKey,
        benchmarks,
        iteration: index + 1,
        isTrial: false,
        onProgress: reportProgress,
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
          onProgress: reportProgress,
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

export default async function run<TSample>(
  benchmarks: Benchmark<TSample>[],
  iterations: number,
  progress: SampleProgressCallback,
  options: Partial<RunOptions> = {}
): Promise<SampleGroup<TSample>[]> {
  const {
    setupTimeoutMs = SETUP_TIMEOUT,
    sampleTimeoutMs = SAMPLE_TIMEOUT,
    parallelism = 1,
    samplingMode = 'simultaneous',
    retries,
    retryDelay,
    durationMs,
    raceCancellation
  } = options;
  const pool = new LighthouseSamplingWorkerPool<TSample>({
    setupTimeoutMs,
    sampleTimeoutMs,
    parallelism,
    samplingMode,
    retries,
    retryDelay,
    raceCancellation,
  });
  try {
    await warmUpTest(benchmarks, progress, pool, {
      testKey: 'default',
      durationMs,
    });
    return await measureTest(benchmarks, iterations, progress, pool, {
      testKey: 'default',
      durationMs,
    });
  } finally {
    await pool.dispose();
  }
}

function createProgressReporter(
  progress: SampleProgressCallback,
  state: ProgressState,
  totalSamples: number,
  durationMs: number | undefined,
): (group: string, iteration: number, isTrial: boolean) => void {
  return (group: string, iteration: number, isTrial: boolean) => {
    const elapsed = Date.now() - state.start;
    const completed = state.completed + 1;
    let remaining: number;
    if (durationMs) {
      const remainingMs = Math.max(0, durationMs - elapsed);
      remaining = completed > 0
        ? Math.round((remainingMs * completed) / elapsed)
        : 0;
    } else {
      remaining = Math.max(0, totalSamples - completed);
    }
    state.completed = completed;
    progress(elapsed, completed, remaining, group, iteration, isTrial);
  };
}

function checkUniqueNames(benchmarks: Benchmark<unknown>[]): void {
  const set = new Set<string>();
  for (const benchmark of benchmarks) {
    if (set.has(benchmark.group)) {
      throw new Error(`duplicate benchmark group name ${benchmark.group}`);
    }
  }
}
