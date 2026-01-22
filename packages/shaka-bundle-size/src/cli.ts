#!/usr/bin/env node

import 'dotenv/config';
import { parseArgs } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveConfig, isBranchIgnored, getCurrentBranch } from './config';
import { BundleSizeChecker } from './BundleSizeChecker';
import { BaselineStorage } from './BaselineStorage';
import { ExtendedStatsGenerator } from './ExtendedStatsGenerator';
import { Reporter } from './Reporter';
import { colorize } from './helpers/colors';

const VERSION = '0.0.3';

const HELP = `
shaka-bundle-size - Bundle size checking for webpack builds

Usage:
  shaka-bundle-size --config <file> [command] [options]

Commands:
  --download-main-branch-stats  Download baseline from main branch (finds merge-base)
  --compare                     Generate current stats and compare against baseline
  --upload-main-branch-stats    Generate and upload baseline for current commit

Options:
  -c, --config <file>    Config file path (.js or .ts) [required]
      --commit <sha>     Specific commit SHA (for download or upload)
      --no-html-diffs    Skip HTML diff generation
  -v, --verbose          Verbose output
  -q, --quiet            Quiet output (errors only)
  -h, --help             Show this help message
      --version          Show version

Examples:
  # Feature branch: download baseline and compare
  shaka-bundle-size -c app.config.js --download-main-branch-stats
  shaka-bundle-size -c app.config.js --compare

  # Download from specific commit
  shaka-bundle-size -c app.config.js --download-main-branch-stats --commit abc1234

  # Main branch: upload new baseline after merge
  shaka-bundle-size -c app.config.js --upload-main-branch-stats

  # Upload baseline for specific commit
  shaka-bundle-size -c app.config.js --upload-main-branch-stats --commit abc1234

Exit codes:
  0  Success / Check passed
  1  Check failed (regressions detected)
  2  Configuration or runtime error
`;

interface CliOptions {
  config?: string;
  downloadMainBranchStats: boolean;
  compare: boolean;
  uploadMainBranchStats: boolean;
  commit?: string;
  noHtmlDiffs: boolean;
  verbose: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      'download-main-branch-stats': { type: 'boolean', default: false },
      compare: { type: 'boolean', default: false },
      'upload-main-branch-stats': { type: 'boolean', default: false },
      commit: { type: 'string' },
      'no-html-diffs': { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
    strict: true,
  });

  return {
    config: values.config as string | undefined,
    downloadMainBranchStats: values['download-main-branch-stats'] as boolean,
    compare: values.compare as boolean,
    uploadMainBranchStats: values['upload-main-branch-stats'] as boolean,
    commit: values.commit as string | undefined,
    noHtmlDiffs: values['no-html-diffs'] as boolean,
    verbose: values.verbose as boolean,
    quiet: values.quiet as boolean,
    help: values.help as boolean,
    version: values.version as boolean,
  };
}

function showHelp(): void {
  console.log(HELP);
}

function showVersion(): void {
  console.log(`shaka-bundle-size v${VERSION}`);
}

