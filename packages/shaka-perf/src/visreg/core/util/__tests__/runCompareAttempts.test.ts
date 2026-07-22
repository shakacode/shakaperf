/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';

// The real implementations pull in Playwright; the loop takes them as injected
// deps, so stub the module-load defaults out — every test passes its own fakes.
jest.mock('../preparePage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../createComparisonSide', () => ({ createComparisonSide: jest.fn() }));

import { runCompareAttempts, type CompareAttemptsDeps, type CompareSelectorOutcome } from '../runCompareAttempts';
import { ScreenshotPool } from '../screenshotPool';
import type { DecoratedCompareConfig, Scenario, Viewport, Browser } from '../../types';

// Solid-colour PNG; `dirtyPixels` flips the first N pixels to white so two
// otherwise-identical frames differ by a controllable number of pixels.
function png(rgb: [number, number, number], dirtyPixels = 0): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 16; i++) {
    const o = i * 4;
    const dirty = i < dirtyPixels;
    image.data[o] = dirty ? 255 : rgb[0];
    image.data[o + 1] = dirty ? 255 : rgb[1];
    image.data[o + 2] = dirty ? 255 : rgb[2];
    image.data[o + 3] = 255;
  }
  return PNG.sync.write(image);
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const GREEN: [number, number, number] = [0, 255, 0];

type Produce = (attempt: number, side: 'ref' | 'test') => Buffer | null;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-attempts-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): DecoratedCompareConfig {
  return {
    _fileNameTemplate: 'frame_{selectorIndex}',
    _outputFileFormatSuffix: '.png',
    _configId: 'cfg',
    _controlScreenshotPath: path.join(root, 'control_screenshots'),
    _experimentScreenshotPath: path.join(root, 'experiment_screenshots'),
    compareRetries: 2,
    compareRetryDelay: 10,
    maxNumDiffPixels: 0,
    mismatchThreshold: 0.1,
    requireSameDimensions: true,
    comparePixelmatchThreshold: 0.1,
    ...overrides,
  } as unknown as DecoratedCompareConfig;
}

/**
 * Fakes for the injected deps. `captureScreenshot` is called ref-then-test per
 * attempt for the single 'document' selector, so call index N maps to
 * attempt=floor(N/2), side=even?ref:test.
 */
function makeDeps(produce: Produce) {
  let captureCalls = 0;
  let created = 0;
  let disposed = 0;
  const sleeps: number[] = [];

  const createSide = jest.fn(async () => {
    created++;
    return { page: {} as never, context: {} as never, dispose: async () => { disposed++; } };
  });
  const preparePage = jest.fn(async () => ({
    visregSelectorsExp: ['document'],
    visregSelectorsExpMap: { document: {} as { filePath?: string } },
  }));
  const captureScreenshot = jest.fn(async () => {
    const idx = captureCalls++;
    return produce(Math.floor(idx / 2), idx % 2 === 0 ? 'ref' : 'test');
  });

  const deps: CompareAttemptsDeps = {
    captureScreenshot,
    createSide,
    preparePage: preparePage as unknown as CompareAttemptsDeps['preparePage'],
    sleep: async (ms: number) => { sleeps.push(ms); },
  };
  return { deps, sleeps, createSide, counts: () => ({ created, disposed, captureCalls }) };
}

function run(deps: CompareAttemptsDeps, config: DecoratedCompareConfig): Promise<CompareSelectorOutcome[]> {
  const scenario = { label: 'S', url: 'http://x/test', referenceUrl: 'http://x/ref' } as unknown as Scenario;
  const viewport = { label: 'desktop', vIndex: 0 } as unknown as Viewport;
  return runCompareAttempts(deps, {
    browser: {} as unknown as Browser,
    config, viewport, scenario,
    variantOrScenarioLabelSafe: 'S', scenarioLabelSafe: 'S',
    pixelmatchThreshold: 0.1,
  });
}

