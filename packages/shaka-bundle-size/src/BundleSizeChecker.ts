/**
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

function getBundlesDir(statsFile: string): string {
  return path.dirname(statsFile);
}

function getStatsFilename(statsFile: string): string {
  return path.basename(statsFile);
}

/** Returns source map filename based on bundleNamePrefix */
function deriveSourceMapFilename(bundleNamePrefix: string | undefined): string {
  return bundleNamePrefix
    ? `${bundleNamePrefix}_loadable_components_source_map.txt`
    : 'loadable_components_source_map.txt';
}

/** Returns extended stats filename based on bundleNamePrefix */
function deriveExtendedStatsFilename(bundleNamePrefix: string | undefined): string {
  return bundleNamePrefix
    ? `${bundleNamePrefix}-bundlesize-extended-stats.json`
    : 'bundlesize-extended-stats.json';
}

export class BundleSizeChecker {
  private statsFile: string;
  private bundlesDir: string;
  private baselineDir: string;
  private baselineFile: string;
  private bundleNamePrefix: string | undefined;
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

  constructor(config: ResolvedConfig, reporter?: IReporter) {
    this.validateConfig(config);

    this.statsFile = config.statsFile;
    this.bundlesDir = getBundlesDir(config.statsFile);
    this.baselineDir = config.baselineDir;
    this.baselineFile = config.baselineFile;
    this.bundleNamePrefix = config.bundleNamePrefix;
    this.ignoredBundles = config.ignoredBundles;
    this.generateSourceMaps = config.generateSourceMaps;
    this.regressionPolicy = config.regressionPolicy;

    this.reporter = reporter || new Reporter();

    this.statsReader = new WebpackStatsReader({
      bundlesDir: this.bundlesDir,
      ignoredBundles: this.ignoredBundles,
    });

    this.sizeCalculator = new SizeCalculator({
      bundlesDir: this.bundlesDir,
      onMissingFile: (filePath) => {
        this.reporter.verbose(`Missing compressed file: ${filePath}`);
      },
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

  private reportRegressions(actualSizes: ComponentSize[], baseline: BaselineConfig, comparisonResult: ComparisonResult): void {
    for (const component of comparisonResult.newComponents) {
      this.reporter.reportNewComponent({
        componentName: component.name,
        sizeKb: component.gzipSizeKb,
        chunksCount: component.chunksCount,
      });
    }

    for (const component of comparisonResult.removedComponents) {
      this.reporter.reportRemovedComponent({
        componentName: component.name,
        sizeKb: component.gzipSizeKb,
      });
    }

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

    for (const comparison of comparisonResult.chunksCountIncreases) {
      this.reporter.reportIncreasedChunksCount({
        componentName: comparison.name,
        actualCount: comparison.actualChunksCount,
        expectedCount: comparison.expectedChunksCount,
      });
    }
  }

  check(): CheckResult {
    this.reporter.header('Bundle Size Check');

    const statsFilename = getStatsFilename(this.statsFile);
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFilename);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);
    const actualSizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    if (!this.baselineComparator.baselineFileExists(this.baselineFile)) {
      this.reporter.error(`No baseline found at ${this.baselineFile}. Run with  --download-main-branch-stats to create one.`);
      return {
        passed: false,
        regressions: [],
        actualSizes,
        expectedSizes: [],
      };
    }

    const baseline = this.baselineComparator.loadBaselineFile(this.baselineFile);
    const comparisonResult = this.baselineComparator.compare(actualSizes, baseline);
    const regressions = this.regressionDetector.detectRegressions(comparisonResult);
    this.reportRegressions(actualSizes, baseline, comparisonResult);
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

  updateBaseline(): UpdateBaselineResult {
    this.reporter.header('Updating Baseline');

    const statsFilename = getStatsFilename(this.statsFile);
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFilename);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);
    const sizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);
    const configPath = this.baselineWriter.writeBaselineFile(this.baselineFile, sizes);
    this.reporter.success(`Updated ${configPath}`);

    let sourceMapPath: string | null = null;
    if (this.generateSourceMaps) {
      const extendedStatsFile = deriveExtendedStatsFilename(this.bundleNamePrefix);
      const sourceMapFile = deriveSourceMapFilename(this.bundleNamePrefix);
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

  generateCurrentStatsTo(outputDir: string): { configPath: string; sourceMapPath: string | null } {
    const statsFilename = getStatsFilename(this.statsFile);
    const { namedChunkGroups, allChunkFiles } = this.statsReader.readStats(statsFilename);
    const uncategorizedChunks = this.statsReader.findUncategorizedChunks(allChunkFiles, namedChunkGroups);
    const sizes = this.calculateComponentSizes(namedChunkGroups, uncategorizedChunks);

    const tempWriter = new BaselineWriter({ baselineDir: outputDir });
    const configPath = tempWriter.writeBaselineFile(this.baselineFile, sizes);

    const tempGenerator = new SourceMapGenerator({
      bundlesDir: this.bundlesDir,
      baselineDir: outputDir,
    });

    const extendedStatsFile = deriveExtendedStatsFilename(this.bundleNamePrefix);
    const sourceMapFile = deriveSourceMapFilename(this.bundleNamePrefix);

    const sourceMapPath = tempGenerator.generateToFile(
      extendedStatsFile,
      sourceMapFile,
      namedChunkGroups,
      uncategorizedChunks
    );

    return { configPath, sourceMapPath };
  }

  generateHtmlDiffs(options: {
    controlDir: string;
    currentDir: string;
    outputDir: string;
    metadata?: DiffMetadata;
  }): string[] {
    const { controlDir, currentDir, outputDir, metadata = {} } = options;

    this.reporter.header('Generating HTML diff artifacts');
    const templatePath = path.join(__dirname, '../templates/diff-template.html');

    const generatedFiles = this.htmlDiffGenerator.generateDiffs({
      controlDir,
      currentDir,
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

  getBaselineDir(): string {
    return this.baselineDir;
  }

  getBaselineFile(): string {
    return this.baselineFile;
  }
}
