#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadConfig,
  resolveConfig,
  findConfigFile,
  isBranchAcknowledged,
  getCurrentBranch,
  writeAcknowledgedBranchFile,
  RESOLVING_BUNDLE_SIZE_ISSUES_DOC_URL,
} from './config';
import { BundleSizeChecker } from './BundleSizeChecker';
import { BaselineStorage } from './BaselineStorage';
import { ExtendedStatsGenerator } from './ExtendedStatsGenerator';
import { Reporter } from './Reporter';
import { colorize } from './helpers/colors';
import { getPackageRunCommand } from './helpers/packageManager';

const VERSION = '0.0.11';

const program = new Command();

interface LoadedConfig {
  resolvedConfig: ReturnType<typeof resolveConfig>;
  configPath: string;
}

async function getResolvedConfig(): Promise<LoadedConfig> {
  const globalOpts = program.opts();

  let configPath = globalOpts.config;
  if (!configPath) {
    configPath = findConfigFile() ?? undefined;
    if (!configPath) {
      console.error(colorize.red('Error: No config file found'));
      console.error('Create a bundle-size.config.ts file or specify one with --config');
      process.exit(2);
    }
  }

  try {
    const userConfig = await loadConfig(configPath);
    const resolvedConfig = resolveConfig(userConfig);
    return { resolvedConfig, configPath };
  } catch (error) {
    console.error(colorize.red(`Error loading config: ${(error as Error).message}`));
    process.exit(2);
  }
}

function createReporter(configPath: string): Reporter {
  const reporter = new Reporter();
  reporter.info(`Using config: ${configPath}`);
  return reporter;
}

function createStorage(resolvedConfig: ReturnType<typeof resolveConfig>, reporter: Reporter): BaselineStorage {
  return new BaselineStorage({
    s3Bucket: resolvedConfig.storage.s3Bucket,
    s3Prefix: resolvedConfig.storage.s3Prefix,
    awsRegion: resolvedConfig.storage.awsRegion,
    s3Endpoint: resolvedConfig.storage.s3Endpoint,
    awsAccessKeyId: resolvedConfig.storage.awsAccessKeyId,
    awsSecretAccessKey: resolvedConfig.storage.awsSecretAccessKey,
    baselineDir: resolvedConfig.baselineDir,
    mainCommitsToCheck: resolvedConfig.storage.mainCommitsToCheck,
    reporter,
  });
}

function getCiMetadata(storage: BaselineStorage): { branchName: string; currentCommit: string; masterCommit: string } {
  const branchName = getCurrentBranch() || '';
  const currentCommit = (process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || '').substring(0, 7);

  let masterCommit = '';
  try {
    const { execSync } = require('child_process');
    const mainBranch = storage.getMainBranch();
    masterCommit = execSync(`git rev-parse origin/${mainBranch}`, { encoding: 'utf8' }).trim().substring(0, 7);
  } catch {
    // Ignore if git is not available
  }

  return { branchName, currentCommit, masterCommit };
}

function printCompareFailureGuidance(configPath: string): void {
  const packageManagerCmd = getPackageRunCommand();
  const acknowledgeCmd = `${packageManagerCmd} shaka-bundle-size -c ${configPath} acknowledge-failure`;

  console.error('');
  console.error('To get insights into why the bundle size changed, see Artifacts for this CI job');
  console.error('');
  console.error(`Also, see docs: ${colorize.blue(RESOLVING_BUNDLE_SIZE_ISSUES_DOC_URL)}`);
  console.error('');
  console.error(colorize.bold(colorize.yellow('HOW TO RESOLVE THIS ISSUE')));
  console.error(`If the change is intended or if you don't know how to resolve the issue and the docs aren't helpful, do the following:`);
  console.error(`    * run \`${colorize.green(acknowledgeCmd)}\``);
  console.error('    * Commit and push the changes to your branch.');
  console.error('This will make bundle-size green and may invite performance reviewers according to your CODEOWNERS file');
  console.error('');
}

program
  .name('shaka-bundle-size')
  .description('Bundle size checking for webpack builds')
  .version(`shaka-bundle-size v${VERSION}`, '--version', 'Show version')
  .option('-c, --config <file>', 'Config file path (.js or .ts)')
  .addHelpText('after', `
Command options:
  download-main-branch-stats:
      --commit <sha>     Specific commit SHA
  upload-main-branch-stats:
      --commit <sha>     Specific commit SHA
  acknowledge-failure:
      --branch <name>    Branch name to acknowledge
  compare:
      --no-html-diffs    Skip HTML diff generation

Examples:
  # Auto-discovers bundle-size.config.ts in current directory
  shaka-bundle-size download-main-branch-stats
  shaka-bundle-size compare

  # Specify config explicitly
  shaka-bundle-size -c admin.bundle-size.config.ts compare

  # Download from specific commit
  shaka-bundle-size download-main-branch-stats --commit abc1234

  # Main branch: upload new baseline after merge
  shaka-bundle-size upload-main-branch-stats

  # Upload baseline for specific commit
  shaka-bundle-size upload-main-branch-stats --commit abc1234

Exit codes:
  0  Success / Check passed
  1  Check failed (regressions detected)
  2  Configuration or runtime error`);

