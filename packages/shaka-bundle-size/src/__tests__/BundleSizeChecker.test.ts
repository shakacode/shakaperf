import * as fs from 'fs';
import * as path from 'path';
import { BundleSizeChecker } from '../BundleSizeChecker';
import { SilentReporter } from '../Reporter';
import type { ResolvedConfig } from '../config';
import { DEFAULT_THRESHOLDS, DEFAULT_HTML_DIFFS, DEFAULT_STORAGE, createDefaultPolicy } from '../config';
import type { WebpackLoadableStats, BaselineConfig } from '../types';

describe('BundleSizeChecker', () => {
  const tmpDir = path.join(__dirname, 'tmp-bundle-checker');
  const bundlesDir = path.join(tmpDir, 'public/packs');
  const baselineDir = path.join(tmpDir, 'baseline');

  function createConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
    return {
      statsFile: path.join(bundlesDir, 'loadable-stats.json'),
      baselineDir,
      baselineFile: 'config.json',
      bundleNamePrefix: undefined,
      thresholds: DEFAULT_THRESHOLDS,
      ignoredBundles: [],
      acknowledgedBranchesFilePath: undefined,
      generateSourceMaps: false,
      currentStatsDir: path.join(tmpDir, 'current_stats'),
      htmlDiffs: DEFAULT_HTML_DIFFS,
      storage: { ...DEFAULT_STORAGE, s3Bucket: 'test-bucket' },
      regressionPolicy: createDefaultPolicy(DEFAULT_THRESHOLDS),
      ...overrides,
    };
  }

  function writeStatsFile(stats: WebpackLoadableStats): void {
    fs.writeFileSync(path.join(bundlesDir, 'loadable-stats.json'), JSON.stringify(stats));
  }

  function writeBaseline(baseline: BaselineConfig): void {
    fs.writeFileSync(path.join(baselineDir, 'config.json'), JSON.stringify(baseline));
  }

  function createCompressedFiles(filename: string, gzipBytes: number, brotliBytes: number): void {
    fs.writeFileSync(path.join(bundlesDir, `${filename}.gz`), Buffer.alloc(gzipBytes, 'x'));
    fs.writeFileSync(path.join(bundlesDir, `${filename}.br`), Buffer.alloc(brotliBytes, 'x'));
  }

  beforeEach(() => {
    fs.mkdirSync(bundlesDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('creates instance with valid config', () => {
      const config = createConfig();
      const checker = new BundleSizeChecker(config, new SilentReporter());
      expect(checker).toBeDefined();
    });

    it('throws when statsFile is missing', () => {
      expect(() => new BundleSizeChecker(
        createConfig({ statsFile: '' }),
        new SilentReporter(),
      )).toThrow('statsFile is required');
    });

    it('throws when baselineDir is missing', () => {
      expect(() => new BundleSizeChecker(
        createConfig({ baselineDir: '' }),
        new SilentReporter(),
      )).toThrow('baselineDir is required');
    });

    it('throws when baselineFile is missing', () => {
      expect(() => new BundleSizeChecker(
        createConfig({ baselineFile: '' }),
        new SilentReporter(),
      )).toThrow('baselineFile is required');
    });
  });

  describe('getBaselineDir / getBaselineFile', () => {
    it('returns configured values', () => {
      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      expect(checker.getBaselineDir()).toBe(baselineDir);
      expect(checker.getBaselineFile()).toBe('config.json');
    });
  });

  describe('calculateComponentSizes', () => {
    it('calculates sizes for named chunk groups', () => {
      createCompressedFiles('app.js', 10240, 8192);
      createCompressedFiles('header.js', 5120, 4096);

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const sizes = checker.calculateComponentSizes(
        [
          { name: 'App', assetNames: ['app.js'] },
          { name: 'Header', assetNames: ['header.js'] },
        ],
        []
      );

      expect(sizes).toHaveLength(2);
      expect(sizes[0].name).toBe('App');
      expect(sizes[0].gzipSizeKb).toBe(10); // 10240 / 1024
      expect(sizes[0].chunksCount).toBe(1);
      expect(sizes[1].name).toBe('Header');
    });

    it('includes uncategorized chunks when present', () => {
      createCompressedFiles('app.js', 1024, 512);
      createCompressedFiles('runtime.js', 512, 256);

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const sizes = checker.calculateComponentSizes(
        [{ name: 'App', assetNames: ['app.js'] }],
        ['runtime.js']
      );

      expect(sizes).toHaveLength(2);
      expect(sizes[1].name).toBe('uncategorized chunks');
      expect(sizes[1].chunksCount).toBe(1);
    });

    it('skips uncategorized when empty', () => {
      createCompressedFiles('app.js', 1024, 512);

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const sizes = checker.calculateComponentSizes(
        [{ name: 'App', assetNames: ['app.js'] }],
        []
      );

      expect(sizes).toHaveLength(1);
    });
  });

  describe('check', () => {
    it('returns failed result when no baseline exists', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 1024, 512);

      // Remove baseline
      fs.rmSync(baselineDir, { recursive: true });
      fs.mkdirSync(baselineDir, { recursive: true });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.check();
      expect(result.passed).toBe(false);
      expect(result.regressions).toHaveLength(0);
    });

    it('returns passed result when sizes match baseline', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 102400, 81920);

      writeBaseline({
        loadableComponents: [
          { name: 'App', chunksCount: 1, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.check();
      expect(result.passed).toBe(true);
      expect(result.regressions).toHaveLength(0);
    });

    it('detects regressions when sizes increase beyond threshold', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      // 120KB gzip (increase of 20KB from 100KB baseline)
      createCompressedFiles('app.js', 122880, 81920);

      writeBaseline({
        loadableComponents: [
          { name: 'App', chunksCount: 1, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.check();
      expect(result.passed).toBe(false);
      expect(result.regressions.length).toBeGreaterThan(0);
    });

    it('detects new components', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
          NewWidget: { name: 'NewWidget', assets: [{ name: 'widget.js' }] },
        },
        chunks: [{ files: ['app.js'] }, { files: ['widget.js'] }],
      });
      createCompressedFiles('app.js', 102400, 81920);
      createCompressedFiles('widget.js', 51200, 40960);

      writeBaseline({
        loadableComponents: [
          { name: 'App', chunksCount: 1, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.check();
      expect(result.passed).toBe(false);
    });

    it('populates actualSizes and expectedSizes in result', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 102400, 81920);

      writeBaseline({
        loadableComponents: [
          { name: 'App', chunksCount: 1, gzipSizeKb: '100.00', brotliSizeKb: '80.00' },
        ],
        totalgzipSizeKb: '100.00',
      });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.check();
      expect(result.actualSizes.length).toBeGreaterThan(0);
      expect(result.expectedSizes.length).toBeGreaterThan(0);
    });
  });

  describe('updateBaseline', () => {
    it('writes new baseline file', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 102400, 81920);

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.updateBaseline();

      expect(result.configPath).toBeTruthy();
      expect(fs.existsSync(result.configPath)).toBe(true);
      expect(result.sizes).toHaveLength(1);
      expect(result.sizes[0].name).toBe('App');
    });

    it('returns null sourceMapPath when generateSourceMaps is false', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 1024, 512);

      const checker = new BundleSizeChecker(
        createConfig({ generateSourceMaps: false }),
        new SilentReporter()
      );
      const result = checker.updateBaseline();
      expect(result.sourceMapPath).toBeNull();
    });
  });

  describe('generateCurrentStatsTo', () => {
    it('writes current stats to specified directory', () => {
      writeStatsFile({
        namedChunkGroups: {
          App: { name: 'App', assets: [{ name: 'app.js' }] },
        },
        chunks: [{ files: ['app.js'] }],
      });
      createCompressedFiles('app.js', 1024, 512);

      const outputDir = path.join(tmpDir, 'current-output');
      fs.mkdirSync(outputDir, { recursive: true });

      const checker = new BundleSizeChecker(createConfig(), new SilentReporter());
      const result = checker.generateCurrentStatsTo(outputDir);

      expect(fs.existsSync(result.configPath)).toBe(true);
    });
  });
});
