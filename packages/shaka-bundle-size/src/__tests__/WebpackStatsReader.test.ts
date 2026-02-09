import * as fs from 'fs';
import * as path from 'path';
import { WebpackStatsReader } from '../WebpackStatsReader';
import type { WebpackLoadableStats, ChunkGroup } from '../types';

describe('WebpackStatsReader', () => {
  const tmpDir = path.join(__dirname, 'tmp-webpack-stats');

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

  function writeStats(filename: string, stats: WebpackLoadableStats): void {
    fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(stats));
  }

  describe('shouldIgnoreBundle', () => {
    it('returns true for ignored bundles', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir, ignoredBundles: ['vendor'] });
      expect(reader.shouldIgnoreBundle('vendor')).toBe(true);
    });

    it('returns false for non-ignored bundles', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir, ignoredBundles: ['vendor'] });
      expect(reader.shouldIgnoreBundle('app')).toBe(false);
    });

    it('returns false when no ignoredBundles configured', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      expect(reader.shouldIgnoreBundle('anything')).toBe(false);
    });
  });

  describe('extractAssetNames', () => {
    it('returns asset names from chunk group', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const chunkGroup: ChunkGroup = {
        name: 'App',
        assets: [{ name: 'app.js' }, { name: 'vendor.js' }],
      };
      expect(reader.extractAssetNames(chunkGroup)).toEqual(['app.js', 'vendor.js']);
    });

    it('throws when chunk group has no assets', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const chunkGroup: ChunkGroup = { name: 'Empty', assets: [] };
      expect(() => reader.extractAssetNames(chunkGroup)).toThrow('has no assets');
    });
  });

  describe('readStats', () => {
    it('reads and parses stats file correctly', () => {
      const stats: WebpackLoadableStats = {
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app-chunk1.js' }, { name: 'app-chunk2.js' }] },
          Header: { name: 'Header', assets: [{ name: 'header.js' }] },
        },
        chunks: [
          { files: ['app-chunk1.js'] },
          { files: ['app-chunk2.js'] },
          { files: ['header.js'] },
          { files: ['runtime.js'] },
        ],
      };
      writeStats('loadable-stats.json', stats);

      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const result = reader.readStats('loadable-stats.json');

      expect(result.namedChunkGroups).toHaveLength(2);
      expect(result.namedChunkGroups[0].name).toBe('App');
      expect(result.namedChunkGroups[0].assetNames).toEqual(['app-chunk1.js', 'app-chunk2.js']);
      expect(result.namedChunkGroups[1].name).toBe('Header');
      expect(result.allChunkFiles).toContain('runtime.js');
    });

    it('filters out ignored bundles', () => {
      const stats: WebpackLoadableStats = {
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
          Vendor: { name: 'Vendor', assets: [{ name: 'vendor.js' }] },
        },
        chunks: [
          { files: ['app.js'] },
          { files: ['vendor.js'] },
        ],
      };
      writeStats('loadable-stats.json', stats);

      const reader = new WebpackStatsReader({ bundlesDir: tmpDir, ignoredBundles: ['Vendor'] });
      const result = reader.readStats('loadable-stats.json');

      expect(result.namedChunkGroups).toHaveLength(1);
      expect(result.namedChunkGroups[0].name).toBe('App');
      // Vendor files should be removed from allChunkFiles
      expect(result.allChunkFiles.has('vendor.js')).toBe(false);
    });
  });

  describe('collectAllChunkFiles', () => {
    it('collects all files from all chunks', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const stats: WebpackLoadableStats = {
        namedChunkGroups: {},
        chunks: [
          { files: ['a.js', 'b.js'] },
          { files: ['c.js'] },
        ],
      };
      const files = reader.collectAllChunkFiles(stats);
      expect(files).toEqual(new Set(['a.js', 'b.js', 'c.js']));
    });

    it('deduplicates files across chunks', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const stats: WebpackLoadableStats = {
        namedChunkGroups: {},
        chunks: [
          { files: ['shared.js', 'a.js'] },
          { files: ['shared.js', 'b.js'] },
        ],
      };
      const files = reader.collectAllChunkFiles(stats);
      expect(files.size).toBe(3);
    });
  });

  describe('findUncategorizedChunks', () => {
    it('identifies chunks not in any named group', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const allChunkFiles = new Set(['app.js', 'vendor.js', 'runtime.js']);
      const namedChunkGroups = [
        { name: 'App', assetNames: ['app.js'] },
      ];
      const uncategorized = reader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);
      expect(uncategorized).toContain('vendor.js');
      expect(uncategorized).toContain('runtime.js');
      expect(uncategorized).not.toContain('app.js');
    });

    it('returns empty array when all chunks are categorized', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const allChunkFiles = new Set(['app.js']);
      const namedChunkGroups = [
        { name: 'App', assetNames: ['app.js'] },
      ];
      const uncategorized = reader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);
      expect(uncategorized).toEqual([]);
    });
  });

  describe('readJsonFile', () => {
    it('reads and parses a JSON file', () => {
      const data = { key: 'value' };
      fs.writeFileSync(path.join(tmpDir, 'test.json'), JSON.stringify(data));

      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      const result = reader.readJsonFile<{ key: string }>('test.json');
      expect(result).toEqual(data);
    });

    it('throws for non-existent file', () => {
      const reader = new WebpackStatsReader({ bundlesDir: tmpDir });
      expect(() => reader.readJsonFile('nonexistent.json')).toThrow();
    });
  });
});
