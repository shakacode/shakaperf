/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DEFAULT_LH_CONFIG } from '../../bench/core/lighthouse-config';
import { measurementCommand, lighthouseThrottling } from '../run-metadata';
import type { RunMetadata } from '../run-metadata';
import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from '../artifact-store';

describe('saved measurement metadata', () => {
  it('records resolved Lighthouse defaults and only active network fields', () => {
    expect(lighthouseThrottling(DEFAULT_LH_CONFIG)).toEqual({ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4, network: { rttMs: 150, throughputKbps: 1638.4 } });
  });

  it('records provided Lighthouse measurements without inventing emulation settings', () => {
    expect(lighthouseThrottling({ ...DEFAULT_LH_CONFIG, throttlingMethod: 'provided' })).toEqual({ engine: 'Lighthouse', method: 'provided', network: {} });
  });

  it('preserves command argument values, including URL credentials, query values and fragments', () => {
    expect(measurementCommand(['compare', '--filter', 'Homepage flow', '--token=demo-value', '--url', 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor']))
      .toBe("shaka-perf compare --filter 'Homepage flow' --token=demo-value --url 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor'");
  });

  it('keeps calibrated CPU and network overrides returned by Lighthouse', () => {
    expect(lighthouseThrottling({ throttlingMethod: 'simulate', throttling: { cpuSlowdownMultiplier: 7, rttMs: 42, throughputKbps: 800 } }))
      .toEqual({ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 7, network: { rttMs: 42, throughputKbps: 800 } });
  });

  it('never substitutes CPU or method defaults when Lighthouse did not return them', () => {
    expect(lighthouseThrottling({})).toBeUndefined();
    expect(lighthouseThrottling({ throttlingMethod: 'devtools', throttling: { requestLatencyMs: 123 } }))
      .toEqual({ engine: 'Lighthouse', method: 'devtools', network: { requestLatencyMs: 123 } });
  });
});

describe('source artifacts at the persistence boundary', () => {
  const test: AbTestDefinition = {
    name: 'Homepage', file: null, line: null, startingPath: '/', testTypes: null,
    testFn: async () => {},
  };
  const source = "abTest('Homepage', {}, async () => {});";
  const metadata: RunMetadata = {
    command: 'shaka-perf compare', measuredAt: '2026-11-04T10:00:00Z',
    stages: ['visreg'], categories: ['visreg'], viewport: DESKTOP_VIEWPORT, targets: [],
  };
  let dir: string;
  let store: ArtifactStore;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-source-artifact-')); store = new ArtifactStore(dir); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('shares one immutable source artifact across stage outcomes', () => {
    const testSourcePath = store.writeTestSource(test, 'desktop', source);
    const file = path.join(dir, testSourcePath);
    const mtime = fs.statSync(file).mtimeMs;
    expect(store.writeTestSource(test, 'desktop', source)).toBe(testSourcePath);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    for (const stage of ['visreg', 'perf'] as const) {
      store.writeOutcome(test, 'desktop', { executionDetails: { testSourcePath, runId: 'fixture-run', recoveredAfterRetries: false }, kind: 'ok', stage, runMetadata: metadata });
      const saved = JSON.parse(fs.readFileSync(path.join(store.unitDirForViewport(test, 'desktop'), `${stage}.json`), 'utf8'));
      expect(saved.executionDetails).toMatchObject({ testSourcePath });
      expect(saved.runMetadata).not.toHaveProperty('testSourcePath');
    }
    expect(store.readTextArtifact(testSourcePath)).toBe(source);
    expect(fs.readdirSync(store.artifactsDirForViewport(test, 'desktop'))).toEqual([path.basename(testSourcePath)]);
    const changed = source.replace('Homepage', 'Changed homepage');
    const changedPath = store.writeTestSource(test, 'desktop', changed);
    expect(changedPath).not.toBe(testSourcePath);
    expect(store.readTextArtifact(changedPath)).toBe(changed);
    expect(store.readTextArtifact(testSourcePath)).toBe(source);
  });

  it('keeps measured outcomes readable when their source artifact is missing', () => {
    const testSourcePath = store.writeTestSource(test, 'desktop', source);
    store.writeOutcome(test, 'desktop', { executionDetails: { testSourcePath, runId: 'fixture-run', recoveredAfterRetries: false }, kind: 'ok', stage: 'visreg', runMetadata: metadata });
    fs.unlinkSync(path.join(dir, testSourcePath));
    expect(store.readOutcome(test, 'desktop', 'visreg')?.kind).toBe('ok');
    expect(store.readOutcome(test, 'desktop', 'visreg')?.executionDetails.testSourcePath).toBe(testSourcePath);
    expect(store.readTextArtifact(testSourcePath)).toBeUndefined();
  });

  it('does not read source paths outside the results root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-outside-source-'));
    try {
      const file = path.join(outside, 'source.ts');
      fs.writeFileSync(file, source);
      for (const candidate of [file, path.relative(dir, file), '.']) {
        expect(store.readTextArtifact(candidate)).toBeUndefined();
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
