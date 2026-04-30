import { throwIfCancelled, withRaceTimeout } from 'race-cancellation';

import type { RaceCancellation } from 'race-cancellation';
import type {
  Benchmark,
  BenchmarkSampler,
  SamplingMode,
} from './run';

type SamplerSet<TSample> = { [group: string]: BenchmarkSampler<TSample> };

interface NavigationBarrier {
  wait(): Promise<void>;
  abort(reason: unknown): void;
}

export interface PairSampleResult<TSample> {
  group: string;
  sample: TSample;
}

export interface LighthouseSamplingTask<TSample> {
  testKey: string;
  benchmarks: Benchmark<TSample>[];
  iteration: number;
  isTrial: boolean;
  onProgress: (group: string, iteration: number, isTrial: boolean) => void;
  onSampleStart?: (group: string, iteration: number, isTrial: boolean) => void;
}

interface QueuedTask<TSample> extends LighthouseSamplingTask<TSample> {
  resolve: (value: PairSampleResult<TSample>[]) => void;
  reject: (reason: unknown) => void;
}

interface WorkerState<TSample> {
  busy: boolean;
  bound: { testKey: string; samplerSet: SamplerSet<TSample> } | null;
}

export interface LighthouseSamplingWorkerPoolOptions {
  setupTimeoutMs: number;
  sampleTimeoutMs: number;
  parallelism: number;
  samplingMode: SamplingMode;
  retries?: number;
  retryDelay?: number;
  raceCancellation?: RaceCancellation;
}

export class LighthouseSamplingWorkerPool<TSample> {
  private readonly workers: WorkerState<TSample>[];
  private readonly queue: QueuedTask<TSample>[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private disposed = false;

  constructor(private readonly options: LighthouseSamplingWorkerPoolOptions) {
    const workerCount = options.samplingMode === 'simultaneous'
      ? Math.max(1, Math.round(options.parallelism / 2))
      : options.parallelism;
    this.workers = Array.from({ length: workerCount }, () => ({
      busy: false,
      bound: null,
    }));
  }

  submitPair(task: LighthouseSamplingTask<TSample>): Promise<PairSampleResult<TSample>[]> {
    if (this.disposed) {
      return Promise.reject(new Error('LighthouseSamplingWorkerPool has been disposed'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ ...task, resolve, reject });
      this.pump();
    });
  }

  cancelTest(testKey: string, reason: unknown): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if (task.testKey !== testKey) continue;
      this.queue.splice(i, 1);
      task.reject(reason);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const pending = this.queue.splice(0);
    for (const task of pending) {
      task.reject(new Error('LighthouseSamplingWorkerPool disposed before task started'));
    }
    await Promise.allSettled([...this.inFlight]);
    await Promise.all(this.workers.map((worker) => this.disposeWorker(worker)));
  }

  private pump(): void {
    if (this.disposed) return;
    for (const worker of this.workers) {
      if (worker.busy) continue;
      const task = this.queue.shift();
      if (!task) return;
      worker.busy = true;
      const run = this.runTask(worker, task)
        .then(task.resolve, task.reject)
        .finally(() => {
          worker.busy = false;
          this.inFlight.delete(run);
          this.pump();
        });
      this.inFlight.add(run);
    }
  }

  private async runTask(
    worker: WorkerState<TSample>,
    task: LighthouseSamplingTask<TSample>
  ): Promise<PairSampleResult<TSample>[]> {
    const maxRetries = this.options.retries ?? 2;
    const retryDelay = this.options.retryDelay ?? 1000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const samplerSet = await this.bindWorker(worker, task);
        return await runOneShuffledPair(
          samplerSet,
          task.benchmarks.map((benchmark) => benchmark.group),
          task.iteration,
          task.isTrial,
          this.options.sampleTimeoutMs,
          this.options.samplingMode,
          this.options.raceCancellation,
          task.onProgress,
          task.onSampleStart,
        );
      } catch (err) {
        lastError = err;
        if (attempt > maxRetries) break;
        console.log(`Sample attempt ${attempt} failed, retrying...`);
        await this.disposeWorker(worker);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    const error = lastError instanceof Error ? lastError : new Error(String(lastError));
    throw new Error(
      `Failed after ${maxRetries + 1} attempts. Last error: ${error.message}`
    );
  }

  private async bindWorker(
    worker: WorkerState<TSample>,
    task: LighthouseSamplingTask<TSample>
  ): Promise<SamplerSet<TSample>> {
    if (worker.bound?.testKey === task.testKey) {
      return worker.bound.samplerSet;
    }
    await this.disposeWorker(worker);
    const samplerSet: SamplerSet<TSample> = {};
    await setupSamplers(
      task.benchmarks,
      samplerSet,
      this.options.setupTimeoutMs,
      this.options.raceCancellation,
    );
    worker.bound = { testKey: task.testKey, samplerSet };
    return samplerSet;
  }

  private async disposeWorker(worker: WorkerState<TSample>): Promise<void> {
    if (!worker.bound) return;
    const { samplerSet } = worker.bound;
    worker.bound = null;
    await disposeSamplerSet(samplerSet);
  }
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
  raceCancellation?: RaceCancellation,
  navigationBarrier?: NavigationBarrier
): Promise<TSample> {
  const sample = await withRaceTimeout(
    (raceTimeout) => sampler.sample(iteration, isTrial, raceTimeout, navigationBarrier?.wait),
    sampleTimeoutMs
  )(raceCancellation);
  return throwIfCancelled(sample);
}

