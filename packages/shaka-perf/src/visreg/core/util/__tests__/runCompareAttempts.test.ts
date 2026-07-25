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
jest.mock('../preparePage', () => ({
  __esModule: true,
  default: jest.fn(),
  // Failure capture is tested through these injected collaborators so the
  // attempt loop can assert side choice and error metadata without Playwright.
  captureFailureScreenshot: jest.fn().mockResolvedValue(undefined),
  failureScreenshotPath: jest.fn().mockReturnValue('/tmp/failure.png'),
}));
jest.mock('../createComparisonSide', () => ({ createComparisonSide: jest.fn() }));
// The attempt loop rebuilds the test's effective config for `beforeNavigate`
// (mandatory abtests.config.ts — the real loader THROWS without one, and these
// tests run configless by design). The loop only reads `shared.beforeNavigate`.
jest.mock('../../../../effective-config', () => ({
  reconstructEffectiveConfig: jest.fn().mockResolvedValue({ shared: {} }),
}));

import { runCompareAttempts, type CompareAttemptsDeps, type CompareSelectorOutcome } from '../runCompareAttempts';
import { captureFailureScreenshot, failureScreenshotPath } from '../preparePage';
import { ScreenshotPool } from '../screenshotPool';
import type { BrowserContext, DecoratedCompareConfig, Scenario, Viewport, Browser, PlaywrightPage } from '../../types';

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

type TestSideName = 'control' | 'experiment';
type Produce = (attempt: number, side: 'ref' | 'test') => Buffer | null | Promise<Buffer | null>;
type PreparePageFn = NonNullable<CompareAttemptsDeps['preparePage']>;
type PreparePageResult = Awaited<ReturnType<PreparePageFn>>;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-attempts-'));
  jest.mocked(captureFailureScreenshot).mockClear();
  jest.mocked(failureScreenshotPath).mockReset();
  jest.mocked(failureScreenshotPath).mockImplementation((_config, _scenario, _viewport, isControl) =>
    `/tmp/failure-${isControl ? 'control' : 'experiment'}.png`);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): DecoratedCompareConfig {
  return {
    env: {
      controlScreenshotDir: path.join(root, 'control_screenshots'),
      experimentScreenshotDir: path.join(root, 'experiment_screenshots'),
    },
    compareRetries: 2,
    compareRetryDelay: 10,
    maxNumDiffPixels: 0,
    mismatchThreshold: 0.1,
    comparePixelmatchThreshold: 0.1,
    ...overrides,
  } as unknown as DecoratedCompareConfig;
}

function preparedPage(): PreparePageResult {
  return {
    selectors: ['document'],
    selectorMap: { document: {} as { filePath?: string } },
  };
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
  const pages = {
    control: { side: 'control' } as unknown as PlaywrightPage,
    experiment: { side: 'experiment' } as unknown as PlaywrightPage,
  };
  const contexts = {
    control: { side: 'control' } as unknown as BrowserContext,
    experiment: { side: 'experiment' } as unknown as BrowserContext,
  };

  const createSide = jest.fn(async (...args: unknown[]) => {
    const requestedSide = args[3] === 'control' || args[3] === 'experiment'
      ? args[3] as TestSideName
      : (created % 2 === 0 ? 'control' : 'experiment');
    created++;
    return {
      side: requestedSide,
      page: pages[requestedSide],
      context: contexts[requestedSide],
      dispose: async () => { disposed++; },
    };
  });
  const preparePage = jest.fn(async () => preparedPage()) as jest.MockedFunction<PreparePageFn>;
  const captureScreenshot = jest.fn(async (
    page: PlaywrightPage,
    _selector: string,
    _selectorMap: Record<string, { filePath?: string }>,
  ) => {
    const idx = captureCalls++;
    const side = page === pages.control ? 'ref' : 'test';
    return produce(Math.floor(idx / 2), side);
  }) as jest.MockedFunction<CompareAttemptsDeps['captureScreenshot']>;

  const deps: CompareAttemptsDeps = {
    captureScreenshot,
    createSide,
    preparePage: preparePage as unknown as CompareAttemptsDeps['preparePage'],
    sleep: async (ms: number) => { sleeps.push(ms); },
  };
  return { deps, sleeps, createSide, preparePage, pages, counts: () => ({ created, disposed, captureCalls }) };
}

