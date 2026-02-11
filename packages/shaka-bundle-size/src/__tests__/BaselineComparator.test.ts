import * as fs from 'fs';
import * as path from 'path';
import { BaselineComparator, UNCATEGORIZED_CHUNKS_NAME } from '../BaselineComparator';
import type { ComponentSize, BaselineConfig, BaselineComponent } from '../types';

describe('BaselineComparator', () => {
  const tmpDir = path.join(__dirname, 'tmp-baseline-comparator');

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

  describe('UNCATEGORIZED_CHUNKS_NAME', () => {
    it('exports the correct constant', () => {
      expect(UNCATEGORIZED_CHUNKS_NAME).toBe('uncategorized chunks');
    });
  });

  describe('getBaselineFilePath', () => {
    it('joins baselineDir with filename', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.getBaselineFilePath('config.json')).toBe(path.join(tmpDir, 'config.json'));
    });
  });

  describe('baselineFileExists', () => {
    it('returns true when file exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.baselineFileExists('config.json')).toBe(true);
    });

    it('returns false when file does not exist', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.baselineFileExists('nonexistent.json')).toBe(false);
    });
  });

  describe('loadBaselineFile', () => {
    it('loads and parses baseline JSON', () => {
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, brotliSizeKb: '100.00', gzipSizeKb: '120.00' },
        ],
        totalgzipSizeKb: '120.00',
      };
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(baseline));

      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const loaded = comparator.loadBaselineFile('config.json');
      expect(loaded.loadableComponents).toHaveLength(1);
      expect(loaded.loadableComponents[0].name).toBe('App');
    });

    it('throws for invalid JSON syntax', () => {
      fs.writeFileSync(path.join(tmpDir, 'invalid.json'), '{ invalid json }');
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(() => comparator.loadBaselineFile('invalid.json')).toThrow();
    });

    it('throws for non-existent file', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(() => comparator.loadBaselineFile('nonexistent.json')).toThrow();
    });
  });

  describe('findComponentByName', () => {
    it('finds a component by name', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const components = [
        { name: 'App', value: 1 },
        { name: 'Header', value: 2 },
      ];
      expect(comparator.findComponentByName(components, 'Header')).toEqual({ name: 'Header', value: 2 });
    });

    it('returns undefined when not found', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const components = [{ name: 'App', value: 1 }];
      expect(comparator.findComponentByName(components, 'Missing')).toBeUndefined();
    });
  });

  describe('createComparison', () => {
    it('creates a comparison object', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize = { name: 'App', chunksCount: 3, gzipSizeKb: 125.678, brotliSizeKb: 100.0 };
      const expected: BaselineComponent = { name: 'App', chunksCount: 2, gzipSizeKb: '120.00', brotliSizeKb: '95.00' };

      const comparison = comparator.createComparison(actual, expected);
      expect(comparison.name).toBe('App');
      expect(comparison.actualSizeKb).toBe(125.68); // toFixed(2) then Number
      expect(comparison.expectedSizeKb).toBe(120);
      expect(comparison.sizeDiffKb).toBeCloseTo(5.68, 2);
      expect(comparison.actualChunksCount).toBe(3);
      expect(comparison.expectedChunksCount).toBe(2);
    });
  });

  describe('hasSizeIncrease', () => {
    it('returns true when sizeDiff exceeds threshold', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir, sizeThresholdKb: 0.1 });
      expect(comparator.hasSizeIncrease({
        name: 'A', actualSizeKb: 10, expectedSizeKb: 9, sizeDiffKb: 1, actualChunksCount: 1, expectedChunksCount: 1,
      })).toBe(true);
    });

    it('returns false when sizeDiff is below threshold', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir, sizeThresholdKb: 5 });
      expect(comparator.hasSizeIncrease({
        name: 'A', actualSizeKb: 10, expectedSizeKb: 9, sizeDiffKb: 1, actualChunksCount: 1, expectedChunksCount: 1,
      })).toBe(false);
    });

    it('returns false for negative diff', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.hasSizeIncrease({
        name: 'A', actualSizeKb: 8, expectedSizeKb: 10, sizeDiffKb: -2, actualChunksCount: 1, expectedChunksCount: 1,
      })).toBe(false);
    });
  });

  describe('hasSizeDecrease', () => {
    it('returns true for negative diff', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.hasSizeDecrease({
        name: 'A', actualSizeKb: 8, expectedSizeKb: 10, sizeDiffKb: -2, actualChunksCount: 1, expectedChunksCount: 1,
      })).toBe(true);
    });

    it('returns false for positive diff', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.hasSizeDecrease({
        name: 'A', actualSizeKb: 12, expectedSizeKb: 10, sizeDiffKb: 2, actualChunksCount: 1, expectedChunksCount: 1,
      })).toBe(false);
    });
  });

  describe('hasChunksCountIncrease', () => {
    it('returns true when actual > expected', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.hasChunksCountIncrease({
        name: 'A', actualSizeKb: 10, expectedSizeKb: 10, sizeDiffKb: 0, actualChunksCount: 5, expectedChunksCount: 3,
      })).toBe(true);
    });

    it('returns false when actual <= expected', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      expect(comparator.hasChunksCountIncrease({
        name: 'A', actualSizeKb: 10, expectedSizeKb: 10, sizeDiffKb: 0, actualChunksCount: 3, expectedChunksCount: 3,
      })).toBe(false);
    });
  });

  describe('compare', () => {
    it('detects new components', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 2, gzipSizeKb: 100, brotliSizeKb: 80 },
        { name: 'NewWidget', chunksCount: 1, gzipSizeKb: 50, brotliSizeKb: 40 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.newComponents).toHaveLength(1);
      expect(result.newComponents[0].name).toBe('NewWidget');
    });

    it('detects removed components', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 2, gzipSizeKb: 100, brotliSizeKb: 80 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
          { name: 'OldWidget', chunksCount: 1, gzipSizeKb: '30.00', brotliSizeKb: '25.00' },
        ],
        totalgzipSizeKb: '130.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.removedComponents).toHaveLength(1);
      expect(result.removedComponents[0].name).toBe('OldWidget');
    });

    it('detects size increases', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir, sizeThresholdKb: 0.1 });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 2, gzipSizeKb: 115, brotliSizeKb: 90 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.sizeChanges).toHaveLength(1);
      expect(result.sizeChanges[0].sizeDiffKb).toBe(15);
    });

    it('detects chunks count increases', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 5, gzipSizeKb: 100, brotliSizeKb: 80 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.chunksCountIncreases).toHaveLength(1);
      expect(result.chunksCountIncreases[0].actualChunksCount).toBe(5);
      expect(result.chunksCountIncreases[0].expectedChunksCount).toBe(2);
    });

    it('returns empty results when sizes match', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 2, gzipSizeKb: 100, brotliSizeKb: 80 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [
          { name: 'App', chunksCount: 2, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.newComponents).toHaveLength(0);
      expect(result.removedComponents).toHaveLength(0);
      expect(result.sizeChanges).toHaveLength(0);
      expect(result.chunksCountIncreases).toHaveLength(0);
    });

    it('handles empty baseline', () => {
      const comparator = new BaselineComparator({ baselineDir: tmpDir });
      const actual: ComponentSize[] = [
        { name: 'App', chunksCount: 2, gzipSizeKb: 100, brotliSizeKb: 80 },
      ];
      const baseline: BaselineConfig = {
        loadableComponents: [],
        totalgzipSizeKb: '0.00',
      };

      const result = comparator.compare(actual, baseline);
      expect(result.newComponents).toHaveLength(1);
    });
  });
});