async function setupSamplers<TSample>(
  benchmarks: Benchmark<TSample>[],
  samplers: SamplerSet<TSample>,
  setupTimeoutMs: number,
  raceCancellation?: RaceCancellation
): Promise<void> {
  try {
    await Promise.all(
      benchmarks.map(async (benchmark) => {
        const sampler = await setupWithTimeout(
          benchmark,
          setupTimeoutMs,
          raceCancellation
        );
        samplers[benchmark.group] = sampler;
      })
    );
  } catch (err) {
    // Dispose any samplers that finished setup before a sibling rejected;
    // otherwise their Chrome subprocesses + tmp userDataDirs leak.
    try {
      await disposeSamplerSet(samplers);
    } catch (disposeErr) {
      console.error('Failed to dispose partial samplers after setup failure:', disposeErr);
    }
    throw err;
  }
}

async function disposeSamplerSet<TSample>(
  samplerSet: SamplerSet<TSample>
): Promise<void> {
  await Promise.all(Object.values(samplerSet).map((sampler) => sampler.dispose()));
}

async function runOneShuffledPair<TSample>(
  samplerSet: SamplerSet<TSample>,
  groups: string[],
  iteration: number,
  isTrial: boolean,
  sampleTimeoutMs: number,
  samplingMode: SamplingMode,
  raceCancellation: RaceCancellation | undefined,
  onProgress: (group: string, iteration: number, isTrial: boolean) => void,
  onSampleStart?: (group: string, iteration: number, isTrial: boolean) => void,
): Promise<PairSampleResult<TSample>[]> {
  const shuffled = [...groups];
  shuffle(shuffled);
  const navigationBarrier = samplingMode === 'simultaneous'
    ? createBarrier(groups.length)
    : undefined;

  const sampleOne = async (group: string): Promise<PairSampleResult<TSample>> => {
    const sampler = samplerSet[group];
    onSampleStart?.(group, iteration, isTrial);
    try {
      const sample = await sampleWithTimeout(
        sampler, iteration, isTrial, sampleTimeoutMs, raceCancellation, navigationBarrier
      );
      onProgress(group, iteration, isTrial);
      return { group, sample };
    } catch (err) {
      navigationBarrier?.abort(err);
      throw err;
    }
  };

  if (samplingMode === 'sequential') {
    const results: PairSampleResult<TSample>[] = [];
    for (const group of shuffled) {
      results.push(await sampleOne(group));
    }
    return results;
  }

  const settled = await Promise.allSettled(shuffled.map(sampleOne));
  const rejections = settled.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );
  if (rejections.length > 0) {
    throw rejections[0].reason;
  }
  return settled.map(
    (r) => (r as PromiseFulfilledResult<PairSampleResult<TSample>>).value
  );
}

function createBarrier(participantCount: number): NavigationBarrier {
  if (participantCount <= 1) {
    return {
      wait: () => Promise.resolve(),
      abort: () => undefined,
    };
  }

  let waiting = 0;
  let released = false;
  let rejected = false;
  let release: () => void = () => undefined;
  let rejectReady: (reason: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    release = resolve;
    rejectReady = reject;
  });

  return {
    async wait() {
      if (!released && !rejected) {
        waiting += 1;
        if (waiting === participantCount) {
          released = true;
          release();
        }
      }
      await ready;
    },
    abort(reason: unknown) {
      if (released || rejected) return;
      rejected = true;
      rejectReady(reason);
    },
  };
}

function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
