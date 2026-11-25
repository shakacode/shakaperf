/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
jest.mock('../summarize-performance-profile', () => ({ summarizePerformanceProfile() {} }));

const runnerResult = {
  artifacts: { Trace: { traceEvents: [] }, DevtoolsLog: [] },
  report: '',
  lhr: {
    categories: { performance: { score: 0.9 } },
    audits: Object.fromEntries([
      'first-contentful-paint', 'speed-index', 'largest-contentful-paint',
      'total-blocking-time', 'cumulative-layout-shift', 'server-response-time',
    ].map((id) => [id, { numericValue: 100 }])),
  },
} as unknown as RunnerResult;
const undersized = {
  url: 'https://example.test/photo.png',
  sourceWidth: 400, sourceHeight: 400, paintedWidth: 300, paintedHeight: 300, devicePixelRatio: 2,
};

describe('runLighthouse image resolution', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-lighthouse-images-'));
    jest.mocked(runPatchedLighthouse).mockResolvedValue(runnerResult);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes the image counts with the other metrics and saves one line per image', async () => {
    const { phases } = await runLighthouse('experiment', 'https://example.test', {}, dir, true, Promise.resolve(), {
      minRatio: 0.9, maxRatio: 2, sizes: Promise.resolve([undersized]),
    });
    expect(phases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'LCP', duration: 100_000 }),
      { phase: 'undersized-images', duration: 1, start: 0, sign: 1, unit: '' },
      { phase: 'oversized-images', duration: 0, start: 0, sign: 1, unit: '' },
      { phase: 'scaled-small-images', duration: 0, start: 0, sign: 1, unit: '' },
    ]));
    expect(fs.readFileSync(path.join(dir, 'experiment_image_resolution.txt'), 'utf8'))
      .toBe('undersized   400x400 file, 600x600 needed  /photo.png\n');
  });

  it('adds nothing when no image sizes were collected', async () => {
    const { phases } = await runLighthouse('experiment', 'https://example.test', {}, dir, true);
    expect(phases.filter(({ phase }) => phase.endsWith('-images'))).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'experiment_image_resolution.txt'))).toBe(false);
  });
});
