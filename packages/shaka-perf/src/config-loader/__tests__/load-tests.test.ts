/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadTests } from '../load-tests';
import { abTest, clearRegistry, getRegisteredTests, restoreRegistry, TestType } from 'shaka-shared';

describe('loadTests', () => {
  const tmpDir = path.join(__dirname, 'tmp-load-tests');
  const sharedModulePath = require.resolve('shaka-shared').replace(/\\/g, '\\\\');

  function mkfile(relPath: string, content: string) {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  beforeEach(() => {
    clearRegistry();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    clearRegistry();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('loads a specific test file when filter is a path to an abtest file', async () => {
    mkfile('my-test.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Specific test', { startingPath: '/page' }, async () => {});
    `);

    const tests = await loadTests({ filter: path.join(tmpDir, 'my-test.abtest.js') });
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('Specific test');
  });

  it('throws when filter-as-file has no registered tests', async () => {
    mkfile('empty.abtest.js', '// no abTest calls');

    await expect(
      loadTests({ filter: path.join(tmpDir, 'empty.abtest.js') })
    ).rejects.toThrow(/No tests registered/);
  });

  it('keeps concurrent calls isolated (no cross-caller registration bleed)', async () => {
    // The compare pipeline runs per-unit engine invocations on a parallel
    // pool; each calls loadTests. Unserialized, the clear → import → read
    // sections interleave over the process-global registry and a caller's
    // post-import read picks up sibling callers' registrations — returning
    // (and reporting, and thumbnailing) tests it never asked for, or the
    // same test once per concurrent caller.
    mkfile('concurrent-a.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Concurrent A', { startingPath: '/a' }, async () => {});
    `);
    mkfile('concurrent-b.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Concurrent B', { startingPath: '/b' }, async () => {});
    `);

    const [a, b] = await Promise.all([
      loadTests({ filter: path.join(tmpDir, 'concurrent-a.abtest.js') }),
      loadTests({ filter: path.join(tmpDir, 'concurrent-b.abtest.js') }),
    ]);
    expect(a.map(t => t.name)).toEqual(['Concurrent A']);
    expect(b.map(t => t.name)).toEqual(['Concurrent B']);
  });

  it('keeps prior registrations for files that do not re-register in a repeated load', async () => {
    const relPath = 'cached.abtest.js';
    const absPath = path.join(tmpDir, relPath);
    mkfile(relPath, '// already loaded in this process');
    restoreRegistry([{
      name: 'Cached test',
      startingPath: '/cached',
      file: absPath,
      line: 1,
      options: {},
      testTypes: null,
      testFn: async () => {},
    }]);

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const tests = await loadTests();
      expect(tests.map(t => t.name)).toEqual(['Cached test']);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('normalizes file URL registrations to absolute filesystem paths', async () => {
    const relPath = 'file-url-cached.abtest.js';
    const absPath = path.join(tmpDir, relPath);
    mkfile(relPath, '// already loaded through an ESM loader');
    restoreRegistry([{
      name: 'File URL test',
      startingPath: '/file-url',
      file: pathToFileURL(absPath).href,
      line: 1,
      options: {},
      testTypes: null,
      testFn: async () => {},
    }]);

    const tests = await loadTests({ filter: absPath });

    expect(tests).toHaveLength(1);
    expect(tests[0]?.file).toBe(absPath);
  });

  it('remembers a file\'s registrations across interleaved loads of other files', async () => {
    // Simulates the compare pipeline's per-unit pattern (file A, then B, then
    // A again) when re-imports are no-ops: file A's tests must come back on
    // the third load even though the registry held only B's tests by then.
    const noopRelPath = 'interleaved-noop.abtest.js';
    const noopAbsPath = path.join(tmpDir, noopRelPath);
    mkfile(noopRelPath, '// already loaded in this process — registers nothing');
    mkfile('interleaved-other.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Other test', { startingPath: '/other' }, async () => {});
    `);
    restoreRegistry([{
      name: 'Interleaved test',
      startingPath: '/interleaved',
      file: noopAbsPath,
      line: 1,
      options: {},
      testTypes: null,
      testFn: async () => {},
    }]);

    const first = await loadTests({ filter: noopAbsPath });
    expect(first.map(t => t.name)).toEqual(['Interleaved test']);

    const other = await loadTests({ filter: path.join(tmpDir, 'interleaved-other.abtest.js') });
    expect(other.map(t => t.name)).toEqual(['Other test']);

    const again = await loadTests({ filter: noopAbsPath });
    expect(again.map(t => t.name)).toEqual(['Interleaved test']);
  });

  it('does not resurrect other files\' tests when the loaded file registers nothing', async () => {
    mkfile('orphan-empty.abtest.js', '// registers nothing');
    restoreRegistry([{
      name: 'Test from another file',
      startingPath: '/elsewhere',
      file: path.join(tmpDir, 'somewhere-else.abtest.js'),
      line: 1,
      options: {},
      testTypes: null,
      testFn: async () => {},
    }]);

    await expect(
      loadTests({ filter: path.join(tmpDir, 'orphan-empty.abtest.js') })
    ).rejects.toThrow(/No tests registered/);
  });

  it('throws when no .abtest files are discovered', async () => {
    mkfile('not-a-test.ts', 'export default {}');

    // Run from a dir with no abtest files.
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await expect(loadTests()).rejects.toThrow(/No .abtest.ts or .abtest.js files found/);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('throws with pattern hint when testPathPattern matches nothing', async () => {
    mkfile('homepage.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Homepage', { startingPath: '/' }, async () => {});
    `);

    await expect(
      loadTests({ testPathPattern: 'nonexistent' })
    ).rejects.toThrow(/matching pattern "nonexistent"/);
  });

  it('calls log callback during discovery', async () => {
    mkfile('test.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Logged test', { startingPath: '/' }, async () => {});
    `);

    const messages: string[] = [];
    // Use cwd-based discovery by temporarily changing to tmpDir
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await loadTests({ log: (msg) => messages.push(msg) });
    } finally {
      process.chdir(origCwd);
    }

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Discovered');
  });

  it('filters out tests whose testTypes does not include the requested testType', async () => {
    mkfile('mixed.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Visreg only', { startingPath: '/a', testTypes: ['visreg'] }, async () => {});
      abTest('Perf only', { startingPath: '/b', testTypes: ['perf'] }, async () => {});
      abTest('No testTypes', { startingPath: '/c' }, async () => {});
    `);

    const tests = await loadTests({
      filter: path.join(tmpDir, 'mixed.abtest.js'),
      testType: 'visreg',
    });

    expect(tests.map(t => t.name)).toEqual(['Visreg only', 'No testTypes']);
  });

  it('does not filter by testType when testType option is omitted', async () => {
    mkfile('all.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Visreg only', { startingPath: '/a', testTypes: ['visreg'] }, async () => {});
      abTest('Perf only', { startingPath: '/b', testTypes: ['perf'] }, async () => {});
    `);

    const tests = await loadTests({ filter: path.join(tmpDir, 'all.abtest.js') });
    expect(tests).toHaveLength(2);
  });

  it('clears registry before loading', async () => {
    // Pre-populate registry
    abTest('Old test', { startingPath: '/old' }, async () => {});
    expect(getRegisteredTests()).toHaveLength(1);

    mkfile('new.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('New test', { startingPath: '/new' }, async () => {});
    `);

    const tests = await loadTests({ filter: path.join(tmpDir, 'new.abtest.js') });
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('New test');
  });
});
