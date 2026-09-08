/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_BISECT_PATCHES_MANIFEST,
  loadBisectPatchManifest,
} from '../patch-manifest';

const HASH = 'a'.repeat(64);

describe('bisect patch manifest', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-patch-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('treats a missing default manifest as an empty patch registry', () => {
    const loaded = loadBisectPatchManifest({ configDirectory: rootDir });

    expect(loaded.path).toBe(path.join(rootDir, DEFAULT_BISECT_PATCHES_MANIFEST));
    expect(loaded.manifest).toEqual({ version: 1, patches: [] });
  });

  it('requires an explicitly configured manifest to exist', () => {
    expect(() => loadBisectPatchManifest({
      configDirectory: rootDir,
      configuredPath: './custom/patches.json',
    })).toThrow(/Cannot read bisect patch manifest.*custom\/patches\.json/);
  });

  it('parses all patch sources and optional purpose', () => {
    writeManifest({
      version: 1,
      patches: [
        patch({
          id: 'working',
          filename: 'working.patch',
          source: { kind: 'working-tree', headSha: 'head', paths: ['app.ts'] },
        }),
        patch({
          id: 'commit',
          filename: 'commit.patch',
          purpose: 'Backport the test',
          source: {
            kind: 'source-commit', sha: 'source', parentSha: 'parent', paths: ['test.ts'],
          },
          appliesTo: { from: 'good', through: 'bad' },
        }),
        patch({
          id: 'imported',
          filename: 'imported.patch',
          source: { kind: 'patch-file', importedFromBasename: 'original.patch' },
          appliesTo: { commits: ['one', 'two'] },
        }),
      ],
    });

    const loaded = loadBisectPatchManifest({ configDirectory: rootDir });

    expect(loaded.manifest.patches).toHaveLength(3);
    expect(loaded.manifest.patches[0]).not.toHaveProperty('purpose');
    expect(loaded.manifest.patches[1]?.purpose).toBe('Backport the test');
  });

  it('defaults omitted preparation and cleanup commands', () => {
    const {
      prepareCommands: _prepareCommands,
      cleanupCommands: _cleanupCommands,
      ...withoutCommands
    } = patch();
    writeManifest({ version: 1, patches: [withoutCommands] });

    expect(loadBisectPatchManifest({ configDirectory: rootDir }).manifest.patches[0])
      .toMatchObject({ prepareCommands: [], cleanupCommands: [] });
  });

  it.each([
    ['duplicate ids', [patch(), patch({ filename: 'other.patch' })], /duplicate patch id/],
    ['duplicate filenames', [patch(), patch({ id: 'other' })], /duplicate patch filename/],
    ['unsafe filename', [patch({ filename: '../escape.patch' })], /safe manifest-relative/],
    ['invalid hash', [patch({ sha256: 'not-a-hash' })], /sha256 must be 64/],
    ['empty purpose', [patch({ purpose: ' ' })], /purpose cannot be empty/],
    [
      'mixed selector',
      [patch({ appliesTo: { all: true, commits: ['one'] } })],
      /unrecognized key|invalid input/i,
    ],
    ['unknown field', [{ ...patch(), legacy: true }], /unrecognized key/i],
  ])('rejects %s', (_name, patches, error) => {
    writeManifest({ version: 1, patches });
    expect(() => loadBisectPatchManifest({ configDirectory: rootDir })).toThrow(error as RegExp);
  });

  it('reports malformed JSON with the manifest path', () => {
    const manifestPath = path.join(rootDir, DEFAULT_BISECT_PATCHES_MANIFEST);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, '{');

    expect(() => loadBisectPatchManifest({ configDirectory: rootDir }))
      .toThrow(/Cannot parse bisect patch manifest/);
  });

  function writeManifest(value: unknown): void {
    const manifestPath = path.join(rootDir, DEFAULT_BISECT_PATCHES_MANIFEST);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(value));
  }
});

function patch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'repair',
    kind: 'other',
    filename: 'repair.patch',
    sha256: HASH,
    source: { kind: 'patch-file', importedFromBasename: 'repair.patch' },
    appliesTo: { all: true },
    prepareCommands: [],
    cleanupCommands: [],
    ...overrides,
  };
}
