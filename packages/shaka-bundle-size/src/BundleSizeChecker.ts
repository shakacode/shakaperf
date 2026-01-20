/**
 * BundleSizeChecker - Main orchestrator for bundle size checking.
 *
 * Coordinates the reading of webpack stats, size calculation, baseline comparison,
 * regression detection, and reporting. This is the main entry point for the library.
 */

import * as path from 'path';
import { WebpackStatsReader } from './WebpackStatsReader';
import { SizeCalculator } from './SizeCalculator';
import { BaselineComparator, UNCATEGORIZED_CHUNKS_NAME } from './BaselineComparator';
import { RegressionDetector } from './RegressionDetector';
import { BaselineWriter } from './BaselineWriter';
import { SourceMapGenerator } from './SourceMapGenerator';
import { HtmlDiffGenerator } from './HtmlDiffGenerator';
import { Reporter } from './Reporter';
import type { ResolvedConfig } from './config';
import type {
  RegressionPolicyFunction,
  IReporter,
  ComponentSize,
  ChunkGroupInfo,
  BaselineConfig,
  ComparisonResult,
  CheckResult,
  UpdateBaselineResult,
  DiffMetadata,
} from './types';

/**
 * Gets the directory containing the stats file (bundlesDir).
 */
function getBundlesDir(statsFile: string): string {
  return path.dirname(statsFile);
}

/**
 * Gets the basename of the stats file.
 */
function getStatsFilename(statsFile: string): string {
  return path.basename(statsFile);
}

/**
 * Derives a source map filename from the baseline filename.
 * Example: 'consumer-config.json' -> 'consumer_loadable_components_source_map.txt'
 */
function deriveSourceMapFilename(baselineFile: string): string {
  const basename = path.basename(baselineFile, '.json');
  const name = basename.replace(/-config$/, '');
  return `${name}_loadable_components_source_map.txt`;
}

/**
 * Derives extended stats filename from baseline filename.
 * Example: 'consumer-config.json' -> 'consumer-bundlesize-extended-stats.json'
 */
function deriveExtendedStatsFilename(baselineFile: string): string {
  const basename = path.basename(baselineFile, '.json');
  const name = basename.replace(/-config$/, '');
  return `${name}-bundlesize-extended-stats.json`;
}

/**
 * Main class for checking webpack bundle sizes against baselines.
 */
export class BundleSizeChecker {
  private statsFile: string;
  private bundlesDir: string;
  private baselineDir: string;
  private baselineFile: string;
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
  constructor(config: ResolvedConfig, reporter?: IReporter) {
    this.validateConfig(config);

    this.statsFile = config.statsFile;
    this.bundlesDir = getBundlesDir(config.statsFile);
    this.baselineDir = config.baselineDir;
    this.baselineFile = config.baselineFile;
    this.ignoredBundles = config.ignoredBundles;
    this.generateSourceMaps = config.generateSourceMaps;
    this.regressionPolicy = config.regressionPolicy;

    this.reporter = reporter || new Reporter();

    // Initialize internal components
    this.statsReader = new WebpackStatsReader({
      bundlesDir: this.bundlesDir,
      ignoredBundles: this.ignoredBundles,
    });

    this.sizeCalculator = new SizeCalculator({
      bundlesDir: this.bundlesDir,
    });

    this.baselineComparator = new BaselineComparator({
      baselineDir: this.baselineDir,
      sizeThresholdKb: 0.01, // Small threshold to detect any changes
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
   * Validates the configuration object.
   */
  private validateConfig(config: ResolvedConfig): void {
    if (!config.statsFile) {
      throw new Error('BundleSizeChecker: statsFile is required');
    }
    if (!config.baselineDir) {
      throw new Error('BundleSizeChecker: baselineDir is required');
    }
    if (!config.baselineFile) {
      throw new Error('BundleSizeChecker: baselineFile is required');
    }
  }

  /**
   * Calculates sizes for all components.
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
   * Reports regressions and improvements.
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

      if (sizeDiffKb > 0.01) {
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
   * Runs the bundle size check.
   */
  check(): CheckResult {
    this.reporter.header('Bundle Size Check');

    const statsFilename = getStatsFilename(this.statsFile);

    // Read webpack stats
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFilename);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);

    // Calculate current sizes
    const actualSizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    // Check if baseline exists
    if (!this.baselineComparator.baselineFileExists(this.baselineFile)) {
      this.reporter.error(`No baseline found at ${this.baselineFile}. Run with --update to create one.`);
      return {
        passed: false,
        regressions: [],
        actualSizes,
        expectedSizes: [],
      };
    }

    // Load baseline and compare
    const baseline = this.baselineComparator.loadBaselineFile(this.baselineFile);
    const comparisonResult = this.baselineComparator.compare(actualSizes, baseline);

    // Detect and report regressions
    const regressions = this.regressionDetector.detectRegressions(comparisonResult);
    this.reportRegressions(actualSizes, baseline, comparisonResult);

    // Evaluate which regressions cause failures
    const { failures } = this.regressionDetector.evaluateAll(regressions);
    const passed = failures.length === 0;

    if (passed) {
      this.reporter.reportPassed();
    }

    const result: CheckResult = {
      passed,
      regressions: failures,
      actualSizes,
      expectedSizes: baseline.loadableComponents,
    };

    this.reporter.summary(result);

    return result;
  }

  /**
   * Updates the baseline with current build sizes.
   */
  updateBaseline(): UpdateBaselineResult {
    this.reporter.header('Updating Baseline');

    const statsFilename = getStatsFilename(this.statsFile);

    // Read webpack stats
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFilename);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);

    // Calculate current sizes
    const sizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    // Write baseline
    const configPath = this.baselineWriter.writeBaselineFile(this.baselineFile, sizes);
    this.reporter.success(`Updated ${configPath}`);

    // Generate source map if enabled
    let sourceMapPath: string | null = null;
    if (this.generateSourceMaps) {
      const extendedStatsFile = deriveExtendedStatsFilename(this.baselineFile);
      const sourceMapFile = deriveSourceMapFilename(this.baselineFile);
      sourceMapPath = this.sourceMapGenerator.generateToFile(
        extendedStatsFile,
        sourceMapFile,
        namedChunkGroups,
        uncategorizedChunks
      );
      if (sourceMapPath) {
        this.reporter.success(`Generated ${sourceMapPath}`);
      }
    }

    return {
      sizes,
      configPath,
      sourceMapPath,
    };
  }

  /**
   * Generates HTML diff artifacts comparing baseline to current.
   */
  generateHtmlDiffs(options: {
    controlDir: string;
    outputDir: string;
    metadata?: DiffMetadata;
  }): string[] {
    const { controlDir, outputDir, metadata = {} } = options;

    this.reporter.header('Generating HTML diff artifacts');

    // Always use built-in template
    const templatePath = path.join(__dirname, '../templates/diff-template.html');

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

  /**
   * Gets the baseline directory.
   */
  getBaselineDir(): string {
    return this.baselineDir;
  }

  /**
   * Gets the baseline filename.
   */
  getBaselineFile(): string {
    return this.baselineFile;
  }
}
