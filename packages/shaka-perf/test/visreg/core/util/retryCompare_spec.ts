/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const REF_IMG1 = path.join(__dirname, 'compare/refImage-1.png');
const REF_IMG2 = path.join(__dirname, 'compare/refImage-2.png');

import retryCompareOriginal from '../../../../src/visreg/core/util/retryCompare';
// Test mocks don't implement full Playwright interfaces — loosen the input type.
const retryCompare = retryCompareOriginal as unknown as (options: Record<string, unknown>) => ReturnType<typeof retryCompareOriginal>;

const mockPreparePage = async function () { };

function createMockPage(props?: Record<string, unknown>) {
  return Object.assign({ setViewport: async () => {}, setViewportSize: async () => {} }, props);
}

/**
 * captureScreenshot mock returning per-role buffer sequences. retryCompare
 * captures the test page then the ref page each retry; a role's last buffer
 * repeats once its sequence is exhausted.
 */
function sequencedCapture(byRole: { ref: Buffer[]; test: Buffer[] }) {
  const idx = { ref: 0, test: 0 };
  return async (page: { isRef?: boolean }) => {
    const role: 'ref' | 'test' = page.isRef ? 'ref' : 'test';
    const seq = byRole[role];
    const buf = seq[Math.min(idx[role], seq.length - 1)] ?? null;
    idx[role]++;
    return buf;
  };
}

jest.setTimeout(10000);

describe('retryCompare (pooled, crash-resumable)', function () {
  const buf1 = fs.readFileSync(REF_IMG1);
  const buf2 = fs.readFileSync(REF_IMG2);
  const img3 = PNG.sync.read(buf1);
  for (let i = 0; i < 1000; i++) img3.data[i * 4] = 128;
  const buf3 = PNG.sync.write(img3);

  const baseScenario = { label: 'Test Scenario', url: 'http://test.example.com', referenceUrl: 'http://ref.example.com' };
  const baseConfig = { compareRetries: 0, compareRetryDelay: 10, maxNumDiffPixels: 0 };

  let root: string;
  let controlDir: string;
  let experimentDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'retrycompare-'));
    controlDir = path.join(root, 'control_screenshots');
    experimentDir = path.join(root, 'experiment_screenshots');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function call(overrides: Record<string, unknown>) {
    return retryCompare({
      captureScreenshot: sequencedCapture({ ref: [buf1], test: [buf1] }),
      preparePage: mockPreparePage,
      refPage: createMockPage({ isRef: true }),
      testPage: createMockPage({ isTest: true }),
      selector: 'body',
      selectorMap: {},
      viewport: { width: 800, height: 600 },
      config: baseConfig,
      scenario: baseScenario,
      initialRefBuffer: buf1,
      initialTestBuffer: buf1,
      refBrowserOrContext: {},
      testBrowserOrContext: {},
      controlDir,
      experimentDir,
      poolKey: 'k',
      ...overrides,
    });
  }

  it('passes a clean first-capture match without flagging savedByRetries', async function () {
    const result = await call({ initialRefBuffer: buf1, initialTestBuffer: buf1 });
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.savedByRetries, false);
    assert.strictEqual(result.diffBuffer, null);
  });

  it('fails with no retries when the initial pair mismatches, returning a diff', async function () {
    const result = await call({ initialRefBuffer: buf1, initialTestBuffer: buf2, config: { ...baseConfig, compareRetries: 0 } });
    assert.strictEqual(result.pass, false);
    assert.ok(result.diffBuffer, 'expected a diff buffer for the closest pair');
  });

  it('passes when a retry captures a test frame matching an accumulated ref', async function () {
    // initial mismatch (buf1 vs buf2); retried test frame becomes buf1 → matches.
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 1 },
      captureScreenshot: sequencedCapture({ ref: [buf1], test: [buf1] }),
    });
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.savedByRetries, true);
  });

  it('passes when a retry captures a ref frame matching an accumulated experiment', async function () {
    // initial mismatch; retried ref frame becomes buf2 → matches initial test.
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 1 },
      captureScreenshot: sequencedCapture({ ref: [buf2], test: [buf3] }),
    });
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.savedByRetries, true);
  });

  it('gives up after exhausting retries on a persistent mismatch, returning the closest pair + diff', async function () {
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 2 },
      captureScreenshot: sequencedCapture({ ref: [buf1, buf1], test: [buf3, buf3] }),
    });
    assert.strictEqual(result.pass, false);
    assert.ok(result.diffBuffer);
  });

  it('respects scenario-level compareRetries overrides', async function () {
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 0 },
      scenario: { ...baseScenario, compareRetries: 1 },
      captureScreenshot: sequencedCapture({ ref: [buf1], test: [buf1] }),
    });
    assert.strictEqual(result.pass, true);
  });

  it('passes when diff pixels are within maxNumDiffPixels', async function () {
    const result = await call({ initialRefBuffer: buf1, initialTestBuffer: buf3, config: { ...baseConfig, maxNumDiffPixels: 100000 } });
    assert.strictEqual(result.pass, true);
  });

  it('handles null captures on retry without crashing', async function () {
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 2 },
      captureScreenshot: sequencedCapture({ ref: [], test: [] }), // always null
    });
    assert.strictEqual(result.pass, false);
  });

  it('resumes from frames persisted by an earlier (crashed) attempt', async function () {
    // Pre-seed the pool as if an earlier attempt had captured buf2 on the
    // experiment side, then crashed.
    const { ScreenshotPool } = await import('../../../../src/visreg/core/util/screenshotPool');
    new ScreenshotPool(controlDir, experimentDir, 'k').add('experiment', buf2);
    // This attempt's fresh ref capture is buf2 → matches the resumed frame.
    const result = await call({ initialRefBuffer: buf2, initialTestBuffer: buf1, config: { ...baseConfig, compareRetries: 0 } });
    assert.strictEqual(result.pass, true);
    // Matched via accumulated frames, not a clean first capture.
    assert.strictEqual(result.savedByRetries, true);
  });

  it('calls preparePage before capturing on each retry', async function () {
    const calls: string[] = [];
    const tracking = async () => { calls.push('prepare'); };
    await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 1 },
      preparePage: tracking,
      captureScreenshot: async (page: { isRef?: boolean }) => { calls.push(page.isRef ? 'capture-ref' : 'capture-test'); return buf3; },
    });
    const firstCapture = calls.indexOf('capture-test');
    assert.ok(calls.indexOf('prepare') >= 0 && calls.indexOf('prepare') < firstCapture, 'preparePage should run before capture');
  });

  it('continues retrying when preparePage throws', async function () {
    let prepareCalls = 0;
    const flaky = async () => { prepareCalls++; if (prepareCalls === 1) throw new Error('nav failed'); };
    const result = await call({
      initialRefBuffer: buf1, initialTestBuffer: buf2,
      config: { ...baseConfig, compareRetries: 2 },
      preparePage: flaky,
      captureScreenshot: sequencedCapture({ ref: [buf1], test: [buf1] }),
    });
    assert.ok(prepareCalls >= 1);
    assert.strictEqual(result.pass, true); // recovered on the 2nd retry
  });
});
