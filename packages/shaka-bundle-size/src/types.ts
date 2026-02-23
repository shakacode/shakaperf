/**
 * Bundle Size Checker - Type Definitions
 *
 * TypeScript type definitions for the bundle size checking library.
 */

/**
 * Types of regressions that can be detected.
 */
export enum RegressionType {
  NEW_COMPONENT = 'newComponent',
  REMOVED_COMPONENT = 'removedComponent',
  INCREASED_SIZE = 'increasedSize',
  INCREASED_CHUNKS_COUNT = 'increasedChunksCount',
}

/**
 * Verbosity level for the reporter.
 */
export type VerbosityLevel = 'quiet' | 'normal' | 'verbose';

/**
 * Result of a regression policy evaluation.
 */
export interface PolicyResult {
  /** Whether this regression should cause a failure */
  shouldFail: boolean;
  /** Optional message explaining the decision */
  message?: string;
}

/**
 * Information about a detected regression.
 */
export interface Regression {
  /** Name of the affected component */
  componentName: string;
  /** Type of regression detected */
  type: RegressionType;
  /** Size in KB (for size-related regressions) */
  sizeKb?: number;
  /** Size difference in KB (for increasedSize) */
  sizeDiffKb?: number;
  /** Expected size from baseline */
  expectedSizeKb?: number;
  /** Actual size from current build */
  actualSizeKb?: number;
  /** Expected chunk count from baseline */
  expectedChunksCount?: number;
  /** Actual chunk count from current build */
  actualChunksCount?: number;
  /** Number of chunks (for new components) */
  chunksCount?: number;
  /** Policy message explaining the evaluation result */
  policyMessage?: string;
}

/**
 * A function that determines whether a regression should cause a failure.
 */
export type RegressionPolicyFunction = (regression: Regression) => PolicyResult;

/**
 * Reporter interface for outputting check results.
 */
export interface IReporter {
  /** Log informational message */
  info(message: string): void;
  /** Log success message */
  success(message: string): void;
  /** Log warning message */
  warning(message: string): void;
  /** Log error message */
  error(message: string): void;
  /** Log a section header */
  header(title: string): void;
  /** Log verbose message (only in verbose mode) */
  verbose(message: string): void;
  /** Output final summary */
  summary(result: CheckResult): void;
  /** Report a size increase */
  reportSizeIncrease(params: SizeIncreaseParams): void;
  /** Report a size decrease */
  reportSizeDecrease(params: SizeDecreaseParams): void;
  /** Report a new component */
  reportNewComponent(params: NewComponentParams): void;
  /** Report a removed component */
  reportRemovedComponent(params: RemovedComponentParams): void;
  /** Report an increased chunks count */
  reportIncreasedChunksCount(params: ChunksCountParams): void;
  /** Report that all components passed */
  reportPassed(): void;
}

export interface SizeIncreaseParams {
  componentName: string;
  sizeDiffKb: number;
  actualSizeKb: number;
  expectedSizeKb: number;
}

export interface SizeDecreaseParams {
  componentName: string;
  sizeDiffKb: number;
  actualSizeKb: number;
  expectedSizeKb: number;
}

export interface NewComponentParams {
  componentName: string;
  sizeKb: number;
  chunksCount: number;
}

export interface RemovedComponentParams {
  componentName: string;
  sizeKb: number | string;
}

export interface ChunksCountParams {
  componentName: string;
  actualCount: number;
  expectedCount: number;
}

/**
 * Size information for a component.
 */
export interface ComponentSize {
  /** Component name */
  name: string;
  /** Number of chunks in this component */
  chunksCount: number;
  /** Size in KB when brotli compressed */
  brotliSizeKb: number;
  /** Size in KB when gzip compressed */
  gzipSizeKb: number;
}

/**
 * Baseline configuration stored in JSON files.
 */
export interface BaselineConfig {
  /** List of components with expected sizes */
  loadableComponents: BaselineComponent[];
  /** Total gzip size as string (for display) */
  totalgzipSizeKb: string;
}

/**
 * A component entry in the baseline config.
 */
export interface BaselineComponent {
  /** Component name */
  name: string;
  /** Expected number of chunks */
  chunksCount: number;
  /** Expected brotli size as string (e.g., "123.45") */
  brotliSizeKb: string;
  /** Expected gzip size as string (e.g., "123.45") */
  gzipSizeKb: string;
}

/**
 * Result of the bundle size check.
 */
export interface CheckResult {
  /** Whether all checks passed */
  passed: boolean;
  /** List of detected regressions that caused failures */
  regressions: Regression[];
  /** List of detected regressions that did not cause failures */
  warnings: Regression[];
  /** Actual sizes from current build */
  actualSizes: ComponentSize[];
  /** Expected sizes from baseline */
  expectedSizes: BaselineComponent[];
  /** Comparison result with per-component change details (used for grouped reporting) */
  comparison?: ComparisonResult;
}

/**
 * Webpack loadable stats structure (from @loadable/webpack-plugin).
 */
export interface WebpackLoadableStats {
  /** Named chunk groups by name */
  namedChunkGroups: Record<string, ChunkGroup>;
  /** All chunks in the build */
  chunks: Chunk[];
}

/**
 * A chunk group from webpack stats.
 */
export interface ChunkGroup {
  /** Chunk group name */
  name: string;
  /** Assets in this chunk group */
  assets: Asset[];
}

/**
 * An asset in a chunk group.
 */
export interface Asset {
  /** Asset filename */
  name: string;
}

/**
 * A chunk from webpack stats.
 */
export interface Chunk {
  /** Files in this chunk */
  files: string[];
}

