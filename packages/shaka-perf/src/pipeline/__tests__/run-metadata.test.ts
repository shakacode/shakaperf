/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { executionFixture } from './fixtures/execution';
import { measurementCommand } from '../run-metadata';
import type { MeasurementMetadata } from '../run-metadata';
import { type AbTestDefinition } from 'shaka-shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageIds } from '../../stage/stage-ids';
import { ArtifactStore } from '../artifact-store';

describe('saved measurement metadata', () => {
  it('preserves command argument values, including URL credentials, query values and fragments', () => {
    expect(measurementCommand(['compare', '--filter', 'Homepage flow', '--token=demo-value', '--url', 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor']))
      .toBe("shaka-perf compare --filter 'Homepage flow' --token=demo-value --url 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor'");
  });
});

describe('source artifacts at the persistence boundary', () => {
  const test: AbTestDefinition = {
    name: 'Homepage', file: null, line: null, startingPath: '/', testTypes: null,
    testFn: async () => {},
  };
  const source = "abTest('Homepage', {}, async () => {});";
  const metadata: MeasurementMetadata = {
    measuredAt: '2026-11-04T10:00:00Z',
    targets: [],
  };
  let dir: string;
  let store: ArtifactStore;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-source-artifact-')); store = new ArtifactStore(dir); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('shares one immutable source artifact across stage outcomes', () => {
    const testSourceHref = store.resetSelectedStageResults(test, 'desktop', [stageIds.visreg], source)!;
    const file = path.join(dir, testSourceHref);
    const mtime = fs.statSync(file).mtimeMs;
    expect(store.resetSelectedStageResults(test, 'desktop', [stageIds.perf], source)).toBe(testSourceHref);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    for (const stage of [stageIds.visreg, stageIds.perf]) {
      store.writeOutcome(test, 'desktop', { ...executionFixture({ testSourceHref, measurementMetadata: metadata }), kind: 'ok', stage });
      const saved = JSON.parse(fs.readFileSync(path.join(store.unitDirForViewport(test, 'desktop'), `${stage}.json`), 'utf8'));
      expect(saved.executionDetails).toMatchObject({ testSourceHref });
      expect(saved.executionDetails.measurementMetadata).not.toHaveProperty('testSourceHref');
    }
    expect(store.readTextArtifact(testSourceHref)).toBe(source);
    const entries = fs.readdirSync(store.artifactsDirForViewport(test, 'desktop'), { withFileTypes: true });
    expect(entries.filter(entry => entry.isFile()).map(entry => entry.name)).toEqual([path.basename(testSourceHref)]);
    const changed = source.replace('Homepage', 'Changed homepage');
    const changedPath = store.resetSelectedStageResults(test, 'desktop', [stageIds.visreg], changed)!;
    expect(changedPath).not.toBe(testSourceHref);
    expect(store.readTextArtifact(changedPath)).toBe(changed);
    expect(store.readTextArtifact(testSourceHref)).toBe(source);
  });

  it('keeps measured outcomes readable when their source artifact is missing', () => {
    const testSourceHref = store.resetSelectedStageResults(test, 'desktop', [stageIds.visreg], source)!;
    store.writeOutcome(test, 'desktop', { ...executionFixture({ testSourceHref, measurementMetadata: metadata }), kind: 'ok', stage: stageIds.visreg });
    fs.unlinkSync(path.join(dir, testSourceHref));
    expect(store.readOutcome(test, 'desktop', stageIds.visreg)?.kind).toBe('ok');
    expect(store.readOutcome(test, 'desktop', stageIds.visreg)?.executionDetails.testSourceHref).toBe(testSourceHref);
    expect(store.readTextArtifact(testSourceHref)).toBeUndefined();
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
