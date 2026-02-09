import * as fs from 'fs';
import * as path from 'path';
import { SizeCalculator } from '../SizeCalculator';

describe('SizeCalculator', () => {
  const tmpDir = path.join(__dirname, 'tmp-size-calculator');

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function createFile(filename: string, sizeBytes: number): void {
    const buffer = Buffer.alloc(sizeBytes, 'x');
    fs.writeFileSync(path.join(tmpDir, filename), buffer);
  }

  describe('getFileSize', () => {
    it('returns file size in bytes', () => {
      createFile('test.js.gz', 1024);
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      expect(calc.getFileSize(path.join(tmpDir, 'test.js.gz'))).toBe(1024);
    });

    it('returns 0 for non-existent file', () => {
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      expect(calc.getFileSize(path.join(tmpDir, 'nonexistent.gz'))).toBe(0);
    });

    it('invokes onMissingFile callback for non-existent file', () => {
      const missingFiles: string[] = [];
      const calc = new SizeCalculator({
        bundlesDir: tmpDir,
        onMissingFile: (filePath) => missingFiles.push(filePath),
      });
      calc.getFileSize(path.join(tmpDir, 'missing.gz'));
      expect(missingFiles).toHaveLength(1);
      expect(missingFiles[0]).toContain('missing.gz');
    });

    it('does not invoke onMissingFile for existing file', () => {
      createFile('exists.gz', 100);
      const missingFiles: string[] = [];
      const calc = new SizeCalculator({
        bundlesDir: tmpDir,
        onMissingFile: (filePath) => missingFiles.push(filePath),
      });
      calc.getFileSize(path.join(tmpDir, 'exists.gz'));
      expect(missingFiles).toHaveLength(0);
    });
  });

  describe('getBundlePath', () => {
    it('joins bundlesDir with filename', () => {
      const calc = new SizeCalculator({ bundlesDir: '/some/dir' });
      expect(calc.getBundlePath('app.js')).toBe(path.join('/some/dir', 'app.js'));
    });
  });

  describe('getChunkSizes', () => {
    it('returns gzip and brotli sizes', () => {
      createFile('app.js.gz', 2048);
      createFile('app.js.br', 1536);
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      const sizes = calc.getChunkSizes('app.js');
      expect(sizes.gzip).toBe(2048);
      expect(sizes.brotli).toBe(1536);
    });

    it('returns 0 for missing compressed files', () => {
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      const sizes = calc.getChunkSizes('missing.js');
      expect(sizes.gzip).toBe(0);
      expect(sizes.brotli).toBe(0);
    });

    it('caches results', () => {
      createFile('cached.js.gz', 500);
      createFile('cached.js.br', 400);
      const calc = new SizeCalculator({ bundlesDir: tmpDir });

      const first = calc.getChunkSizes('cached.js');
      // Delete files to prove caching
      fs.unlinkSync(path.join(tmpDir, 'cached.js.gz'));
      fs.unlinkSync(path.join(tmpDir, 'cached.js.br'));
      const second = calc.getChunkSizes('cached.js');

      expect(first).toEqual(second);
      expect(first.gzip).toBe(500);
    });
  });

  describe('bytesToKb', () => {
    it('converts bytes to kilobytes', () => {
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      expect(calc.bytesToKb(1024)).toBe(1);
      expect(calc.bytesToKb(2048)).toBe(2);
      expect(calc.bytesToKb(512)).toBe(0.5);
      expect(calc.bytesToKb(0)).toBe(0);
    });
  });

  describe('calculateTotalSizes', () => {
    it('sums sizes across multiple chunks', () => {
      createFile('chunk1.js.gz', 1024);
      createFile('chunk1.js.br', 768);
      createFile('chunk2.js.gz', 2048);
      createFile('chunk2.js.br', 1536);

      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      const totals = calc.calculateTotalSizes(['chunk1.js', 'chunk2.js']);

      expect(totals.gzipSizeKb).toBe(3); // (1024 + 2048) / 1024
      expect(totals.brotliSizeKb).toBe(2.25); // (768 + 1536) / 1024
    });

    it('returns zeros for empty array', () => {
      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      const totals = calc.calculateTotalSizes([]);
      expect(totals.gzipSizeKb).toBe(0);
      expect(totals.brotliSizeKb).toBe(0);
    });

    it('handles missing files gracefully', () => {
      createFile('exists.js.gz', 1024);
      createFile('exists.js.br', 512);

      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      const totals = calc.calculateTotalSizes(['exists.js', 'missing.js']);

      expect(totals.gzipSizeKb).toBe(1); // only the existing file
      expect(totals.brotliSizeKb).toBe(0.5);
    });
  });

  describe('clearCache', () => {
    it('clears cached sizes', () => {
      createFile('clearable.js.gz', 100);
      createFile('clearable.js.br', 80);

      const calc = new SizeCalculator({ bundlesDir: tmpDir });
      calc.getChunkSizes('clearable.js');

      // Update files
      createFile('clearable.js.gz', 200);
      createFile('clearable.js.br', 160);

      // Before clear, should return cached values
      expect(calc.getChunkSizes('clearable.js').gzip).toBe(100);

      calc.clearCache();

      // After clear, should return new values
      expect(calc.getChunkSizes('clearable.js').gzip).toBe(200);
    });
  });
});