it('attempt 0 clean match: passes without retrying, not flagged saved-by-retries', async () => {
  const { deps, sleeps, counts } = makeDeps(() => png(BLUE));
  const outcomes = await run(deps, makeConfig());

  expect(outcomes).toHaveLength(1);
  expect(outcomes[0].result.pass).toBe(true);
  expect(outcomes[0].savedByRetries).toBe(false);
  // One attempt only: two fresh sides built and torn down, no backoff sleeps.
  expect(counts()).toEqual({ created: 2, disposed: 2, captureCalls: 2 });
  expect(sleeps).toEqual([]);
});

it('mismatch then match on retry: passes and is flagged saved-by-retries', async () => {
  const { deps, sleeps, counts } = makeDeps((attempt, side) =>
    attempt === 0 ? png(side === 'ref' ? RED : BLUE) : png(GREEN));
  const outcomes = await run(deps, makeConfig());

  expect(outcomes[0].result.pass).toBe(true);
  expect(outcomes[0].savedByRetries).toBe(true);
  // Two attempts, each with its OWN fresh pair (created === disposed === 4).
  expect(counts()).toMatchObject({ created: 4, disposed: 4 });
  expect(sleeps).toEqual([10]); // one backoff before the single retry
});

it('persistent mismatch: spends the retry budget, returns the closest pair with a diff', async () => {
  // Distinct frames per attempt (dirty=attempt) so the pool grows; ref stays
  // red-ish, test blue-ish, so nothing ever matches.
  const { deps, sleeps, counts } = makeDeps((attempt, side) =>
    side === 'ref' ? png(RED, attempt) : png(BLUE, attempt));
  const outcomes = await run(deps, makeConfig({ compareRetries: 2 }));

  expect(outcomes[0].result.pass).toBe(false);
  expect(outcomes[0].result.diffBuffer).not.toBeNull();
  expect(outcomes[0].refFrame).not.toBeNull();
  // 3 attempts (0 + 2 retries): fresh sides each, all disposed. Backoff 10, 20.
  expect(counts()).toMatchObject({ created: 6, disposed: 6 });
  expect(sleeps).toEqual([10, 20]);
});

it('stops early once no new frames are captured (pixel-stable mismatch)', async () => {
  // Same mismatching pair every attempt → content-addressed pool never grows
  // past the first, so retrying can't help; bail after the first retry.
  const { deps, counts } = makeDeps((_attempt, side) => png(side === 'ref' ? RED : BLUE));
  const outcomes = await run(deps, makeConfig({ compareRetries: 5 }));

  expect(outcomes[0].result.pass).toBe(false);
  // attempt 0 + one retry that added nothing new, then stop — not all 5 retries.
  expect(counts().created).toBe(4);
});

// Crash-resume: the loop derives its pool from the config's screenshot dirs and
// the filename template ('frame_{selectorIndex}' → key 'frame_0'), so seeding
// that pool is exactly what an earlier crashed attempt leaves behind.
function seedPoolFrame(side: 'control' | 'experiment', buffer: Buffer): void {
  new ScreenshotPool(
    path.join(root, 'control_screenshots'),
    path.join(root, 'experiment_screenshots'),
    'frame_0',
  ).add(side, buffer);
}

it('resumes from a frame persisted by an earlier (crashed) attempt', async () => {
  // The crashed attempt captured GREEN on the experiment side. This run's
  // fresh pair mismatches (ref GREEN vs test BLUE), but the fresh ref matches
  // the resumed experiment frame — a pass with no retries spent.
  seedPoolFrame('experiment', png(GREEN));
  const { deps, sleeps, counts } = makeDeps((_attempt, side) => png(side === 'ref' ? GREEN : BLUE));
  const outcomes = await run(deps, makeConfig());

  expect(outcomes[0].result.pass).toBe(true);
  // Matched via an accumulated frame, not a clean first capture.
  expect(outcomes[0].savedByRetries).toBe(true);
  expect(counts()).toEqual({ created: 2, disposed: 2, captureCalls: 2 });
  expect(sleeps).toEqual([]);
});

it('missing selector throws, with the attempt sides still disposed', async () => {
  const { deps, counts } = makeDeps((_attempt, side) => (side === 'ref' ? null : png(BLUE)));

  await expect(run(deps, makeConfig())).rejects.toThrow('Selector "document" not found on reference page');
  expect(counts()).toMatchObject({ created: 2, disposed: 2 });
});
