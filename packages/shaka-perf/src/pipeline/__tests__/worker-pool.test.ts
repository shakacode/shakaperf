/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { attachLatestTestAnnotation } from '../../test-annotation';
import { StageFailureError } from '../../stage/stage-failure';
import type { ArtifactPath } from '../artifact-store';
import { WorkerPool, type PoolWorkerState, type WorkerTaskProgressSink } from '../worker-pool';

type TestWorkerState = PoolWorkerState & {
  count?: number;
  token?: string;
};

describe('WorkerPool worker state ownership', () => {
  function createPoolForStage(currentStageName: () => string): WorkerPool {
    const noop = () => undefined;
    const progressSink: WorkerTaskProgressSink & { readonly stageName: string } = {
      get stageName() {
        return currentStageName();
      },
      onTaskSubmitted: noop,
      onTaskStarted: noop,
      onTaskSettled: noop,
      onTaskFailed: noop,
    };
    return new WorkerPool(1, {
      currentTaskProgress: () => progressSink,
    });
  }

  it('reuses disposable worker state for tasks from the same stage', async () => {
    let stageName = 'perf';
    const pool = createPoolForStage(() => stageName);
    const dispose = jest.fn();

    const increment = () => pool.submit(async (state) => {
      const workerState = pool.getWorkerState<TestWorkerState>(state, dispose);
      workerState.count = (workerState.count ?? 0) + 1;
      return workerState.count;
    });

    await expect(increment()).resolves.toBe(1);
    await expect(increment()).resolves.toBe(2);
    expect(dispose).not.toHaveBeenCalled();

    await pool.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes disposable worker state before running a different stage task', async () => {
    let stageName = 'perf';
    const pool = createPoolForStage(() => stageName);
    const dispose = jest.fn();

    const firstState = await pool.submit(async (state) => {
      const workerState = pool.getWorkerState<TestWorkerState>(state, dispose);
      workerState.token = 'perf-state';
      return workerState;
    });

    stageName = 'build_annotated_timeline';
    const secondState = await pool.submit(async (state) => state as TestWorkerState);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(firstState);
    expect(secondState).not.toBe(firstState);
    expect(secondState.token).toBeUndefined();

    await pool.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('logs the latest test annotation on failed attempts', async () => {
    const stageName = 'visreg';
    const pool = createPoolForStage(() => stageName);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = new Error('Failed while waiting for the validation result');
    err.stack = [
      'Error: Failed while waiting for the validation result',
      '    at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)',
    ].join('\n');
    attachLatestTestAnnotation(err, 'Submit cart');

    try {
      await expect(pool.submit(async () => {
        throw err;
      })).rejects.toThrow(/worker 0 exhausted/);

      const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Error: Failed while waiting for the validation result (latest test annotation: "Submit cart")');
      expect(output).toContain('at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)');
    } finally {
      log.mockRestore();
      await pool.dispose();
    }
  });

  it('does not repeat Playwright call logs when logging annotated stage failures', async () => {
    const stageName = 'visreg';
    const pool = createPoolForStage(() => stageName);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const cause = new Error([
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
    ].join('\n'));
    cause.stack = [
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
      '',
      '    at Object._testFn (ab-tests/cart.abtest.ts:54:16)',
    ].join('\n');
    attachLatestTestAnnotation(cause, 'adding Curly Fries');
    const err = new StageFailureError(cause, {
      media: 'cart-phone/artifacts/failure.png' as ArtifactPath,
    });

    try {
      await expect(pool.submit(async () => {
        throw err;
      })).rejects.toThrow(/worker 0 exhausted/);

      const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('StageFailureError: page.waitForSelector: Timeout 30000ms exceeded. (latest test annotation: "adding Curly Fries")');
      expect(output.match(/Call log:/g)).toHaveLength(1);
      expect(output).toContain('at Object._testFn (ab-tests/cart.abtest.ts:54:16)');
    } finally {
      log.mockRestore();
      await pool.dispose();
    }
  });
});