function getCiMetadata(mainBranch: string): { branchName: string; currentCommit: string; masterCommit: string } {
  const branchName = getCurrentBranch() || '';
  const currentCommit = (process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || '').substring(0, 7);

  let masterCommit = '';
  try {
    const { execSync } = require('child_process');
    masterCommit = execSync(`git rev-parse origin/${mainBranch}`, { encoding: 'utf8' }).trim().substring(0, 7);
  } catch {
    // Ignore if git is not available
  }

  return { branchName, currentCommit, masterCommit };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  if (!args.config) {
    console.error(colorize.red('Error: --config is required'));
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  let resolvedConfig;
  try {
    const userConfig = await loadConfig(args.config);
    resolvedConfig = resolveConfig(userConfig);
  } catch (error) {
    console.error(colorize.red(`Error loading config: ${(error as Error).message}`));
    process.exit(2);
  }

  const verbosity = args.quiet ? 'quiet' : args.verbose ? 'verbose' : 'normal';
  const reporter = new Reporter({ verbosity });

  const storage = new BaselineStorage({
    s3Bucket: resolvedConfig.storage.s3Bucket,
    s3Prefix: resolvedConfig.storage.s3Prefix,
    awsRegion: resolvedConfig.storage.awsRegion,
    endpoint: resolvedConfig.storage.endpoint,
    baselineDir: resolvedConfig.baselineDir,
    mainCommitsToCheck: resolvedConfig.storage.mainCommitsToCheck,
    mainBranch: resolvedConfig.storage.mainBranch,
  });

  if (args.downloadMainBranchStats) {
    try {
      reporter.info('Downloading main branch baseline from S3...');
      const commit = args.commit
        ? await storage.downloadForCommit(args.commit)
        : await storage.download();

      if (commit) {
        reporter.success(`Found baseline for commit ${commit.substring(0, 7)}`);
      } else {
        reporter.error(`No baseline found${args.commit ? ` for commit ${args.commit}` : ` in last ${resolvedConfig.storage.mainCommitsToCheck} main commits`}`);
        process.exit(2);
      }
      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error downloading baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  }

  const checker = new BundleSizeChecker(resolvedConfig, reporter);

  if (args.uploadMainBranchStats) {
    try {
      // Generate extended stats first (needed for source maps)
      if (resolvedConfig.generateSourceMaps) {
        const bundlesDir = path.dirname(resolvedConfig.statsFile);
        const extendedStatsGenerator = new ExtendedStatsGenerator({ bundlesDir });
        const loadableStatsFilename = path.basename(resolvedConfig.statsFile);

        const extendedStatsPath = extendedStatsGenerator.generate(
          loadableStatsFilename,
          resolvedConfig.baselineFile
        );

        if (!extendedStatsPath) {
          const webpackStatsPath = extendedStatsGenerator.getWebpackStatsPath(loadableStatsFilename);
          reporter.warning(`Cannot generate source maps: webpack stats not found at ${webpackStatsPath}`);
        }
      }

      checker.updateBaseline();
      reporter.success('Generated current stats.');

      const commit = args.commit
        ? await storage.uploadForCommit(args.commit)
        : await storage.upload();
      reporter.success(`Uploaded baseline to S3 for commit ${commit.substring(0, 7)}`);
      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error uploading baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  }

  if (args.compare || (!args.downloadMainBranchStats && !args.uploadMainBranchStats)) {
    try {
      const result = checker.check();

      if (!args.noHtmlDiffs && resolvedConfig.htmlDiffs.enabled) {
        const bundlesDir = path.dirname(resolvedConfig.statsFile);
        const extendedStatsGenerator = new ExtendedStatsGenerator({ bundlesDir });
        const loadableStatsFilename = path.basename(resolvedConfig.statsFile);

        const extendedStatsPath = extendedStatsGenerator.generate(
          loadableStatsFilename,
          resolvedConfig.baselineFile
        );

        if (!extendedStatsPath) {
          const webpackStatsPath = extendedStatsGenerator.getWebpackStatsPath(loadableStatsFilename);
          const expectedPath = extendedStatsGenerator.getExtendedStatsPath(resolvedConfig.baselineFile);
          reporter.error(`Cannot generate HTML diffs: failed to create ${expectedPath}`);
          reporter.error(`Webpack stats not found at ${webpackStatsPath}`);
        } else {
          const currentDir = resolvedConfig.htmlDiffs.currentDir;
          fs.mkdirSync(currentDir, { recursive: true });
          checker.generateCurrentStatsTo(currentDir);

          checker.generateHtmlDiffs({
            controlDir: resolvedConfig.baselineDir,
            currentDir,
            outputDir: resolvedConfig.htmlDiffs.outputDir,
            metadata: getCiMetadata(resolvedConfig.storage.mainBranch),
          });
        }
      }

      if (!result.passed && isBranchIgnored(resolvedConfig)) {
        const branch = getCurrentBranch();
        console.log(colorize.yellow(`Branch ${branch} is in ignoredBranches - treating as warning`));
        process.exit(0);
      }

      process.exit(result.passed ? 0 : 1);
    } catch (error) {
      console.error(colorize.red(`Error running check: ${(error as Error).message}`));
      process.exit(2);
    }
  }
}

main().catch((error) => {
  console.error(colorize.red(`Unexpected error: ${error.message}`));
  process.exit(2);
});
