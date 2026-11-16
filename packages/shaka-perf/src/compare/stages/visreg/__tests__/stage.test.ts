/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createVisregStage } from '../../visreg';
import { resetVisregScreenshots, runVisregUnit } from '../run';
import { WorkerPool } from '../../../../pipeline/worker-pool';
import type { TestContext } from '../../../../stage/stage';

jest.mock('../run', () => ({ runVisregUnit: jest.fn(), resetVisregScreenshots: jest.fn() }));

it('resets screenshots once across a worker retry', async () => {
  const ctx = {
    testAndViewportId: 'homepage-desktop',
    artifacts: { dir: '/homepage-desktop/artifacts' },
  } as unknown as TestContext;
  const pool = new WorkerPool(1, { limits: { timeoutMs: 0, retries: 1, retryDelay: 0 } });
  jest.mocked(runVisregUnit)
    .mockRejectedValueOnce(new Error('temporary page error'))
    .mockResolvedValueOnce([]);
  try {
    await createVisregStage({} as never).run(ctx, pool);
    expect(resetVisregScreenshots).toHaveBeenCalledTimes(1);
    expect(resetVisregScreenshots).toHaveBeenCalledWith(ctx.artifacts.dir);
    expect(jest.mocked(resetVisregScreenshots).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(runVisregUnit).mock.invocationCallOrder[0]!);
    expect(runVisregUnit).toHaveBeenCalledTimes(2);
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
