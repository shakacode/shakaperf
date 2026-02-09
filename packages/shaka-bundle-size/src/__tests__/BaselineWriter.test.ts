import * as fs from 'fs';
import * as path from 'path';
import { BaselineWriter } from '../BaselineWriter';
import type { ComponentSize, BaselineConfig } from '../types';

describe('BaselineWriter', () => {
  const tmpDir = path.join(__dirname, 'tmp-baseline-writer');

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('ensureDirectoryExists', () => {
    it('creates directory if it does not exist', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      expect(fs.existsSync(tmpDir)).toBe(false);
      writer.ensureDirectoryExists();
      expect(fs.existsSync(tmpDir)).toBe(true);
    });

    it('is idempotent if directory exists', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      writer.ensureDirectoryExists();
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe('clearDirectory', () => {
    it('removes and recreates directory', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'old.json'), '{}');

      const writer = new BaselineWriter({ baselineDir: tmpDir });
      writer.clearDirectory();

      expect(fs.existsSync(tmpDir)).toBe(true);
      expect(fs.readdirSync(tmpDir)).toHaveLength(0);
    });

    it('creates directory even if it did not exist', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      writer.clearDirectory();
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe('getFilePath', () => {
    it('joins baselineDir with filename', () => {
      const writer = new BaselineWriter({ baselineDir: '/some/dir' });
      expect(writer.getFilePath('config.json')).toBe(path.join('/some/dir', 'config.json'));
    });
  });

  describe('formatComponents', () => {
    it('formats and sorts components alphabetically', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const sizes: ComponentSize[] = [
        { name: 'Zebra', chunksCount: 1, brotliSizeKb: 10.123, gzipSizeKb: 12.456 },
        { name: 'Alpha', chunksCount: 3, brotliSizeKb: 50.789, gzipSizeKb: 60.012 },
      ];

      const formatted = writer.formatComponents(sizes);
      expect(formatted).toHaveLength(2);
      expect(formatted[0].name).toBe('Alpha');
      expect(formatted[1].name).toBe('Zebra');
      expect(formatted[0].gzipSizeKb).toBe('60.01');
      expect(formatted[0].brotliSizeKb).toBe('50.79');
      expect(formatted[0].chunksCount).toBe(3);
    });

    it('formats sizes to 2 decimal places', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const sizes: ComponentSize[] = [
        { name: 'A', chunksCount: 1, brotliSizeKb: 0, gzipSizeKb: 0 },
      ];
      const formatted = writer.formatComponents(sizes);
      expect(formatted[0].gzipSizeKb).toBe('0.00');
      expect(formatted[0].brotliSizeKb).toBe('0.00');
    });
  });

  describe('calculateTotalSize', () => {
    it('sums all gzip sizes', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const sizes: ComponentSize[] = [
        { name: 'A', chunksCount: 1, brotliSizeKb: 0, gzipSizeKb: 100.5 },
        { name: 'B', chunksCount: 1, brotliSizeKb: 0, gzipSizeKb: 200.75 },
      ];
      expect(writer.calculateTotalSize(sizes)).toBe('301.25');
    });

    it('returns 0.00 for empty array', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      expect(writer.calculateTotalSize([])).toBe('0.00');
    });
  });

  describe('createBaselineConfig', () => {
    it('creates a full baseline config', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const sizes: ComponentSize[] = [
        { name: 'App', chunksCount: 2, brotliSizeKb: 80, gzipSizeKb: 100 },
        { name: 'Header', chunksCount: 1, brotliSizeKb: 30, gzipSizeKb: 40 },
      ];

      const config = writer.createBaselineConfig(sizes);
      expect(config.loadableComponents).toHaveLength(2);
      expect(config.loadableComponents[0].name).toBe('App'); // alphabetically sorted
      expect(config.totalgzipSizeKb).toBe('140.00');
    });
  });

  describe('writeBaselineFile', () => {
    it('writes a valid JSON config file', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const sizes: ComponentSize[] = [
        { name: 'App', chunksCount: 2, brotliSizeKb: 80, gzipSizeKb: 100 },
      ];

      const configPath = writer.writeBaselineFile('config.json', sizes);
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf8')) as BaselineConfig;
      expect(content.loadableComponents).toHaveLength(1);
      expect(content.loadableComponents[0].name).toBe('App');
      expect(content.totalgzipSizeKb).toBe('100.00');
    });

    it('creates directory if needed', () => {
      const nestedDir = path.join(tmpDir, 'nested');
      const writer = new BaselineWriter({ baselineDir: nestedDir });
      const sizes: ComponentSize[] = [];

      writer.writeBaselineFile('config.json', sizes);
      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('returns the full path to the written file', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      const configPath = writer.writeBaselineFile('test.json', []);
      expect(configPath).toBe(path.join(tmpDir, 'test.json'));
    });

    it('writes pretty-printed JSON with trailing newline', () => {
      const writer = new BaselineWriter({ baselineDir: tmpDir });
      writer.writeBaselineFile('config.json', []);
      const raw = fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8');
      expect(raw).toContain('\n');
      expect(raw.endsWith('\n')).toBe(true);
      // Check it's indented (pretty-printed)
      expect(raw).toContain('  ');
    });
  });
});
