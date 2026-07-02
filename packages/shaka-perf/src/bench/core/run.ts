/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RaceCancellation } from 'race-cancellation';
import type { Group } from '../../pipeline/log-prefix-format';

export interface Benchmark<TSample> {
  readonly group: Group;
  readonly sampleState: unknown;
  setup(
    raceCancellation: RaceCancellation,
    barrierSynchronizationFd: number,
    samplingMode: SamplingMode,
  ): Promise<BenchmarkSampler<TSample>>;
}

export interface BenchmarkSampler<TSample> {
  dispose(): Promise<void>;
  sample(
    sampleState: unknown,
    sampleIndex: number,
    workerIndex: number,
    raceCancellation: RaceCancellation,
  ): Promise<TSample>;
}

export interface SampleGroup<TSample> {
  group: Group;
  samples: TSample[];
}

export type SamplingMode = 'sequential' | 'simultaneous';

export interface RunTestOptions {
  testKey: string;
}

export interface BenchmarkSamplingPool<TSample> {
  submitPair(task: {
    testKey: string;
    benchmarks: Benchmark<TSample>[];
    sampleIndex: number;
  }): Promise<Array<{ group: Group; sample: TSample }>>;
  cancelTest(testKey: string, reason: unknown): void;
}

export async function measureTest<TSample>(
  benchmarks: Benchmark<TSample>[],
  iterations: number,
  pool: BenchmarkSamplingPool<TSample>,
  options: RunTestOptions
): Promise<SampleGroup<TSample>[]> {
  const groupedSamples = new Map<string, TSample[]>();
  const sampleGroups = benchmarks.map((benchmark) => {
    const samples: TSample[] = new Array(iterations);
    groupedSamples.set(benchmark.group, samples);
    return { group: benchmark.group, samples };
  });

  try {
    await Promise.all(
      Array.from({ length: iterations }, async (_, index) => {
        const results = await pool.submitPair({
          testKey: options.testKey,
          benchmarks,
          sampleIndex: index,
        });
        for (const { group, sample } of results) {
          groupedSamples.get(group)![index] = sample;
        }
      }),
    );
  } catch (err) {
    pool.cancelTest(options.testKey, err);
    throw err;
  }

  return sampleGroups;
}
