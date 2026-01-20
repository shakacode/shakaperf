#!/usr/bin/env node
/**
 * shaka-bundle-size CLI
 *
 * Command-line interface for bundle size checking.
 */

import { parseArgs } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveConfig, isBranchIgnored, getCurrentBranch } from './config';
import { BundleSizeChecker } from './BundleSizeChecker';
import { BaselineStorage } from './BaselineStorage';
import { Reporter } from './Reporter';
import { colorize } from './helpers/colors';

const VERSION = '0.0.2';

const HELP = `
shaka-bundle-size - Bundle size checking for webpack builds

Usage:
  shaka-bundle-size --config <file> [options]

Options:
  -c, --config <file>    Config file path (.js or .ts) [required]
  -u, --update           Update baseline with current build sizes
      --download         Download baseline from storage before checking
      --upload           Upload baseline to storage after updating
      --no-html-diffs    Skip HTML diff generation
  -v, --verbose          Verbose output
  -q, --quiet            Quiet output (errors only)
  -h, --help             Show this help message
      --version          Show version

Examples:
  shaka-bundle-size --config bundle-size.config.js
  shaka-bundle-size --config bundle-size.config.js --download
  shaka-bundle-size --config bundle-size.config.js --update --upload
  shaka-bundle-size -c admin.bundle-size.config.js --no-html-diffs

Exit codes:
  0  Check passed
  1  Check failed (regressions detected)
  2  Configuration or runtime error
`;

interface CliOptions {
  config?: string;
  update: boolean;
  download: boolean;
  upload: boolean;
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
      update: { type: 'boolean', short: 'u', default: false },
      download: { type: 'boolean', default: false },
      upload: { type: 'boolean', default: false },
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
    update: values.update as boolean,
    download: values.download as boolean,
    upload: values.upload as boolean,
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

/**
 * Copies current baseline to control directory for diff comparison.
 */
function copyBaselineToControl(baselineDir: string, controlDir: string): void {
  if (fs.existsSync(controlDir)) {
    fs.rmSync(controlDir, { recursive: true });
  }

  if (fs.existsSync(baselineDir)) {
    fs.cpSync(baselineDir, controlDir, { recursive: true });
  }
}

/**
 * Gets CI metadata for HTML diffs.
 */
function getCiMetadata(): { branchName: string; currentCommit: string; masterCommit: string } {
  const branchName = getCurrentBranch() || '';
  const currentCommit = (process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || '').substring(0, 7);

  let masterCommit = '';
  try {
    const { execSync } = require('child_process');
    masterCommit = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim().substring(0, 7);
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

  // Load and resolve config
  let resolvedConfig;
  try {
    const userConfig = await loadConfig(args.config);
    resolvedConfig = resolveConfig(userConfig);
  } catch (error) {
    console.error(colorize.red(`Error loading config: ${(error as Error).message}`));
    process.exit(2);
  }

  // Determine verbosity
  const verbosity = args.quiet ? 'quiet' : args.verbose ? 'verbose' : 'normal';
  const reporter = new Reporter({ verbosity });

  // Create storage manager
  const storage = new BaselineStorage({
    storageDir: resolvedConfig.storage.storageDir,
    baselineDir: resolvedConfig.baselineDir,
    mainCommitsToCheck: resolvedConfig.storage.mainCommitsToCheck,
  });

  // Download baseline if requested
  if (args.download) {
    try {
      reporter.info('Downloading baseline from storage...');
      const commit = storage.download();
      if (commit) {
        reporter.success(`Found baseline for commit ${commit.substring(0, 7)}`);
      } else {
        reporter.error(`No baseline found in last ${resolvedConfig.storage.mainCommitsToCheck} main commits`);
        process.exit(2);
      }
    } catch (error) {
      console.error(colorize.red(`Error downloading baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  }

  // Create checker
  const checker = new BundleSizeChecker(resolvedConfig, reporter);

  // Update mode
  if (args.update) {
    try {
      checker.updateBaseline();
      reporter.success('Baseline updated successfully.');

      // Upload if requested
      if (args.upload) {
        const commit = storage.upload();
        reporter.success(`Uploaded baseline for commit ${commit.substring(0, 7)}`);
      }

      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error updating baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  }

  // Check mode
  try {
    // Copy baseline to control dir before check (for HTML diffs)
    if (!args.noHtmlDiffs && resolvedConfig.htmlDiffs.enabled) {
      copyBaselineToControl(resolvedConfig.baselineDir, resolvedConfig.htmlDiffs.controlDir);
    }

    const result = checker.check();

    // Generate HTML diffs after check
    if (!args.noHtmlDiffs && resolvedConfig.htmlDiffs.enabled) {
      const metadata = getCiMetadata();
      checker.generateHtmlDiffs({
        controlDir: resolvedConfig.htmlDiffs.controlDir,
        outputDir: resolvedConfig.htmlDiffs.outputDir,
        metadata,
      });
    }

    // Check if branch is ignored
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

main().catch((error) => {
  console.error(colorize.red(`Unexpected error: ${error.message}`));
  process.exit(2);
});
