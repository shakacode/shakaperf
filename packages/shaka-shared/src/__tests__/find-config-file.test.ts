import * as fs from 'fs';
import * as path from 'path';
import { findConfigFile } from '../find-config-file';

describe('findConfigFile', () => {
  const tmpDir = path.join(__dirname, 'tmp-find-config');

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

  it('returns null when no files match', () => {
    expect(findConfigFile(['config.ts', 'config.js'], tmpDir)).toBeNull();
  });

  it('returns the first matching file', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.ts'), 'export default {}');
    fs.writeFileSync(path.join(tmpDir, 'config.js'), 'module.exports = {}');

    const result = findConfigFile(['config.ts', 'config.js'], tmpDir);
    expect(result).toBe(path.join(tmpDir, 'config.ts'));
  });

  it('returns second filename if first does not exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.js'), 'module.exports = {}');

    const result = findConfigFile(['config.ts', 'config.js'], tmpDir);
    expect(result).toBe(path.join(tmpDir, 'config.js'));
  });

  it('uses process.cwd() as default when cwd not provided', () => {
    // The function signature defaults to process.cwd(), just verify it doesn't throw
    const result = findConfigFile(['nonexistent-file-12345.ts']);
    expect(result).toBeNull();
  });

  it('handles empty filenames array', () => {
    expect(findConfigFile([], tmpDir)).toBeNull();
  });
});
