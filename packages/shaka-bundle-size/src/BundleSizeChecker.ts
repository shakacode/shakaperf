/**
 * BundleSizeChecker - Main orchestrator for bundle size checking.
 *
 * Coordinates the reading of webpack stats, size calculation, baseline comparison,
 * regression detection, and reporting. This is the main entry point for the library.
 */

import { WebpackStatsReader } from './WebpackStatsReader';
import { SizeCalculator } from './SizeCalculator';
import { BaselineComparator, UNCATEGORIZED_CHUNKS_NAME } from './BaselineComparator';
import { RegressionDetector, defaultPolicy } from './RegressionDetector';
import { BaselineWriter } from './BaselineWriter';
import { SourceMapGenerator } from './SourceMapGenerator';
import { HtmlDiffGenerator } from './HtmlDiffGenerator';
import { Reporter } from './Reporter';
import type {
  BundleSizeCheckerConfig,
  AppConfig,
  ThresholdConfig,
  RegressionPolicyFunction,
  IReporter,
  ComponentSize,
  ChunkGroupInfo,
  BaselineConfig,
  ComparisonResult,
  AppCheckResult,
  CheckResult,
  HtmlDiffOptions,
  UpdateBaselineResult,
} from './types';

/**
 * Main class for checking webpack bundle sizes against baselines.
 */
export class BundleSizeChecker {
  private bundlesDir: string;
  private baselineDir: string;
  private apps: AppConfig[];
  private defaultThreshold: ThresholdConfig;
  private appThresholds: Record<string, Partial<ThresholdConfig>>;
  private ignoredBundles: string[];
  private generateSourceMaps: boolean;
  private regressionPolicy: RegressionPolicyFunction;
  private reporter: IReporter;

  private statsReader: WebpackStatsReader;
  private sizeCalculator: SizeCalculator;
  private baselineComparator: BaselineComparator;
  private regressionDetector: RegressionDetector;
  private baselineWriter: BaselineWriter;
  private sourceMapGenerator: SourceMapGenerator;
  private htmlDiffGenerator: HtmlDiffGenerator;

  /**
   * Creates a new BundleSizeChecker.
   */
  constructor(config: BundleSizeCheckerConfig) {
    this.validateConfig(config);

    this.bundlesDir = config.bundlesDir;
    this.baselineDir = config.baselineDir;
    this.apps = config.apps;
    this.defaultThreshold = config.defaultThreshold || { sizeIncreaseKb: 0.1 };
    this.appThresholds = config.appThresholds || {};
    this.ignoredBundles = config.ignoredBundles || [];
    this.generateSourceMaps = config.generateSourceMaps !== false;
    this.regressionPolicy = config.regressionPolicy || defaultPolicy;

    this.reporter = config.reporter || new Reporter();

    this.statsReader = null!;
    this.sizeCalculator = null!;
    this.baselineComparator = null!;
    this.regressionDetector = null!;
    this.baselineWriter = null!;
    this.sourceMapGenerator = null!;
    this.htmlDiffGenerator = null!;

    this.initializeComponents();
  }

  /**
   * Validates the configuration object.
   */
  private validateConfig(config: BundleSizeCheckerConfig): void {
    if (!config.bundlesDir) {
      throw new Error('BundleSizeChecker: bundlesDir is required');
    }
    if (!config.baselineDir) {
      throw new Error('BundleSizeChecker: baselineDir is required');
    }
    if (!config.apps || config.apps.length === 0) {
      throw new Error('BundleSizeChecker: at least one app must be configured');
    }
  }

  /**
   * Initializes internal components.
   */
  private initializeComponents(): void {
    this.statsReader = new WebpackStatsReader({
      bundlesDir: this.bundlesDir,
      ignoredBundles: this.ignoredBundles,
    });

    this.sizeCalculator = new SizeCalculator({
      bundlesDir: this.bundlesDir,
    });

    this.baselineComparator = new BaselineComparator({
      baselineDir: this.baselineDir,
      sizeThresholdKb: this.defaultThreshold.sizeIncreaseKb,
    });

    this.regressionDetector = new RegressionDetector({
      policy: this.regressionPolicy,
    });

    this.baselineWriter = new BaselineWriter({
      baselineDir: this.baselineDir,
    });

    this.sourceMapGenerator = new SourceMapGenerator({
      bundlesDir: this.bundlesDir,
      baselineDir: this.baselineDir,
    });

    this.htmlDiffGenerator = new HtmlDiffGenerator();
  }

  /**
   * Calculates sizes for all components in an app.
   */
  calculateComponentSizes(namedChunkGroups: ChunkGroupInfo[], uncategorizedChunks: string[]): ComponentSize[] {
    const sizes: ComponentSize[] = [];

    for (const group of namedChunkGroups) {
      const { gzipSizeKb, brotliSizeKb } = this.sizeCalculator.calculateTotalSizes(group.assetNames);
      sizes.push({
        name: group.name,
        chunksCount: group.assetNames.length,
        gzipSizeKb,
        brotliSizeKb,
      });
    }

    if (uncategorizedChunks.length > 0) {
      const { gzipSizeKb, brotliSizeKb } = this.sizeCalculator.calculateTotalSizes(uncategorizedChunks);
      sizes.push({
        name: UNCATEGORIZED_CHUNKS_NAME,
        chunksCount: uncategorizedChunks.length,
        gzipSizeKb,
        brotliSizeKb,
      });
    }

    return sizes;
  }

