/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadTests, normalizeTestFile } from '../load-tests';
import { abTest, clearRegistry, getRegisteredTests, restoreRegistry } from 'shaka-shared';
import type { AbTestDefinition } from 'shaka-shared';

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

  it('returns a file\'s tests on every load, though its body runs only once', async () => {
    // No loader can be made to re-evaluate a module (see loadModule), so the
    // second load imports nothing and finds an empty registry — the remembered
    // registrations are the only source. The counter proves the body really
    // did not re-run, which is what makes this test about the memo and not
    // about a cache-bust quietly re-executing the file.
    mkfile('repeat.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      global.__repeatEvaluations = (global.__repeatEvaluations ?? 0) + 1;
      abTest('Repeated test', { startingPath: '/repeat' }, async () => {});
    `);
    const absPath = path.join(tmpDir, 'repeat.abtest.js');

    const first = await loadTests({ filter: absPath });
    const second = await loadTests({ filter: absPath });

    expect(first.map(t => t.name)).toEqual(['Repeated test']);
    expect(second.map(t => t.name)).toEqual(['Repeated test']);
    expect((global as unknown as { __repeatEvaluations: number }).__repeatEvaluations).toBe(1);
  });

  it('remembers a file\'s registrations across interleaved loads of other files', async () => {
    // The compare pipeline's per-unit pattern: file A, then B, then A again.
    // Loading B clears the registry, and A's body never runs a second time, so
    // the third load can only come back from what was remembered for A.
    mkfile('interleaved-a.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Interleaved A', { startingPath: '/a' }, async () => {});
    `);
    mkfile('interleaved-b.abtest.js', `
      const { abTest } = require('${sharedModulePath}');
      abTest('Interleaved B', { startingPath: '/b' }, async () => {});
    `);
    const a = path.join(tmpDir, 'interleaved-a.abtest.js');
    const b = path.join(tmpDir, 'interleaved-b.abtest.js');

    expect((await loadTests({ filter: a })).map(t => t.name)).toEqual(['Interleaved A']);
    expect((await loadTests({ filter: b })).map(t => t.name)).toEqual(['Interleaved B']);
    expect((await loadTests({ filter: a })).map(t => t.name)).toEqual(['Interleaved A']);
  });

  describe('normalizeTestFile', () => {
    // `abTest()` reads its call site off a stack frame; under ESM that frame
    // carries a file:// URL, while everything downstream matches against
    // filesystem paths. Jest loads these fixtures through `require`, so the
    // ESM shape never occurs here — assert it on the function directly.
    const definition = (file: string): AbTestDefinition => ({
      name: 'From ESM',
      startingPath: '/',
      file,
      line: 1,
      testTypes: null,
      testFn: async () => {},
    });

    it('rewrites a file:// call site to an absolute filesystem path', () => {
      const absPath = path.join(tmpDir, 'from-esm.abtest.ts');
      expect(normalizeTestFile(definition(pathToFileURL(absPath).href)).file).toBe(absPath);
    });

    it('leaves an already-absolute path untouched', () => {
      const absPath = path.join(tmpDir, 'from-cjs.abtest.js');
      expect(normalizeTestFile(definition(absPath)).file).toBe(absPath);
    });
  });

  it('does not resurrect other files\' tests when the loaded file registers nothing', async () => {
    mkfile('orphan-empty.abtest.js', '// registers nothing');
    restoreRegistry([{
      name: 'Test from another file',
      startingPath: '/elsewhere',
      file: path.join(tmpDir, 'somewhere-else.abtest.js'),
      line: 1,
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
