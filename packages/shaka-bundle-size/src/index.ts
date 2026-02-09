export {
  defineConfig,
  resolveConfig,
  loadConfig,
  loadConfigSync,
  createDefaultPolicy,
  getCurrentBranch,
  isBranchAcknowledged,
  writeAcknowledgedBranchFile,
  DEFAULT_THRESHOLDS,
  DEFAULT_HTML_DIFFS,
  DEFAULT_STORAGE,
  BundleSizeConfigSchema,
  ThresholdConfigSchema,
  HtmlDiffConfigSchema,
  StorageConfigSchema,
} from './config';
export type {
  BundleSizeConfig,
  ResolvedConfig,
  ThresholdConfig,
  HtmlDiffConfig,
  StorageConfig,
} from './config';

export * from './types';

export { BundleSizeChecker } from './BundleSizeChecker';
export { BaselineStorage } from './BaselineStorage';
export { Reporter, SilentReporter, ANSI, colorize } from './Reporter';
export { WebpackStatsReader } from './WebpackStatsReader';
export { SizeCalculator } from './SizeCalculator';
export { BaselineComparator, UNCATEGORIZED_CHUNKS_NAME } from './BaselineComparator';
export { RegressionDetector, RegressionType, defaultPolicy } from './RegressionDetector';
export { BaselineWriter } from './BaselineWriter';
export { SourceMapGenerator, UNCATEGORIZED_NAME } from './SourceMapGenerator';
export { HtmlDiffGenerator } from './HtmlDiffGenerator';
export { ExtendedStatsGenerator } from './ExtendedStatsGenerator';

export type { ColorName } from './helpers/colors';