function run(deps: CompareAttemptsDeps, config: DecoratedCompareConfig): Promise<CompareSelectorOutcome[]> {
  const scenario = { label: 'S', url: 'http://x/test', referenceUrl: 'http://x/ref' } as unknown as Scenario;
  const viewport = { label: 'desktop', vIndex: 0 } as unknown as Viewport;
  return runCompareAttempts(deps, {
    browser: {} as unknown as Browser,
    config, viewport, scenario,
    scenarioLabelSafe: 'S',
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
// the engine's fixed filename scheme (scenario 'S', selector 'document',
// viewport 'desktop' → key 'S_0_document_0_desktop'), so seeding that pool is
// exactly what an earlier crashed attempt leaves behind.
function seedPoolFrame(side: 'control' | 'experiment', buffer: Buffer): void {
  new ScreenshotPool(
    path.join(root, 'control_screenshots'),
    path.join(root, 'experiment_screenshots'),
    'S_0_document_0_desktop',
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

it('captures only the side whose preparePage throws', async () => {
  const prepareError = new Error('experiment prepare failed');
  const { deps, preparePage, pages } = makeDeps(() => png(BLUE));
  preparePage.mockImplementation(async (page) => {
    if (page === pages.experiment) throw prepareError;
    return {
      selectors: ['document'],
      selectorMap: { document: {} as { filePath?: string } },
    };
  });

  await expect(run(deps, makeConfig())).rejects.toBe(prepareError);

  expect(captureFailureScreenshot).toHaveBeenCalledTimes(1);
  expect(captureFailureScreenshot).toHaveBeenCalledWith(pages.experiment, '/tmp/failure-experiment.png');
  expect(captureFailureScreenshot).not.toHaveBeenCalledWith(pages.control, expect.any(String));
});

it('does not let a throwing failureScreenshotPath mask the original prepare error', async () => {
  const prepareError = new Error('original prepare error');
  jest.mocked(failureScreenshotPath).mockImplementation(() => {
    throw new Error('path builder exploded');
  });
  const warn = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const { deps, preparePage, pages } = makeDeps(() => png(BLUE));
  preparePage.mockImplementation(async (page) => {
    if (page === pages.experiment) throw prepareError;
    return {
      selectors: ['document'],
      selectorMap: { document: {} as { filePath?: string } },
    };
  });

  await expect(run(deps, makeConfig())).rejects.toBe(prepareError);

  expect(warn).toHaveBeenCalledWith(expect.stringContaining('path builder exploded'));
  warn.mockRestore();
});

it('throws the experiment prepare error when both sides fail and logs the control error', async () => {
  const controlError = new Error('control prepare failed');
  const experimentError = new Error('experiment prepare failed');
  const warn = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const { deps, preparePage, pages } = makeDeps(() => png(BLUE));
  preparePage.mockImplementation(async (page) => {
    throw page === pages.control ? controlError : experimentError;
  });

  await expect(run(deps, makeConfig())).rejects.toBe(experimentError);

  expect(warn).toHaveBeenCalledWith(expect.stringContaining('control prepare failed'));
  expect(captureFailureScreenshot).toHaveBeenCalledTimes(2);
  expect(captureFailureScreenshot).toHaveBeenCalledWith(pages.control, '/tmp/failure-control.png');
  expect(captureFailureScreenshot).toHaveBeenCalledWith(pages.experiment, '/tmp/failure-experiment.png');
  warn.mockRestore();
});

it('captures the side whose screenshot capture rejects and attaches the failure path', async () => {
  const captureError = new Error('experiment screenshot failed');
  const { deps, pages } = makeDeps((_attempt, side) => {
    if (side === 'test') throw captureError;
    return png(BLUE);
  });

  await expect(run(deps, makeConfig())).rejects.toBe(captureError);

  expect(captureFailureScreenshot).toHaveBeenCalledTimes(1);
  expect(captureFailureScreenshot).toHaveBeenCalledWith(pages.experiment, '/tmp/failure-experiment.png');
  expect((captureError as { failureScreenshotPath?: string }).failureScreenshotPath).toBe('/tmp/failure-experiment.png');
});
