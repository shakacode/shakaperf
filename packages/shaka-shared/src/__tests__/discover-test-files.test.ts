import * as fs from 'fs';
import * as path from 'path';
import { discoverTestFiles } from '../discover-test-files';

describe('discoverTestFiles', () => {
  const tmpDir = path.join(__dirname, 'tmp-discover-tests');

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

  it('returns empty array when no test files exist', () => {
    expect(discoverTestFiles(tmpDir)).toEqual([]);
  });

  it('discovers .abtest.ts files', () => {
    fs.writeFileSync(path.join(tmpDir, 'homepage.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, 'homepage.abtest.ts')]);
  });

  it('discovers .abtest.js files', () => {
    fs.writeFileSync(path.join(tmpDir, 'homepage.abtest.js'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, 'homepage.abtest.js')]);
  });

  it('discovers files in subdirectories recursively', () => {
    const subDir = path.join(tmpDir, 'ab-tests');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'cart.abtest.ts'), '');
    fs.writeFileSync(path.join(subDir, 'homepage.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([
      path.join(subDir, 'cart.abtest.ts'),
      path.join(subDir, 'homepage.abtest.ts'),
    ]);
  });

  it('ignores node_modules directories', () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'test.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'real.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, 'real.abtest.ts')]);
  });

  it('ignores non-abtest files', () => {
    fs.writeFileSync(path.join(tmpDir, 'homepage.test.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'homepage.spec.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'homepage.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'homepage.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, 'homepage.abtest.ts')]);
  });

  it('filters files by regex pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'homepage.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'cart.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'products.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir, 'cart');
    expect(result).toEqual([path.join(tmpDir, 'cart.abtest.ts')]);
  });

  it('filters files by regex pattern matching multiple files', () => {
    fs.writeFileSync(path.join(tmpDir, 'homepage.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'cart.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'products.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir, 'cart|homepage');
    expect(result).toEqual([
      path.join(tmpDir, 'cart.abtest.ts'),
      path.join(tmpDir, 'homepage.abtest.ts'),
    ]);
  });

  it('returns sorted results', () => {
    fs.writeFileSync(path.join(tmpDir, 'z-test.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'a-test.abtest.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'm-test.abtest.ts'), '');

    const result = discoverTestFiles(tmpDir);
    expect(result).toEqual([
      path.join(tmpDir, 'a-test.abtest.ts'),
      path.join(tmpDir, 'm-test.abtest.ts'),
      path.join(tmpDir, 'z-test.abtest.ts'),
    ]);
  });

  it('defaults to process.cwd() when no cwd provided', () => {
    // Just verify it doesn't throw
    const result = discoverTestFiles();
    expect(Array.isArray(result)).toBe(true);
  });
});
