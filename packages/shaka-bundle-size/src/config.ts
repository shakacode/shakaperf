import * as fs from 'fs';
import * as path from 'path';
import type { RegressionPolicyFunction, PolicyResult } from './types';
import { RegressionType } from './types';

export const RESOLVING_BUNDLE_SIZE_ISSUES_DOC_URL =
  'https://github.com/shakacode/shaka-perf/blob/main/docs/resolving-bundle-size-issues.md';

export interface ThresholdConfig {
  /** Maximum allowed size increase in KB for normal components (default: 10) */
  default?: number;
  /** List of component names considered critical */
  keyComponents?: string[];
  /** Stricter threshold for key components in KB (default: 1) */
  keyComponentThreshold?: number;
  /** Minimum size in KB for a new component to trigger a review (default: 1) */
  minComponentSizeKb?: number;
}

export interface HtmlDiffConfig {
  /** Whether to generate HTML diffs (default: true) */
  enabled?: boolean;
  /** Directory for output HTML diff files (default: 'bundle-size-diffs') */
  outputDir?: string;
  /** Directory for current source maps during compare (default: 'tmp/bundle_size_current') */
  currentDir?: string;
}

export interface StorageConfig {
  /** S3/R2 bucket name for baseline storage */
  s3Bucket: string;
  /** S3/R2 key prefix for baselines (default: 'bundle-size-baselines/') */
  s3Prefix?: string;
  /** AWS region (default: uses AWS_REGION env var or 'auto'). Use 'auto' for R2. */
  awsRegion?: string;
  /** Custom endpoint URL for S3-compatible services like Cloudflare R2 (e.g., 'https://<account_id>.r2.cloudflarestorage.com') */
  endpoint?: string;
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

  /** Prefix for webpack stats and extended stats files (e.g., 'consumer' -> 'consumer-webpack-stats.json'). If not set, no prefix is used. */
  bundleNamePrefix?: string;

  /** Threshold configuration */
  thresholds?: ThresholdConfig;

  /** Bundle names to skip during checking */
  ignoredBundles?: string[];
  /** Path to file containing acknowledged branch name (for acknowledging bundle-size failures) */
  acknowledgedBranchesFilePath?: string;

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
  /** Prefix for webpack stats and extended stats files */
  bundleNamePrefix: string | undefined;
  /** Resolved threshold configuration */
  thresholds: Required<ThresholdConfig>;
  /** Bundle names to skip */
  ignoredBundles: string[];
  /** Path to file containing acknowledged branch name */
  acknowledgedBranchesFilePath: string | undefined;
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
  minComponentSizeKb: 1, // 1 KB
};

export const DEFAULT_HTML_DIFFS: Required<HtmlDiffConfig> = {
  enabled: true,
  outputDir: 'bundle-size-diffs',
  currentDir: 'tmp/bundle_size_current',
};

export const DEFAULT_STORAGE: Required<StorageConfig> = {
  s3Bucket: '',
  s3Prefix: 'bundle-size-baselines/',
  awsRegion: '',
  endpoint: '',
  mainCommitsToCheck: 10,
};

/** Uses threshold-based checking for size increases. */
export function createDefaultPolicy(thresholds: Required<ThresholdConfig>): RegressionPolicyFunction {
  return (regression): PolicyResult => {
    const { componentName, type, sizeDiffKb, sizeKb } = regression;
    const isKeyComponent = thresholds.keyComponents.includes(componentName);
    const threshold = isKeyComponent ? thresholds.keyComponentThreshold : thresholds.default;

    switch (type) {
      case RegressionType.NEW_COMPONENT:
        const minComponentSizeKbThreshold = thresholds.minComponentSizeKb;
        if (sizeKb && sizeKb < minComponentSizeKbThreshold) {
          return { shouldFail: true, message: `New component is smaller than the minimum component size of ${minComponentSizeKbThreshold}Kb. Will it make sense to introduce a new Loadable Component?` };
        }

        return { shouldFail: true, message: 'Even though introducing new components is generally a good thing, performance team would like to take a look.' };

      case RegressionType.REMOVED_COMPONENT:
        if (isKeyComponent) {
          return { shouldFail: true, message: 'Do not remove or update a key component without updating configuration to remove the key component.' };
        }
        break;

      case RegressionType.INCREASED_SIZE:
        if (sizeDiffKb !== undefined && sizeDiffKb > threshold) {
          return {
            shouldFail: true,
            message: `Size increase ${sizeDiffKb.toFixed(2)} KB exceeds threshold ${threshold} KB. Will it make sense to introduce a new Loadable Component?`,
          };
        }
        break;

      case RegressionType.INCREASED_CHUNKS_COUNT:
        return { shouldFail: true, message: 'Increasing chunks number means increased webpack and HTTP overhead. This may be bad for performance.' };

      default:
        break;
    }

    return { shouldFail: false };
  };
}

