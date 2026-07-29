/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { closeSync } from 'node:fs';
import { throwIfCancelled } from 'race-cancellation';

import type { RaceCancellation } from 'race-cancellation';
import type {
  Benchmark,
  BenchmarkSamplingPool,
  BenchmarkSampler,
  SamplingMode,
} from './run';
import { WorkerPool, type PoolWorkerState } from '../../pipeline/worker-pool';
import { withLogPrefix } from '../../visreg/core/util/testContext';
import { formatLogPrefix, type Group } from '../../pipeline/log-prefix-format';
import { socketpair } from './socketpair';

type SamplerSet<TSample> = { [group: string]: BenchmarkSampler<TSample> };

export interface PairSampleResult<TSample> {
  group: Group;
  sample: TSample;
}

export interface LighthouseSamplingTask<TSample> {
  testKey: string;
  benchmarks: Benchmark<TSample>[];
  sampleIndex: number;
}

interface WorkerState<TSample> {
  samplerSet: SamplerSet<TSample> | null;
  samplingMode: SamplingMode | null;
  groupsKey: string | null;
  /**
   * Measurements completed on the current `samplerSet` since it was forked.
   * Compared against {@link MEASUREMENTS_BEFORE_RESTART} in
   * {@link ensureWorkerSamplers} to decide whether to recycle the worker
   * subprocesses before the next task.
   */
  measurementsSinceRestart: number;
}

// LH worker subprocesses observed growing to >1 GB RSS over a long bench run
// (no per-measurement growth rate measured — just that the slope is high
// enough to matter on big runs). Lighthouse isn't designed for repeated
// in-process invocation, and the single reused Chrome instance accumulates
// its own state across navigations. Recycling on this cadence bounds peak
// RSS per worker; both the Node subprocess and its Chrome get torn down
// together via `disposeSamplerSet` → `OOPLighthouseSampler.dispose()`.
//
// The recycle happens in-line at the top of the threshold-crossing task
// (inside `ensureWorkerSamplers`, before `runOneShuffledPair` runs), so it
// extends that task's wall time by the fork+launch budget but does NOT
// overlap a measurement — the timings being recorded are uncontaminated.
//
// No runtime override: tune by editing this constant.
const MEASUREMENTS_BEFORE_RESTART = 10;

export interface LighthouseSamplingOptions {
  samplingMode: SamplingMode;
}

export interface LighthouseSamplingPool<TSample> extends BenchmarkSamplingPool<TSample> {
  onSampleStart?: (testKey: string, group: Group, sampleIndex: number) => void;
}

interface LighthouseWorkerState<TSample> extends PoolWorkerState {
  lighthouse?: WorkerState<TSample>;
}

export function createWorkerLighthouseSamplingPool<TSample>(
  workerPool: WorkerPool,
  options: LighthouseSamplingOptions,
): LighthouseSamplingPool<TSample> {
  const pool: LighthouseSamplingPool<TSample> = {
    submitPair(task) {
      return workerPool.submit(
        (state, raceCancellation) =>
          runTask(workerPool, state, task, options, raceCancellation, pool.onSampleStart),
        task.testKey,
      );
    },
    cancelTest(testKey, reason) {
      workerPool.cancel(testKey, reason);
    },
  };
  return pool;
}

async function runTask<TSample>(
  workerPool: WorkerPool,
  state: PoolWorkerState,
  task: LighthouseSamplingTask<TSample>,
  options: LighthouseSamplingOptions,
  raceCancellation: RaceCancellation,
  onSampleStart?: (testKey: string, group: Group, sampleIndex: number) => void,
): Promise<PairSampleResult<TSample>[]> {
  const samplerSet = await ensureWorkerSamplers(workerPool, state, task, options, raceCancellation);
  const worker = currentWorkerState<TSample>(workerPool, state);
  try {
    return await withLogPrefix(
      `sample-${task.sampleIndex}`,
      () => runOneShuffledPair(
        samplerSet,
        task.benchmarks,
        task.sampleIndex,
        state.workerIndex,
        options.samplingMode,
        raceCancellation,
        onSampleStart
          ? (group, sampleIndex) => onSampleStart(task.testKey, group, sampleIndex)
          : undefined,
      ),
    );
  } finally {
    // Count both successful and failed measurements: a measurement that errored
    // didn't somehow leave the worker leaner, and the bloat is what we're
    // bounding here, not "useful work done".
    worker.measurementsSinceRestart += 1;
  }
}

async function ensureWorkerSamplers<TSample>(
  workerPool: WorkerPool,
  state: PoolWorkerState,
  task: LighthouseSamplingTask<TSample>,
  options: LighthouseSamplingOptions,
  raceCancellation: RaceCancellation,
): Promise<SamplerSet<TSample>> {
  const worker = currentWorkerState<TSample>(workerPool, state);
  const taskGroupsKey = groupsKeyFor(task.benchmarks);
  if (
    worker.samplerSet &&
    worker.samplingMode === options.samplingMode &&
    worker.groupsKey === taskGroupsKey &&
    worker.measurementsSinceRestart < MEASUREMENTS_BEFORE_RESTART
  ) {
    return worker.samplerSet;
  }
  await disposeCurrentWorkerState<TSample>(workerPool, state);
  const samplerSet: SamplerSet<TSample> = {};
  await setupSamplers(
    task.benchmarks,
    samplerSet,
    raceCancellation,
    barrierSynchronizationFdsFor(task.benchmarks.length),
    options.samplingMode,
  );
  worker.samplerSet = samplerSet;
  worker.samplingMode = options.samplingMode;
  worker.groupsKey = taskGroupsKey;
  worker.measurementsSinceRestart = 0;
  return samplerSet;
}