  /**
   * Checks a single app against its baseline.
   */
  checkApp(appConfig: AppConfig): AppCheckResult {
    const { name, statsFile } = appConfig;

    this.reporter.header(`Checking ${name.toUpperCase()} app`);

    // Read webpack stats
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFile);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);

    // Calculate current sizes
    const actualSizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    // Check if baseline exists
    if (!this.baselineComparator.baselineExists(name)) {
      this.reporter.error(`No baseline found for ${name}. Run with --update to create one.`);
      return {
        name,
        passed: false,
        regressions: [],
        actualSizes,
        expectedSizes: [],
      };
    }

    // Load baseline and compare
    const baseline = this.baselineComparator.loadBaseline(name);
    const comparisonResult = this.baselineComparator.compare(actualSizes, baseline);

    // Detect and report regressions
    const regressions = this.regressionDetector.detectRegressions(name, comparisonResult);
    this.reportRegressions(actualSizes, baseline, comparisonResult);

    // Evaluate which regressions cause failures
    const { failures } = this.regressionDetector.evaluateAll(regressions);
    const passed = failures.length === 0;

    if (passed) {
      this.reporter.reportAppPassed(name);
    }

    return {
      name,
      passed,
      regressions: failures,
      actualSizes,
      expectedSizes: baseline.loadableComponents,
    };
  }

  /**
   * Reports regressions and improvements for an app.
   */
  private reportRegressions(actualSizes: ComponentSize[], baseline: BaselineConfig, comparisonResult: ComparisonResult): void {
    // Report new components
    for (const component of comparisonResult.newComponents) {
      this.reporter.reportNewComponent({
        componentName: component.name,
        sizeKb: component.gzipSizeKb,
        chunksCount: component.chunksCount,
      });
    }

    // Report removed components
    for (const component of comparisonResult.removedComponents) {
      this.reporter.reportRemovedComponent({
        componentName: component.name,
        sizeKb: component.gzipSizeKb,
      });
    }

    // Report size changes
    for (const actual of actualSizes) {
      const expected = baseline.loadableComponents.find(c => c.name === actual.name);
      if (!expected) continue;

      const actualSizeKb = Number(actual.gzipSizeKb.toFixed(2));
      const expectedSizeKb = Number(expected.gzipSizeKb);
      const sizeDiffKb = actualSizeKb - expectedSizeKb;

      if (sizeDiffKb > this.defaultThreshold.sizeIncreaseKb) {
        this.reporter.reportSizeIncrease({
          componentName: actual.name,
          sizeDiffKb,
          actualSizeKb: actual.gzipSizeKb,
          expectedSizeKb,
        });
      } else if (sizeDiffKb < 0) {
        this.reporter.reportSizeDecrease({
          componentName: actual.name,
          sizeDiffKb: -sizeDiffKb,
          actualSizeKb: actual.gzipSizeKb,
          expectedSizeKb,
        });
      }
    }

    // Report chunks count increases
    for (const comparison of comparisonResult.chunksCountIncreases) {
      this.reporter.reportIncreasedChunksCount({
        componentName: comparison.name,
        actualCount: comparison.actualChunksCount,
        expectedCount: comparison.expectedChunksCount,
      });
    }
  }

  /**
   * Runs the bundle size check for all configured apps.
   */
  check(): CheckResult {
    const appResults: AppCheckResult[] = [];
    const failedApps: string[] = [];

    for (const appConfig of this.apps) {
      const result = this.checkApp(appConfig);
      appResults.push(result);

      if (!result.passed) {
        failedApps.push(result.name);
      }
    }

    const checkResult: CheckResult = {
      passed: failedApps.length === 0,
      apps: appResults,
      failedApps,
    };

    this.reporter.summary(checkResult);

    return checkResult;
  }

  /**
   * Updates a single app's baseline.
   */
  updateAppBaseline(appConfig: AppConfig): UpdateBaselineResult {
    const { name, statsFile } = appConfig;

    this.reporter.header(`Updating ${name.toUpperCase()} baseline`);

    // Read webpack stats
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFile);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);

    // Calculate current sizes
    const sizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    // Write baseline
    const configPath = this.baselineWriter.writeBaseline(name, sizes);
    this.reporter.success(`Updated ${configPath}`);

    // Generate source map if enabled
    let sourceMapPath: string | null = null;
    if (this.generateSourceMaps) {
      sourceMapPath = this.sourceMapGenerator.generate(name, namedChunkGroups, uncategorizedChunks);
      if (sourceMapPath) {
        this.reporter.success(`Generated ${sourceMapPath}`);
      }
    }

    return {
      name,
      sizes,
      configPath,
      sourceMapPath,
    };
  }

  /**
   * Updates baselines for all configured apps.
   */
  updateBaseline(): UpdateBaselineResult[] {
    // Clear baseline directory first
    this.baselineWriter.clearDirectory();

    const results: UpdateBaselineResult[] = [];

    for (const appConfig of this.apps) {
      const result = this.updateAppBaseline(appConfig);
      results.push(result);
    }

    return results;
  }

  /**
   * Generates HTML diff artifacts comparing baseline to current.
   */
  generateHtmlDiffs(options: HtmlDiffOptions): string[] {
    const { controlDir, outputDir, templatePath, metadata = {} } = options;

    this.reporter.header('Generating HTML diff artifacts');

    const generatedFiles = this.htmlDiffGenerator.generateDiffs({
      controlDir,
      currentDir: this.baselineDir,
      outputDir,
      templatePath,
      metadata,
    });

    if (generatedFiles.length > 0) {
      this.reporter.success(`Generated ${generatedFiles.length} diff file(s) in ${outputDir}`);
    } else {
      this.reporter.info('No differences found, no diff files generated');
    }

    return generatedFiles;
  }
}