program
  .command('download-main-branch-stats')
  .description('Download baseline from main branch (finds merge-base)')
  .option('--commit <sha>', 'Specific commit SHA')
  .action(async (opts) => {
    try {
      const { resolvedConfig, configPath } = await getResolvedConfig();
      const reporter = createReporter(configPath);
      const storage = createStorage(resolvedConfig, reporter);

      reporter.info('Downloading main branch baseline from S3...');
      const commit = opts.commit
        ? await storage.downloadForCommit(opts.commit)
        : await storage.download();

      if (commit) {
        reporter.success(`Found baseline for commit ${commit.substring(0, 7)}`);
      } else {
        reporter.error(`No baseline found${opts.commit ? ` for commit ${opts.commit}` : ` in last ${resolvedConfig.storage.mainCommitsToCheck} main commits`}`);
        process.exit(2);
      }
      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error downloading baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  });

program
  .command('upload-main-branch-stats')
  .description('Generate and upload baseline for current commit')
  .option('--commit <sha>', 'Specific commit SHA')
  .action(async (opts) => {
    try {
      const { resolvedConfig, configPath } = await getResolvedConfig();
      const reporter = createReporter(configPath);
      const storage = createStorage(resolvedConfig, reporter);
      const checker = new BundleSizeChecker(resolvedConfig, reporter);

      // Generate extended stats first (needed for source maps)
      if (resolvedConfig.generateSourceMaps) {
        const bundlesDir = path.dirname(resolvedConfig.statsFile);
        const extendedStatsGenerator = new ExtendedStatsGenerator({
          bundlesDir,
          bundleNamePrefix: resolvedConfig.bundleNamePrefix,
        });

        const extendedStatsPath = extendedStatsGenerator.generate();

        if (!extendedStatsPath) {
          const webpackStatsPath = extendedStatsGenerator.getWebpackStatsPath();
          reporter.warning(`Cannot generate source maps: webpack stats not found at ${webpackStatsPath}`);
        }
      }

      checker.updateBaseline();
      reporter.success('Generated current stats.');

      const commit = opts.commit
        ? await storage.uploadForCommit(opts.commit)
        : await storage.upload();
      reporter.success(`Uploaded baseline to S3 for commit ${commit.substring(0, 7)}`);
      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error uploading baseline: ${(error as Error).message}`));
      process.exit(2);
    }
  });

program
  .command('acknowledge-failure')
  .description('Acknowledge bundle-size failure for current branch')
  .option('--branch <name>', 'Branch name to acknowledge')
  .action(async (opts) => {
    try {
      const { resolvedConfig, configPath } = await getResolvedConfig();
      const reporter = createReporter(configPath);

      if (!resolvedConfig.acknowledgedBranchesFilePath) {
        console.error(colorize.red('Error: acknowledgedBranchesFilePath must be set in config to use acknowledge-failure'));
        process.exit(2);
      }

      writeAcknowledgedBranchFile(resolvedConfig.acknowledgedBranchesFilePath, opts.branch);
      const branch = opts.branch ?? getCurrentBranch();
      reporter.success(`Acknowledged bundle-size failure for branch: ${branch}`);
      reporter.info(`File updated: ${resolvedConfig.acknowledgedBranchesFilePath}`);
      process.exit(0);
    } catch (error) {
      console.error(colorize.red(`Error: ${(error as Error).message}`));
      process.exit(2);
    }
  });

program
  .command('compare', { isDefault: true })
  .description('Generate current stats and compare against baseline')
  .option('--no-html-diffs', 'Skip HTML diff generation')
  .action(async (opts) => {
    try {
      const { resolvedConfig, configPath } = await getResolvedConfig();
      const reporter = createReporter(configPath);
      const storage = createStorage(resolvedConfig, reporter);
      const checker = new BundleSizeChecker(resolvedConfig, reporter);

      const result = checker.check();

      if (opts.htmlDiffs && resolvedConfig.htmlDiffs.enabled) {
        const bundlesDir = path.dirname(resolvedConfig.statsFile);
        const extendedStatsGenerator = new ExtendedStatsGenerator({
          bundlesDir,
          bundleNamePrefix: resolvedConfig.bundleNamePrefix,
        });

        const extendedStatsPath = extendedStatsGenerator.generate();

        if (!extendedStatsPath) {
          const webpackStatsPath = extendedStatsGenerator.getWebpackStatsPath();
          const expectedPath = extendedStatsGenerator.getExtendedStatsPath();
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
            metadata: getCiMetadata(storage),
          });
        }
      }

      if (result.passed) {
        process.exit(0);
      }

      if (isBranchAcknowledged(resolvedConfig)) {
        const branch = getCurrentBranch();
        console.log(colorize.yellow(`Branch ${branch} is acknowledged - treating as warning`));
        process.exit(0);
      }

      printCompareFailureGuidance(configPath);
      process.exit(1);
    } catch (error) {
      console.error(colorize.red(`Error running check: ${(error as Error).message}`));
      process.exit(2);
    }
  });

program.parse();