function currentWorkerState<TSample>(
  workerPool: WorkerPool,
  state: PoolWorkerState,
): WorkerState<TSample> {
  const workerState = workerPool.getWorkerState<LighthouseWorkerState<TSample>>(state, disposeLighthouseState);
  workerState.lighthouse ??= {
    samplerSet: null,
    samplingMode: null,
    groupsKey: null,
    measurementsSinceRestart: 0,
  };
  return workerState.lighthouse;
}

async function disposeCurrentWorkerState<TSample>(
  workerPool: WorkerPool,
  state: PoolWorkerState,
): Promise<void> {
  const workerState = currentWorkerState<TSample>(workerPool, state);
  const { samplerSet } = workerState;
  if (!samplerSet) return;
  workerState.samplerSet = null;
  workerState.samplingMode = null;
  workerState.groupsKey = null;
  workerState.measurementsSinceRestart = 0;
  await disposeSamplerSet(samplerSet);
}

async function disposeLighthouseState(state: Record<string, unknown>): Promise<void> {
  const lighthouse = (state as LighthouseWorkerState<unknown>).lighthouse;
  if (!lighthouse?.samplerSet) return;
  const { samplerSet } = lighthouse;
  lighthouse.samplerSet = null;
  lighthouse.samplingMode = null;
  lighthouse.groupsKey = null;
  lighthouse.measurementsSinceRestart = 0;
  await disposeSamplerSet(samplerSet);
}

async function setupSamplers<TSample>(
  benchmarks: Benchmark<TSample>[],
  samplers: SamplerSet<TSample>,
  raceCancellation: RaceCancellation,
  barrierSynchronizationFds: readonly number[],
  samplingMode: SamplingMode,
): Promise<void> {
  // allSettled (not all): once one sibling rejects, the others are still
  // in flight. Promise.all would surface the first rejection immediately
  // and the catch would dispose `samplers` while the survivor was still
  // launching Chrome — its eventual `samplers[group] = sampler` would land
  // past cleanup, leaking a Chrome subprocess + tmp userDataDir.
  const results = await Promise.allSettled(
    benchmarks.map(async (benchmark, index) => {
      samplers[benchmark.group] = throwIfCancelled(
        await benchmark.setup(raceCancellation, barrierSynchronizationFds[index], samplingMode),
      );
    }),
  );
  const firstFailure = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (!firstFailure) return;
  try {
    await disposeSamplerSet(samplers);
  } catch (disposeErr) {
    console.error('Failed to dispose partial samplers after setup failure:', disposeErr);
  }
  throw firstFailure.reason;
}

function barrierSynchronizationFdsFor(count: number): readonly number[] {
  const pair = socketpair();
  if (count === 1) {
    closeSync(pair[1]);
    return [pair[0]];
  }
  return pair;
}

async function disposeSamplerSet<TSample>(
  samplerSet: SamplerSet<TSample>
): Promise<void> {
  // allSettled (not all): we MUST call `dispose()` on every sampler so each
  // subprocess + Chrome gets its SIGTERM/SIGKILL escalation, even if a
  // sibling rejects. Promise.all would return on the first rejection while
  // siblings were still mid-dispose — the caller would then proceed to
  // re-setup or treat the worker as gone, and any dispose that later threw
  // would surface as an unhandled rejection with no caller to report it.
  const results = await Promise.allSettled(
    Object.values(samplerSet).map((sampler) => sampler.dispose()),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (failures.length === 0) return;
  if (failures.length === 1) {
    const reason = failures[0].reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  const messages = failures
    .map((f) => f.reason instanceof Error ? f.reason.message : String(f.reason))
    .join('; ');
  throw new Error(`${failures.length} samplers failed to dispose: ${messages}`);
}

async function runOneShuffledPair<TSample>(
  samplerSet: SamplerSet<TSample>,
  benchmarks: Benchmark<TSample>[],
  sampleIndex: number,
  workerIndex: number,
  samplingMode: SamplingMode,
  raceCancellation: RaceCancellation,
  onSampleStart?: (group: Group, sampleIndex: number) => void,
): Promise<PairSampleResult<TSample>[]> {
  const benchmarkByGroup = new Map(benchmarks.map((benchmark) => [benchmark.group, benchmark]));
  const groups = benchmarks.map((benchmark) => benchmark.group);
  const shuffled = [...groups];
  shuffle(shuffled);

  const sampleOne = (group: Group): Promise<PairSampleResult<TSample>> =>
    withLogPrefix(formatLogPrefix(group), async () => {
      const benchmark = benchmarkByGroup.get(group);
      if (!benchmark) throw new Error(`Missing benchmark for group "${group}"`);
      const sampler = samplerSet[group];
      if (!sampler) throw new Error(`Missing Lighthouse sampler for group "${group}"`);
      onSampleStart?.(group, sampleIndex);
      const sample = await sampler.sample(benchmark.sampleState, sampleIndex, workerIndex, raceCancellation);
      return { group, sample };
    });

  if (samplingMode === 'sequential') {
    const results: PairSampleResult<TSample>[] = [];
    for (const group of shuffled) {
      results.push(await sampleOne(group));
    }
    return results;
  }
  return Promise.all(shuffled.map(sampleOne));
}

export function lighthouseSamplerReuseKey<TSample>(
  benchmarks: Array<Pick<Benchmark<TSample>, 'group' | 'workerReuseKey'>>,
): string {
  return benchmarks
    .map((benchmark) => `${benchmark.group}\0${benchmark.workerReuseKey ?? ''}`)
    .sort()
    .join('\0');
}

function groupsKeyFor<TSample>(benchmarks: Benchmark<TSample>[]): string {
  return lighthouseSamplerReuseKey(benchmarks);
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
