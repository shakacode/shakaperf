import * as fs from 'fs';
import * as path from 'path';
import { SourceMapGenerator, UNCATEGORIZED_NAME } from '../SourceMapGenerator';
import type { BundleInfo, ChunkGroupInfo } from '../types';

describe('SourceMapGenerator', () => {
  const tmpBundlesDir = path.join(__dirname, 'tmp-smg-bundles');
  const tmpBaselineDir = path.join(__dirname, 'tmp-smg-baseline');

  beforeEach(() => {
    fs.mkdirSync(tmpBundlesDir, { recursive: true });
    fs.mkdirSync(tmpBaselineDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpBundlesDir)) fs.rmSync(tmpBundlesDir, { recursive: true });
    if (fs.existsSync(tmpBaselineDir)) fs.rmSync(tmpBaselineDir, { recursive: true });
  });

  describe('UNCATEGORIZED_NAME', () => {
    it('exports correct constant', () => {
      expect(UNCATEGORIZED_NAME).toBe('uncategorized_chunks');
    });
  });

  describe('formatLabel', () => {
    it('replaces spaces with underscores', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.formatLabel('some module name')).toBe('some_module_name');
    });

    it('simplifies concatenated module labels', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.formatLabel('module + 3 modules (concatenated)')).toBe('module+concatenated_modules');
    });

    it('handles labels without special patterns', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.formatLabel('simple')).toBe('simple');
    });
  });

  describe('formatSize', () => {
    it('formats gzip size to KB string', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.formatSize(1024)).toBe(' 1.00 KB');
      expect(gen.formatSize(2560)).toBe(' 2.50 KB');
    });

    it('returns empty string for undefined or 0', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.formatSize(undefined)).toBe('');
      expect(gen.formatSize(0)).toBe('');
    });
  });

  describe('buildParentsPath', () => {
    it('returns bundlesDir prefix for empty parents', () => {
      const gen = new SourceMapGenerator({ bundlesDir: 'public/packs', baselineDir: tmpBaselineDir });
      expect(gen.buildParentsPath([])).toBe('./public/packs/');
    });

    it('returns empty string for single parent', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.buildParentsPath(['root'])).toBe('');
    });

    it('builds path from parents (skipping first)', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      expect(gen.buildParentsPath(['root', 'child', 'grandchild'])).toBe('child/grandchild/');
    });
  });

  describe('calculateChunksSize', () => {
    it('sums gzip sizes from bundles dictionary', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const dict: Record<string, BundleInfo> = {
        'chunk1.js': { label: 'chunk1.js', gzipSize: 1024 },
        'chunk2.js': { label: 'chunk2.js', gzipSize: 2048 },
      };
      expect(gen.calculateChunksSize(['chunk1.js', 'chunk2.js'], dict)).toBe(3072);
    });

    it('handles missing bundles gracefully', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const dict: Record<string, BundleInfo> = {
        'chunk1.js': { label: 'chunk1.js', gzipSize: 1024 },
      };
      expect(gen.calculateChunksSize(['chunk1.js', 'missing.js'], dict)).toBe(1024);
    });
  });

  describe('generateSeparator', () => {
    it('creates separator string with default count', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const sep = gen.generateSeparator();
      const lines = sep.split('\n').filter(Boolean);
      expect(lines).toHaveLength(20);
      expect(lines[0]).toBe('='.repeat(200));
    });

    it('creates separator with custom count', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const sep = gen.generateSeparator(3);
      const lines = sep.split('\n').filter(Boolean);
      expect(lines).toHaveLength(3);
    });
  });

  describe('generateChunkGroup', () => {
    it('generates loadable component section', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const dict: Record<string, BundleInfo> = {
        'app.js': { label: 'app.js', gzipSize: 10240 },
      };
      const output = gen.generateChunkGroup('AppComponent', ['app.js'], dict);
      expect(output).toContain('Loadable Component: name=AppComponent');
      expect(output).toContain('10.00 KB');
      expect(output).toContain('chunksNumber=1');
    });

    it('lists chunks missing from extended stats with clarification', () => {
      const gen = new SourceMapGenerator({ bundlesDir: 'public/packs', baselineDir: tmpBaselineDir });
      const dict: Record<string, BundleInfo> = {
        'app.js': { label: 'app.js', gzipSize: 10240 },
      };
      const output = gen.generateChunkGroup('AppComponent', ['app.js', 'shared-runtime.js'], dict);
      expect(output).toContain('chunksNumber=2');
      expect(output).toContain('app.js');
      expect(output).toContain('./public/packs/shared-runtime.js (no extended stats available)');
    });

    it('generates uncategorized section', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const dict: Record<string, BundleInfo> = {
        'runtime.js': { label: 'runtime.js', gzipSize: 512 },
      };
      const output = gen.generateChunkGroup('uncategorized_chunks', ['runtime.js'], dict);
      expect(output).toContain('Uncategorized Chunks:');
    });
  });

  describe('getOutputFilePath', () => {
    it('joins baselineDir with filename', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: '/output' });
      expect(gen.getOutputFilePath('map.txt')).toBe(path.join('/output', 'map.txt'));
    });
  });

  describe('generateToFile', () => {
    it('returns null when extended stats file does not exist', () => {
      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const result = gen.generateToFile('nonexistent.json', 'output.txt', [], []);
      expect(result).toBeNull();
    });

    it('generates output file from extended stats', () => {
      const extendedStats: BundleInfo[] = [
        {
          label: 'app.js',
          gzipSize: 5120,
          groups: [
            { label: 'src/App.tsx', gzipSize: 2048 },
            { label: 'src/utils.ts', gzipSize: 1024 },
          ],
        },
      ];
      fs.writeFileSync(path.join(tmpBundlesDir, 'extended-stats.json'), JSON.stringify(extendedStats));

      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const groups: ChunkGroupInfo[] = [
        { name: 'App', assetNames: ['app.js'] },
      ];
      const result = gen.generateToFile('extended-stats.json', 'source_map.txt', groups, []);

      expect(result).not.toBeNull();
      expect(fs.existsSync(result!)).toBe(true);

      const content = fs.readFileSync(result!, 'utf8');
      expect(content).toContain('Loadable Component: name=App');
      expect(content).toContain('# This file is generated automatically');
    });

    it('includes uncategorized chunks when present', () => {
      const extendedStats: BundleInfo[] = [
        { label: 'app.js', gzipSize: 1024 },
        { label: 'runtime.js', gzipSize: 512 },
      ];
      fs.writeFileSync(path.join(tmpBundlesDir, 'stats.json'), JSON.stringify(extendedStats));

      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const groups: ChunkGroupInfo[] = [
        { name: 'App', assetNames: ['app.js'] },
      ];
      const result = gen.generateToFile('stats.json', 'map.txt', groups, ['runtime.js']);

      expect(result).not.toBeNull();
      const content = fs.readFileSync(result!, 'utf8');
      expect(content).toContain('Uncategorized Chunks');
    });

    it('handles absolute path for extended stats', () => {
      const extendedStats: BundleInfo[] = [{ label: 'chunk.js', gzipSize: 256 }];
      const absolutePath = path.join(tmpBundlesDir, 'abs-stats.json');
      fs.writeFileSync(absolutePath, JSON.stringify(extendedStats));

      const gen = new SourceMapGenerator({ bundlesDir: tmpBundlesDir, baselineDir: tmpBaselineDir });
      const result = gen.generateToFile(absolutePath, 'map.txt', [], []);

      expect(result).not.toBeNull();
    });
  });

  describe('writeSources', () => {
    it('writes bundle label with size', () => {
      const gen = new SourceMapGenerator({ bundlesDir: 'bundles', baselineDir: tmpBaselineDir });
      const bundle: BundleInfo = { label: 'module.js', gzipSize: 2048 };
      const lines: string[] = [];
      gen.writeSources(bundle, [], lines);
      expect(lines[0]).toContain('module.js');
      expect(lines[0]).toContain('2.00 KB');
    });

    it('recursively writes nested groups', () => {
      const gen = new SourceMapGenerator({ bundlesDir: 'bundles', baselineDir: tmpBaselineDir });
      const bundle: BundleInfo = {
        label: 'parent',
        gzipSize: 4096,
        groups: [
          { label: 'child', gzipSize: 1024 },
        ],
      };
      const lines: string[] = [];
      gen.writeSources(bundle, ['root'], lines);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });
});
