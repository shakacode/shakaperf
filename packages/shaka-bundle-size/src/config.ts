import * as fs from 'fs';
import * as path from 'path';
import type { RegressionPolicyFunction, PolicyResult } from './types';
import { RegressionType } from './types';

export interface ThresholdConfig {
  /** Maximum allowed size increase in KB for normal components (default: 10) */
  default?: number;
  /** List of component names considered critical */
  keyComponents?: string[];
  /** Stricter threshold for key components in KB (default: 1) */
  keyComponentThreshold?: number;
}

export interface HtmlDiffConfig {
  /** Whether to generate HTML diffs (default: true) */
  enabled?: boolean;
  /** Directory for output HTML diff files (default: 'bundle-size-diffs') */
  outputDir?: string;
  /** Directory for control/baseline files for comparison (default: 'tmp/bundle_size_control') */
  controlDir?: string;
}

export interface StorageConfig {
  /** Directory for commit-based baseline storage (default: 'baseline/bundle_size') */
  storageDir?: string;
  /** Number of main branch commits to search for baseline (default: 10) */
  mainCommitsToCheck?: number;
}

/** The config structure users define in their config files. */
export interface BundleSizeConfig {
  /** Path to webpack loadable stats JSON file (required) */
  statsFile: string;

  /** Directory for baseline config files (default: 'tmp/bundle_size') */
  baselineDir?: string;
  /** Baseline config filename (default: derived from statsFile name) */
  baselineFile?: string;

  /** Threshold configuration */
  thresholds?: ThresholdConfig;

  /** Bundle names to skip during checking */
  ignoredBundles?: string[];
  /** Branch names where failures should be ignored */
  ignoredBranches?: string[];

  /** Whether to generate source map files on update (default: true) */
  generateSourceMaps?: boolean;

  /** HTML diff generation configuration */
  htmlDiffs?: HtmlDiffConfig;

  /** Baseline storage configuration for --download/--upload */
  storage?: StorageConfig;

  /** Custom regression policy function */
  regressionPolicy?: RegressionPolicyFunction;
}

/** Configuration with all defaults applied, used internally by BundleSizeChecker. */
export interface ResolvedConfig {
  /** Path to webpack loadable stats JSON file */
  statsFile: string;
  /** Directory for baseline config files */
  baselineDir: string;
  /** Baseline config filename */
  baselineFile: string;
  /** Resolved threshold configuration */
  thresholds: Required<ThresholdConfig>;
  /** Bundle names to skip */
  ignoredBundles: string[];
  /** Branch names where failures should be ignored */
  ignoredBranches: string[];
  /** Whether to generate source maps */
  generateSourceMaps: boolean;
  /** Resolved HTML diff configuration */
  htmlDiffs: Required<HtmlDiffConfig>;
  /** Resolved storage configuration */
  storage: Required<StorageConfig>;
  /** Regression policy function */
  regressionPolicy: RegressionPolicyFunction;
}

export const DEFAULT_THRESHOLDS: Required<ThresholdConfig> = {
  default: 10, // 10 KB
  keyComponents: [],
  keyComponentThreshold: 1, // 1 KB
};

export const DEFAULT_HTML_DIFFS: Required<HtmlDiffConfig> = {
  enabled: true,
  outputDir: 'bundle-size-diffs',
  controlDir: 'tmp/bundle_size_control',
};

export const DEFAULT_STORAGE: Required<StorageConfig> = {
  storageDir: 'baseline/bundle_size',
  mainCommitsToCheck: 10,
};

