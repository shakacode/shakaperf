import { throwIfCancelled, withRaceTimeout } from 'race-cancellation';

import type { RaceCancellation } from 'race-cancellation';

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

interface GroupedSamples<TSample> {
  [group: string]: TSample[];
}

type SamplerSet<TSample> = { [group: string]: BenchmarkSampler<TSample> };

/**
 * @param ellasped - time since starting to take samples
 * @param completed - number of samples completed across groups
 * @param remaining - remaining samples across groups
 * @param group - group name of sampler we are about to sample
 * @param iteration - current sample iteration
 */
export type SampleProgressCallback = (
  ellasped: number,
  completed: number,
  remaining: number,
  group: string,
  iteration: number
) => void;

export interface RunOptions {
  setupTimeoutMs: number;
  sampleTimeoutMs: number;
  parallelism: number;
  raceCancellation: RaceCancellation;
}

export default async function run<TSample>(
  benchmarks: Benchmark<TSample>[],
  iterations: number,
  progress: SampleProgressCallback,
  options: Partial<RunOptions> = {}
): Promise<SampleGroup<TSample>[]> {
  checkUniqueNames(benchmarks);
  const {
    setupTimeoutMs = SETUP_TIMEOUT,
    sampleTimeoutMs = SAMPLE_TIMEOUT,
    parallelism = 1,
    raceCancellation
  } = options;

  const samplerSets: SamplerSet<TSample>[] = [];
  let sampleGroups: SampleGroup<TSample>[];
  try {
    for (let p = 0; p < parallelism; p++) {
      const set: SamplerSet<TSample> = {};
      await setupSamplers(benchmarks, set, setupTimeoutMs, raceCancellation);
      samplerSets.push(set);
    }
    sampleGroups = await takeSamples(
      samplerSets,
      iterations,
      progress,
      sampleTimeoutMs,
      raceCancellation
    );
  } finally {
    await disposeAllSamplerSets(samplerSets);
  }
  return sampleGroups;
}

async function takeSamples<TSample>(
  samplerSets: SamplerSet<TSample>[],
  samplesPerGroup: number,
  progress: SampleProgressCallback,
  sampleTimeoutMs: number,
  raceCancellation: RaceCancellation | undefined
): Promise<SampleGroup<TSample>[]> {
  const groups = Object.keys(samplerSets[0]);
  const sampleCount = (samplesPerGroup + 1) * groups.length;
  const groupedSamples: GroupedSamples<TSample> = {};
  const sampleGroups: SampleGroup<TSample>[] = [];
  const start = Date.now();
  let completed = 0;

  for (const group of groups) {
    const samples: TSample[] = new Array(samplesPerGroup);
    groupedSamples[group] = samples;
    sampleGroups.push({ group, samples });
  }

  // Trial run using first sampler set only
  await runOnePair(samplerSets[0], groups, 0, true, sampleTimeoutMs, raceCancellation,
    (group, iteration) => {
      progress(Date.now() - start, completed, sampleCount - completed, group, iteration);
      completed++;
    }
  );

  if (samplesPerGroup === 1) {
    // Only one real measurement needed — run it and store
    const results = await runOnePair(samplerSets[0], groups, 1, false, sampleTimeoutMs, raceCancellation,
      (group, iteration) => {
        progress(Date.now() - start, completed, sampleCount - completed, group, iteration);
        completed++;
      }
    );
    for (const { group, sample } of results) {
      groupedSamples[group][0] = sample;
    }
    return sampleGroups;
  }

  // Worker pool: each worker grabs the next iteration index and runs a pair
  let nextIndex = 0;

  async function worker(samplerSet: SamplerSet<TSample>): Promise<void> {
    while (true) {
      const myIndex = nextIndex++;
      if (myIndex >= samplesPerGroup) break;

      const results = await runOnePair(samplerSet, groups, myIndex + 1, false, sampleTimeoutMs, raceCancellation,
        (group, iteration) => {
          progress(Date.now() - start, completed, sampleCount - completed, group, iteration);
          completed++;
        }
      );
      for (const { group, sample } of results) {
        groupedSamples[group][myIndex] = sample;
      }
    }
  }

  await Promise.all(samplerSets.map(worker));

  return sampleGroups;
}

async function runOnePair<TSample>(
  samplerSet: SamplerSet<TSample>,
  groups: string[],
  iteration: number,
  isTrial: boolean,
  sampleTimeoutMs: number,
  raceCancellation: RaceCancellation | undefined,
  onProgress: (group: string, iteration: number) => void
): Promise<{ group: string; sample: TSample }[]> {
  const shuffled = [...groups];
  shuffle(shuffled);
  return Promise.all(
    shuffled.map(async (group) => {
      onProgress(group, iteration);
      const sampler = samplerSet[group];
      const sample = await sampleWithTimeout(
        sampler, iteration, isTrial, sampleTimeoutMs, raceCancellation
      );
      return { group, sample };
    })
  );
}

async function setupWithTimeout<TSample>(
  benchmark: Benchmark<TSample>,
  setupTimeoutMs: number,
  raceCancellation?: RaceCancellation
): Promise<BenchmarkSampler<TSample>> {
  const sampler = await withRaceTimeout(
    (raceTimeout) => benchmark.setup(raceTimeout),
    setupTimeoutMs
  )(raceCancellation);
  return throwIfCancelled(sampler);
}

async function sampleWithTimeout<TSample>(
  sampler: BenchmarkSampler<TSample>,
  iteration: number,
  isTrial: boolean,
  sampleTimeoutMs: number,
  raceCancellation?: RaceCancellation
): Promise<TSample> {
  const sample = await withRaceTimeout(
    (raceTimeout) => sampler.sample(iteration, isTrial, raceTimeout),
    sampleTimeoutMs
  )(raceCancellation);
  return throwIfCancelled(sample);
}

async function setupSamplers<TSample>(
  benchmarks: Benchmark<TSample>[],
  samplers: { [group: string]: BenchmarkSampler<TSample> },
  setupTimeoutMs: number,
  raceCancellation?: RaceCancellation
): Promise<void> {
  void (await Promise.all(
    benchmarks.map(async (benchmark) => {
      const sampler = await setupWithTimeout(
        benchmark,
        setupTimeoutMs,
        raceCancellation
      );
      samplers[benchmark.group] = sampler;
    })
  ));
}

async function disposeAllSamplerSets<TSample>(
  samplerSets: SamplerSet<TSample>[]
): Promise<void> {
  void (await Promise.all(
    samplerSets.flatMap((set) =>
      Object.keys(set).map((group) => set[group].dispose())
    )
  ));
}

function shuffle(arr: string[]): void {
  for (let i = arr.length - 1; i >= 1; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[j];
    arr[j] = arr[i];
    arr[i] = tmp;
  }
}

function checkUniqueNames(benchmarks: Benchmark<unknown>[]): void {
  const set = new Set<string>();
  for (const benchmark of benchmarks) {
    if (set.has(benchmark.group)) {
      throw new Error(`duplicate benchmark group name ${benchmark.group}`);
    }
  }
}
