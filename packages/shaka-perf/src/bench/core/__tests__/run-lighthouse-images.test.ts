/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RunnerResult } from 'lighthouse';
import { runLighthouse } from '../run-lighthouse';
import { runPatchedLighthouse } from '../patched-lighthouse';

jest.mock('../patched-lighthouse', () => ({ runPatchedLighthouse: jest.fn() }));
jest.mock('../extract-markers', () => ({
  extractLcpRawTraceTimestamp: () => null,
  extractTestAnnotationMarks: () => [],
}));
jest.mock('../network-activity', () => ({
  saveNetworkActivity: () => 2048,
  analyzeNetworkResources: () => [],
}));
jest.mock('../main-thread-tasks', () => ({ countMainThreadTasks: () => 3 }));

const config = { minRatio: 0.9, maxRatio: 2, failOnUndersized: false };

function result(artifact: unknown): RunnerResult {
  return {
    artifacts: { Trace: { traceEvents: [] }, DevtoolsLog: [], ShakaImageResolution: artifact },
    lhr: {
      categories: { performance: { score: 0.9 } },
      audits: Object.fromEntries([
        'first-contentful-paint', 'speed-index', 'largest-contentful-paint',
        'total-blocking-time', 'cumulative-layout-shift', 'server-response-time',
      ].map(id => [id, { numericValue: 100 }])),
    },
  } as unknown as RunnerResult;
}

it.each([undefined, new Error('browser context closed')])('keeps speed metrics when image gathering is unavailable (%s)', async artifact => {
  jest.mocked(runPatchedLighthouse).mockResolvedValue(result(artifact));
  const sample = await runLighthouse('experiment', 'https://example.test', {}, '.', false, Promise.resolve(), config);
  expect(sample.phases).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'LCP', duration: 100_000 }),
    expect.objectContaining({ phase: 'LH Score', duration: 90 }),
  ]));
  expect(sample).toMatchObject({ imageResolution: {
    status: 'unavailable', failOnUndersized: false, reason: expect.any(String),
  } });
});

it('retains strict policy on a whole-check failure for the report and CLI', async () => {
  jest.mocked(runPatchedLighthouse).mockResolvedValue(result(new Error('browser context closed')));
  const sample = await runLighthouse('experiment', 'https://example.test', {}, '.', false,
    Promise.resolve(), { ...config, failOnUndersized: true });
  expect(sample).toMatchObject({ imageResolution: { status: 'unavailable', failOnUndersized: true } });
  expect(sample.phases.length).toBeGreaterThan(0);
});

it('does not invent an image check for comparison runs', async () => {
  jest.mocked(runPatchedLighthouse).mockResolvedValue(result(undefined));
  const sample = await runLighthouse('experiment', 'https://example.test', {}, '.', false);
  expect(sample).not.toHaveProperty('imageResolution');
});