/**
 * Represents a chunk group extracted from webpack stats.
 */
export interface ChunkGroupInfo {
  /** Chunk group name */
  name: string;
  /** List of asset filenames */
  assetNames: string[];
}

/**
 * Result of reading webpack stats.
 */
export interface WebpackStatsResult {
  /** Named chunk groups */
  namedChunkGroups: ChunkGroupInfo[];
  /** All chunk files in the build */
  allChunkFiles: Set<string>;
}

/**
 * Represents a size comparison result.
 */
export interface SizeComparison {
  /** Component name */
  name: string;
  /** Actual gzip size in KB */
  actualSizeKb: number;
  /** Expected gzip size in KB */
  expectedSizeKb: number;
  /** Size difference (actual - expected) */
  sizeDiffKb: number;
  /** Actual number of chunks */
  actualChunksCount: number;
  /** Expected number of chunks */
  expectedChunksCount: number;
}

/**
 * Comparison results for all components.
 */
export interface ComparisonResult {
  /** Components with size changes */
  sizeChanges: SizeComparison[];
  /** New components not in baseline */
  newComponents: ComponentSize[];
  /** Components in baseline but not in build */
  removedComponents: BaselineComponent[];
  /** Components with more chunks than expected */
  chunksCountIncreases: SizeComparison[];
}

/**
 * Configuration for WebpackStatsReader.
 */
export interface WebpackStatsReaderConfig {
  /** Directory containing webpack bundles */
  bundlesDir: string;
  /** Bundle names to ignore */
  ignoredBundles?: string[];
}

/**
 * Configuration for SizeCalculator.
 */
export interface SizeCalculatorConfig {
  /** Directory containing webpack bundles */
  bundlesDir: string;
  /** Optional callback invoked when a compressed file (.gz or .br) is missing */
  onMissingFile?: (filePath: string) => void;
}

/**
 * Size result for a chunk.
 */
export interface ChunkSizes {
  /** Gzip size in bytes */
  gzip: number;
  /** Brotli size in bytes */
  brotli: number;
}

/**
 * Total sizes in KB.
 */
export interface TotalSizes {
  /** Total gzip size in KB */
  gzipSizeKb: number;
  /** Total brotli size in KB */
  brotliSizeKb: number;
}

/**
 * Configuration for BaselineComparator.
 */
export interface BaselineComparatorConfig {
  /** Directory containing baseline configs */
  baselineDir: string;
  /** Minimum size change to report */
  sizeThresholdKb?: number;
}

/**
 * Configuration for RegressionDetector.
 */
export interface RegressionDetectorConfig {
  /** Policy function to evaluate regressions */
  policy?: RegressionPolicyFunction;
}

/**
 * Evaluation result for regressions.
 */
export interface EvaluationResult {
  /** Regressions that should cause failure */
  failures: Regression[];
  /** Regressions that are warnings only */
  warnings: Regression[];
}

/**
 * Configuration for BaselineWriter.
 */
export interface BaselineWriterConfig {
  /** Directory for baseline config files */
  baselineDir: string;
}

/**
 * Configuration for SourceMapGenerator.
 */
export interface SourceMapGeneratorConfig {
  /** Directory containing webpack bundles */
  bundlesDir: string;
  /** Directory for output files */
  baselineDir: string;
}

/**
 * Bundle info from extended stats.
 */
export interface BundleInfo {
  /** Bundle label */
  label: string;
  /** Gzip size in bytes */
  gzipSize?: number;
  /** Nested groups */
  groups?: BundleInfo[];
}

/**
 * Metadata to inject into HTML diffs.
 */
export interface DiffMetadata {
  /** Master branch commit SHA */
  masterCommit?: string;
  /** Current branch name */
  branchName?: string;
  /** Current commit SHA */
  currentCommit?: string;
}

/**
 * Options for generating a single diff.
 */
export interface SingleDiffOptions {
  /** Name of the file to diff */
  filename: string;
  /** Directory containing control/baseline files */
  controlDir: string;
  /** Directory containing current files */
  currentDir: string;
  /** Directory for output HTML files */
  outputDir: string;
  /** Path to custom HTML template */
  templatePath: string;
  /** Metadata to inject into HTML */
  metadata: DiffMetadata;
}

/**
 * Options for generating all diffs.
 */
export interface GenerateDiffsOptions {
  /** Directory containing control/baseline files */
  controlDir: string;
  /** Directory containing current files */
  currentDir: string;
  /** Directory for output HTML files */
  outputDir: string;
  /** Path to custom HTML template */
  templatePath: string;
  /** Metadata to inject into HTML */
  metadata?: DiffMetadata;
}

/**
 * Options for generating HTML diffs via BundleSizeChecker.
 */
export interface HtmlDiffOptions {
  /** Directory containing baseline/control files */
  controlDir: string;
  /** Directory for output HTML files */
  outputDir: string;
  /** Path to custom HTML template */
  templatePath: string;
  /** Metadata to inject into HTML */
  metadata?: DiffMetadata;
}

/**
 * Result of updating the baseline.
 */
export interface UpdateBaselineResult {
  /** Component sizes */
  sizes: ComponentSize[];
  /** Path to the written config file */
  configPath: string;
  /** Path to the source map file (if generated) */
  sourceMapPath: string | null;
}

/**
 * Options for Reporter constructor.
 */
export interface ReporterOptions {
  /** Output verbosity level */
  verbosity?: VerbosityLevel;
  /** Whether to use ANSI colors */
  colors?: boolean;
  /** Output stream */
  output?: NodeJS.WriteStream;
}

