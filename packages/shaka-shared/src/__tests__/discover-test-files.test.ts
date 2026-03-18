import * as fs from 'fs';
import * as path from 'path';
import { findTestFiles } from '../discover-test-files';

describe('findTestFiles', () => {
  const tmpDir = path.join(__dirname, 'tmp-find-test-files');

  function mkfile(relPath: string, content = '') {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns empty array when no .abtest files exist', () => {
    mkfile('homepage.bench.ts');
    mkfile('products.test.ts');
    expect(findTestFiles({ cwd: tmpDir })).toEqual([]);
  });

  it('finds .abtest.ts files', () => {
    mkfile('homepage.abtest.ts');
    mkfile('products.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(2);
    expect(results.some(f => f.endsWith('homepage.abtest.ts'))).toBe(true);
    expect(results.some(f => f.endsWith('products.abtest.ts'))).toBe(true);
  });

  it('finds .abtest.js files', () => {
    mkfile('homepage.abtest.js');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/homepage\.abtest\.js$/);
  });

  it('finds files recursively in subdirectories', () => {
    mkfile('ab-tests/homepage.abtest.ts');
    mkfile('ab-tests/nested/products.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(2);
  });

  it('skips node_modules directory', () => {
    mkfile('homepage.abtest.ts');
    mkfile('node_modules/some-pkg/test.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0]).not.toContain('node_modules');
  });

  it('skips dist directory', () => {
    mkfile('homepage.abtest.ts');
    mkfile('dist/homepage.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0]).not.toContain('dist');
  });

  it('skips build, .next, and coverage directories', () => {
    mkfile('homepage.abtest.ts');
    mkfile('build/homepage.abtest.ts');
    mkfile('.next/homepage.abtest.ts');
    mkfile('coverage/homepage.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toHaveLength(1);
  });

  it('ignores non-abtest files', () => {
    mkfile('homepage.test.ts');
    mkfile('homepage.spec.ts');
    mkfile('homepage.ts');
    mkfile('homepage.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results).toEqual([path.join(tmpDir, 'homepage.abtest.ts')]);
  });

  it('filters by testPathPattern regex', () => {
    mkfile('ab-tests/homepage.abtest.ts');
    mkfile('ab-tests/products.abtest.ts');
    mkfile('ab-tests/cart.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir, testPathPattern: 'homepage' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/homepage\.abtest\.ts$/);
  });

  it('testPathPattern filters by full path', () => {
    mkfile('ab-tests/homepage.abtest.ts');
    mkfile('ab-tests/products.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir, testPathPattern: 'ab-tests/products' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/products\.abtest\.ts$/);
  });

  it('testPathPattern can match multiple files', () => {
    mkfile('homepage.abtest.ts');
    mkfile('cart.abtest.ts');
    mkfile('products.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir, testPathPattern: 'cart|homepage' });
    expect(results).toEqual([
      path.join(tmpDir, 'cart.abtest.ts'),
      path.join(tmpDir, 'homepage.abtest.ts'),
    ]);
  });

  it('returns sorted results', () => {
    mkfile('z-last.abtest.ts');
    mkfile('a-first.abtest.ts');
    mkfile('m-middle.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir });
    expect(results[0]).toMatch(/a-first/);
    expect(results[1]).toMatch(/m-middle/);
    expect(results[2]).toMatch(/z-last/);
  });

  it('uses process.cwd() as default when cwd not provided', () => {
    expect(() => findTestFiles()).not.toThrow();
  });

  it('returns empty array when testPathPattern matches nothing', () => {
    mkfile('homepage.abtest.ts');

    const results = findTestFiles({ cwd: tmpDir, testPathPattern: 'nonexistent' });
    expect(results).toEqual([]);
  });
});
