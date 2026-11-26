/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { visualComparisonFields } from '../metadata';
import { createVisregStage, type VisregArtifact } from '../../visreg';
import { runVisregUnit } from '../run';
import { WorkerPool } from '../../../../pipeline/worker-pool';
import type { TestContext } from '../../../../stage/stage';

jest.mock('../run', () => ({ runVisregUnit: jest.fn() }));

it('shares measurement retry state across worker attempts', async () => {
  const ctx = {
    testAndViewportId: 'homepage-desktop',
    viewport: { label: 'desktop', width: 1000, height: 800 },
    artifacts: { dir: '/homepage-desktop/artifacts' },
  } as unknown as TestContext;
  const pool = new WorkerPool(1, { limits: { timeoutMs: 0, retries: 1, retryDelay: 0 } });
  jest.mocked(runVisregUnit)
    .mockRejectedValueOnce(new Error('temporary page error'))
    .mockResolvedValueOnce([]);
  try {
    await createVisregStage({} as never).run(ctx, pool);
    const calls = jest.mocked(runVisregUnit).mock.calls;
    expect(calls[1]![2]).toBe(calls[0]![2]);
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

it('formats selector counts without borrowing execution counts', () => {
  const artifact: VisregArtifact = {
    selector: '#checkout', controlImage: '', experimentImage: '', diffImage: null,
    misMatchPercentage: 0, diffPixels: 0, threshold: 0, diffBbox: null, savedByRetries: false,
    visualComparisonCount: 1, visualComparisonLimit: 5,
  };
  expect(visualComparisonFields(artifact)).toEqual({ selector: '#checkout', mismatch: '0.00%', 'visual comparisons': '1/5' });
  expect(visualComparisonFields({ ...artifact, visualComparisonLimit: undefined })['visual comparisons']).toBe('1');
  expect(visualComparisonFields({ ...artifact, visualComparisonCount: 3, savedByRetries: true })['visual comparisons']).toBe('3/5 · matched on retry');
  expect(visualComparisonFields({ ...artifact, visualComparisonCount: undefined, savedByRetries: true })['visual comparisons']).toBeUndefined();
  expect(visualComparisonFields({ ...artifact, visualComparisonCount: undefined })['visual comparisons']).toBeUndefined();
});

it('returns raw artifacts and saves only run-wide metadata', async () => {
  const ctx = {
    testAndViewportId: 'homepage-desktop',
    viewport: { label: 'desktop', width: 1000, height: 800 },
    artifacts: { dir: '/homepage-desktop/artifacts' },
  } as unknown as TestContext;
  const first: VisregArtifact = {
    selector: '#hero', controlImage: 'a', experimentImage: 'b', diffImage: null,
    misMatchPercentage: 0, diffPixels: 0, threshold: 0, diffBbox: null,
    savedByRetries: false, visualComparisonCount: 1, visualComparisonLimit: 3,
  };
  const second = { ...first, selector: '#features', visualComparisonCount: 2, savedByRetries: true };
  jest.mocked(runVisregUnit).mockResolvedValueOnce([first, second]);
  const pool = new WorkerPool(1, { limits: { timeoutMs: 0, retries: 0, retryDelay: 0 } });
  try {
    const { measurement, metadata } = await createVisregStage({} as never).run(ctx, pool);
    expect(metadata).toEqual({ viewport: 'desktop 1000 × 800' });
    expect(measurement).toEqual([first, second]);
  } finally {
    await pool.dispose();
  }
});
