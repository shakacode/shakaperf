/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { attachLatestTestAnnotation } from '../../test-annotation';
import { StageFailureError } from '../../stage/stage-failure';
import type { ArtifactPath } from '../artifact-store';
import type { RaceCancellation } from 'race-cancellation';
import { WorkerPool, type PoolWorkerState, type TaskLimits, type WorkerTaskProgressSink } from '../worker-pool';

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
      // These tests are about worker-state ownership, not budgets: no cap, and
      // a single attempt so a failure surfaces instead of being retried away.
      limits: { timeoutMs: 0, retries: 0, retryDelay: 0 },
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

describe('WorkerPool per-task limits', () => {
  // Regression: the pool used to know one set of budgets, taken from the FILE
  // config, so a test's own `shared.timeoutMs` / `retries` / `retryDelay` were
  // validated, merged into its effective config, and then dropped on the floor.
  // The runner now publishes the unit's whole `TaskLimits` through
  // `currentTaskLimits`, read once at submit time.
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const limits = (over: Partial<TaskLimits> = {}): TaskLimits =>
    ({ timeoutMs: 0, retries: 0, retryDelay: 0, ...over });

  // The task must COOPERATE with the pool's cancellation. A task that ignores it
  // gets a 15s grace window to finish on its own, and one that finishes inside
  // that window still succeeds — so an uncooperative sleep would prove nothing
  // and cost 15s. `raceCancellation` is exactly what real stages thread through.
  const cancellableWork = (raceCancellation: RaceCancellation) =>
    raceCancellation(() => sleep(10_000));

  // `raceCancellation` RESOLVES with a Cancellation marker rather than throwing,
  // and that marker quotes the cap that fired — so it names which of the two
  // budgets won, which is the whole point of these tests.
  const cancelReason = async (pool: WorkerPool): Promise<string> => {
    const outcome = await pool.submit(
      (_state, raceCancellation) => cancellableWork(raceCancellation),
    ) as { message?: string };
    return outcome.message ?? '';
  };

  it('prefers the published timeout over the pool default', async () => {
    const pool = new WorkerPool(1, {
      limits: limits({ timeoutMs: 60_000 }),
      currentTaskLimits: () => limits({ timeoutMs: 20 }),
    });
    try {
      // 20ms cap against a 60s pool default: only the per-task cap can fire here.
      expect(await cancelReason(pool)).toBe('task timeout after 20ms');
    } finally {
      await pool.dispose();
    }
  });

  it('falls back to the pool default when nothing is published', async () => {
    const pool = new WorkerPool(1, {
      limits: limits({ timeoutMs: 20 }),
      currentTaskLimits: () => undefined,
    });
    try {
      expect(await cancelReason(pool)).toBe('task timeout after 20ms');
    } finally {
      await pool.dispose();
    }
  });

  it('does not fire when the published timeout is generous', async () => {
    const pool = new WorkerPool(1, {
      // Pool default would kill this at 20ms; the published one must win.
      limits: limits({ timeoutMs: 20 }),
      currentTaskLimits: () => limits({ timeoutMs: 60_000 }),
    });
    try {
      await expect(pool.submit(async () => {
        await sleep(120);
        return 'done';
      })).resolves.toBe('done');
    } finally {
      await pool.dispose();
    }
  });

  it('lets a published timeout of 0 disable the pool default', async () => {
    const pool = new WorkerPool(1, {
      limits: limits({ timeoutMs: 30 }),
      currentTaskLimits: () => limits({ timeoutMs: 0 }),
    });
    try {
      await expect(pool.submit(async () => {
        await sleep(120);
        return 'done';
      })).resolves.toBe('done');
    } finally {
      await pool.dispose();
    }
  });

  it('names the cap that actually fired when it poisons the task', async () => {
    // The inner cancellation always quoted the right number; the outer poison
    // error — the one that reaches the report as the failure reason — used to
    // quote the pool default instead, so a 20ms task read "exceeded its
    // 60000ms budget".
    const pool = new WorkerPool(1, {
      limits: limits({ timeoutMs: 60_000 }),
      currentTaskLimits: () => limits({ timeoutMs: 20 }),
    });
    try {
      // Surfaces its OWN rejection once cancelled, which is what a real stage
      // does (its error carries the failure screenshot). That lands on the
      // poison path immediately instead of waiting out the grace window.
      await expect(pool.submit(async (_state, raceCancellation) => {
        await cancellableWork(raceCancellation);
        throw new Error('stage aborted');
      })).rejects.toThrow('task exceeded its 20ms budget');
    } finally {
      await pool.dispose();
    }
  });

  it('retries a published number of times, not the pool default', async () => {
    const pool = new WorkerPool(1, {
      limits: limits({ retries: 0 }),
      currentTaskLimits: () => limits({ retries: 2 }),
    });
    let attempts = 0;
    try {
      // Fails twice, succeeds on the third — reachable only on the published
      // budget of 2 retries; the pool default of 0 would poison it at attempt 1.
      await expect(pool.submit(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`attempt ${attempts} fails`);
        return 'done';
      })).resolves.toBe('done');
      expect(attempts).toBe(3);
    } finally {
      await pool.dispose();
    }
  });

  it('reports the published retry budget when it is exhausted', async () => {
    const pool = new WorkerPool(1, {
      limits: limits({ retries: 9 }),
      currentTaskLimits: () => limits({ retries: 1 }),
    });
    let attempts = 0;
    try {
      await expect(pool.submit(async () => {
        attempts += 1;
        throw new Error('always fails');
      })).rejects.toThrow('exhausted 2 consecutive attempts');
      expect(attempts).toBe(2);
    } finally {
      await pool.dispose();
    }
  });
});