/** Uses threshold-based checking for size increases. */
export function createDefaultPolicy(thresholds: Required<ThresholdConfig>): RegressionPolicyFunction {
  return (regression): PolicyResult => {
    const { componentName, type, sizeDiffKb } = regression;
    const isKeyComponent = thresholds.keyComponents.includes(componentName);
    const threshold = isKeyComponent ? thresholds.keyComponentThreshold : thresholds.default;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        return { shouldFail: false };

      case RegressionType.REMOVED_COMPONENT:
        if (isKeyComponent) {
          return { shouldFail: true, message: 'Key component was removed' };
        }
        return { shouldFail: false };

      case RegressionType.INCREASED_SIZE:
        if (sizeDiffKb !== undefined && sizeDiffKb > threshold) {
          return {
            shouldFail: true,
            message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB`,
          };
        }
        return { shouldFail: false };

      case RegressionType.INCREASED_CHUNKS_COUNT:
        return { shouldFail: false };

      default:
        return { shouldFail: false };
    }
  };
}

export function defineConfig(config: BundleSizeConfig): BundleSizeConfig {
  return config;
}

/** Example: 'consumer-loadable-stats.json' -> 'consumer-config.json' */
function deriveBaselineFile(statsFile: string): string {
  const basename = path.basename(statsFile, '.json');
  const name = basename
    .replace(/-loadable-stats$/, '')
    .replace(/-stats$/, '')
    .replace(/-webpack-stats$/, '');
  return `${name}-config.json`;
}

export function resolveConfig(config: BundleSizeConfig): ResolvedConfig {
  if (!config.statsFile) {
    throw new Error('BundleSizeConfig: statsFile is required');
  }

  const thresholds: Required<ThresholdConfig> = {
    ...DEFAULT_THRESHOLDS,
    ...config.thresholds,
    keyComponents: config.thresholds?.keyComponents ?? DEFAULT_THRESHOLDS.keyComponents,
  };

  const htmlDiffs: Required<HtmlDiffConfig> = {
    ...DEFAULT_HTML_DIFFS,
    ...config.htmlDiffs,
  };

  const storage: Required<StorageConfig> = {
    ...DEFAULT_STORAGE,
    ...config.storage,
  };

  const regressionPolicy = config.regressionPolicy || createDefaultPolicy(thresholds);

  return {
    statsFile: config.statsFile,
    baselineDir: config.baselineDir ?? 'tmp/bundle_size',
    baselineFile: config.baselineFile ?? deriveBaselineFile(config.statsFile),
    thresholds,
    ignoredBundles: config.ignoredBundles ?? [],
    ignoredBranches: config.ignoredBranches ?? [],
    generateSourceMaps: config.generateSourceMaps !== false,
    htmlDiffs,
    storage,
    regressionPolicy,
  };
}

/** Supports .ts (via dynamic import) and .js files. */
export async function loadConfig(configPath: string): Promise<BundleSizeConfig> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath);

  if (ext !== '.js' && ext !== '.ts') {
    throw new Error(`Unsupported config file extension: ${ext}. Use .js or .ts`);
  }

  try {
    const configModule = await import(absolutePath);
    const config = configModule.default || configModule;

    if (!config || typeof config !== 'object') {
      throw new Error(`Config file must export a configuration object`);
    }

    return config as BundleSizeConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${absolutePath}: ${error.message}`);
    }
    throw error;
  }
}

/** Only supports .js files (TypeScript requires async import). */
export function loadConfigSync(configPath: string): BundleSizeConfig {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath);

  if (ext !== '.js') {
    throw new Error(`loadConfigSync only supports .js files. Use loadConfig for .ts files.`);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const configModule = require(absolutePath);
    const config = configModule.default || configModule;

    if (!config || typeof config !== 'object') {
      throw new Error(`Config file must export a configuration object`);
    }

    return config as BundleSizeConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${absolutePath}: ${error.message}`);
    }
    throw error;
  }
}

export function getCurrentBranch(): string | undefined {
  return (
    process.env.CIRCLE_BRANCH ||
    process.env.GITHUB_REF_NAME ||
    process.env.GIT_BRANCH ||
    undefined
  );
}

export function isBranchIgnored(config: ResolvedConfig): boolean {
  const currentBranch = getCurrentBranch();
  if (!currentBranch) {
    return false;
  }
  return config.ignoredBranches.includes(currentBranch);
}
