/**
 * shaka-bundle-size
 * Bundle size diffing and analysis for React apps with loadable components
 */

// Config utilities
export {
  defineConfig,
  resolveConfig,
  loadConfig,
  loadConfigSync,
  createDefaultPolicy,
  getCurrentBranch,
  isBranchIgnored,
  DEFAULT_THRESHOLDS,
  DEFAULT_HTML_DIFFS,
} from './config';
export type {
  BundleSizeConfig,
  ResolvedConfig,
  ThresholdConfig,
  HtmlDiffConfig,
} from './config';

// Types - export all types from types.ts
export * from './types';

// Core classes
export { BundleSizeChecker } from './BundleSizeChecker';
export { Reporter, SilentReporter, ANSI, colorize } from './Reporter';
export { WebpackStatsReader } from './WebpackStatsReader';
export { SizeCalculator } from './SizeCalculator';
export { BaselineComparator, UNCATEGORIZED_CHUNKS_NAME } from './BaselineComparator';
export { RegressionDetector, RegressionType, defaultPolicy } from './RegressionDetector';
export { BaselineWriter } from './BaselineWriter';
export { SourceMapGenerator, UNCATEGORIZED_NAME } from './SourceMapGenerator';
export { HtmlDiffGenerator } from './HtmlDiffGenerator';

// Re-export color utilities from helpers
export type { ColorName } from './helpers/colors';
