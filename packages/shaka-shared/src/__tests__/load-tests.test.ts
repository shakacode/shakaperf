import * as fs from 'fs';
import * as path from 'path';
import { loadTests } from '../load-tests';
import { clearRegistry, getRegisteredTests } from '../ab-test-registry';

describe('loadTests', () => {
  const tmpDir = path.join(__dirname, 'tmp-load-tests');

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
      const { abTest } = require('${require.resolve('../ab-test-registry').replace(/\\/g, '\\\\')}');
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
      const { abTest } = require('${require.resolve('../ab-test-registry').replace(/\\/g, '\\\\')}');
      abTest('Homepage', { startingPath: '/' }, async () => {});
    `);

    await expect(
      loadTests({ testPathPattern: 'nonexistent' })
    ).rejects.toThrow(/matching pattern "nonexistent"/);
  });

  it('calls log callback during discovery', async () => {
    mkfile('test.abtest.js', `
      const { abTest } = require('${require.resolve('../ab-test-registry').replace(/\\/g, '\\\\')}');
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

  it('clears registry before loading', async () => {
    // Pre-populate registry
    const { abTest } = require('../ab-test-registry');
    abTest('Old test', { startingPath: '/old' }, async () => {});
    expect(getRegisteredTests()).toHaveLength(1);

    mkfile('new.abtest.js', `
      const { abTest } = require('${require.resolve('../ab-test-registry').replace(/\\/g, '\\\\')}');
      abTest('New test', { startingPath: '/new' }, async () => {});
    `);

    const tests = await loadTests({ filter: path.join(tmpDir, 'new.abtest.js') });
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('New test');
  });
});
