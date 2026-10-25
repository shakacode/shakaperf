/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createVisregStage } from '../../visreg';
import { runVisregUnit } from '../run';
import { WorkerPool } from '../../../../pipeline/worker-pool';
import type { TestContext } from '../../../../stage/stage';

jest.mock('../run', () => ({ runVisregUnit: jest.fn() }));

it('retains visual attempts made before a worker retry', async () => {
  const recordMeasurementOptions = jest.fn();
  const ctx = { testAndViewportId: 'homepage-desktop', recordMeasurementOptions } as unknown as TestContext;
  const pool = new WorkerPool(1, { limits: { timeoutMs: 0, retries: 1, retryDelay: 0 } });
  jest.mocked(runVisregUnit)
    .mockImplementationOnce(async (_ctx, _config, onAttempt) => {
      onAttempt();
      throw new Error('temporary page error');
    })
    .mockImplementationOnce(async (_ctx, _config, onAttempt) => {
      onAttempt();
      onAttempt();
      return [];
    });
  try {
    await createVisregStage({} as never).run(ctx, pool);
    expect(recordMeasurementOptions.mock.calls).toEqual([
      [{ compareAttempts: 1 }], [{ compareAttempts: 2 }], [{ compareAttempts: 3 }],
    ]);
  } finally {
    await pool.dispose();
  }
});

describe('visreg self-contained artifact dictionary', () => {
  it('does not strip any rendered image fields', () => {
    const stage = createVisregStage({} as never);
    expect(stage.selfContainedReportStrip).toEqual({});
  });
});