export function defineConfig(config: BundleSizeConfig): BundleSizeConfig {
  return config;
}

/** Returns baseline filename based on bundleNamePrefix */
function deriveBaselineFile(bundleNamePrefix: string | undefined): string {
  return bundleNamePrefix ? `${bundleNamePrefix}-config.json` : 'config.json';
}

export function resolveConfig(config: BundleSizeConfig): ResolvedConfig {
  if (!config.statsFile) {
    throw new Error('BundleSizeConfig: statsFile is required');
  }

  if (!config.storage?.s3Bucket) {
    throw new Error('BundleSizeConfig: storage.s3Bucket is required');
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
    baselineFile: config.baselineFile ?? deriveBaselineFile(config.bundleNamePrefix),
    bundleNamePrefix: config.bundleNamePrefix,
    thresholds,
    ignoredBundles: config.ignoredBundles ?? [],
    acknowledgedBranchesFilePath: config.acknowledgedBranchesFilePath,
    generateSourceMaps: config.generateSourceMaps !== false,
    htmlDiffs,
    storage,
    regressionPolicy,
  };
}

/** Supports .ts (via tsx/tsImport) and .js files. */
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
    let configModule;

    if (ext === '.ts') {
      // Use tsx's tsImport for TypeScript files
      // tsImport returns { default: { default: actualConfig } } for ESM default exports
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tsImport } = require('tsx/esm/api');
      const tsModule = await tsImport(absolutePath, __filename);
      // Unwrap the double-nested default export
      configModule = tsModule.default?.default ?? tsModule.default ?? tsModule;
    } else {
      configModule = await import(absolutePath);
    }

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
  // First try environment variables (CI providers)
  const envBranch =
    process.env.CIRCLE_BRANCH ||
    process.env.GITHUB_REF_NAME ||
    process.env.GIT_BRANCH;

  if (envBranch) {
    return envBranch;
  }

  // Fallback to git command
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    // Avoid returning 'HEAD' in detached state
    return branch !== 'HEAD' ? branch : undefined;
  } catch {
    // Git not available or not in a git repo
    return undefined;
  }
}

export function isBranchAcknowledged(config: ResolvedConfig): boolean {
  const currentBranch = getCurrentBranch();
  if (!currentBranch || !config.acknowledgedBranchesFilePath) {
    return false;
  }

  try {
    const filePath = path.resolve(config.acknowledgedBranchesFilePath);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Find the first non-comment, non-empty line (the branch name)
    const acknowledgedBranch = lines
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'));

    return acknowledgedBranch === currentBranch;
  } catch {
    return false;
  }
}

export function writeAcknowledgedBranchFile(filePath: string, branchName?: string): void {
  const currentBranch = branchName ?? getCurrentBranch();
  if (!currentBranch) {
    throw new Error('Cannot determine current branch. ');
  }

  const content = `# This file contains the branch name where CI will ignore the bundle-size failure.
# It is auto-generated by running \`shaka-bundle-size --acknowledge-failure\`.
#
# When resolving conflicts keep your branch and discard the irrelevant branch.
${currentBranch}
#
# Docs: ${RESOLVING_BUNDLE_SIZE_ISSUES_DOC_URL}
`;

  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absolutePath, content, 'utf8');
}
