import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';
import { printBanner, printInfo, printError, printSuccess } from '../helpers/ui';

export interface CompareTwinServersOptions {
  verbose?: boolean;
  bundleConfigPath?: string;
  noHtmlDiffs?: boolean;
}

export async function compareTwinServers(
  config: ResolvedConfig,
  options: CompareTwinServersOptions,
): Promise<void> {
  let bundleSize;
  try {
    bundleSize = await import('shaka-bundle-size');
  } catch {
    throw new Error(
      'shaka-bundle-size is required for compare-twin-servers. Install it with: yarn add shaka-bundle-size'
    );
  }

  const { BundleSizeChecker, Reporter, SilentReporter, findConfigFile, loadConfig, resolveConfig } = bundleSize;

  printBanner('Compare Twin Servers — Bundle Size');

  // 1. Discover/load bundle-size config
  const bundleConfigPath = options.bundleConfigPath
    ?? findConfigFile(config.projectDir);

  if (!bundleConfigPath) {
    throw new Error(
      `No bundle-size config found in ${config.projectDir}. ` +
      'Create a bundle-size.config.ts or .js file, or specify one with --bundle-config'
    );
  }

  if (options.verbose) {
    printInfo(`Using bundle-size config: ${bundleConfigPath}`);
  }

  const bundleUserConfig = await loadConfig(bundleConfigPath);
  const bundleConfig = resolveConfig(bundleUserConfig);

  // 2. Compute stats file paths in volumes
  const controlStatsFile = path.join(config.volumes.control, bundleConfig.statsFile);
  const experimentStatsFile = path.join(config.volumes.experiment, bundleConfig.statsFile);

  if (options.verbose) {
    printInfo(`Control stats: ${controlStatsFile}`);
    printInfo(`Experiment stats: ${experimentStatsFile}`);
  }

  // 3. Verify stats files exist
  if (!fs.existsSync(controlStatsFile)) {
    throw new Error(
      `Control stats file not found: ${controlStatsFile}\n` +
      'Make sure containers are running and the app has been built (build Docker images first).'
    );
  }

  if (!fs.existsSync(experimentStatsFile)) {
    throw new Error(
      `Experiment stats file not found: ${experimentStatsFile}\n` +
      'Make sure containers are running and the app has been built (build Docker images first).'
    );
  }

  // 4. Generate baseline from control
  const reporter = new Reporter({ verbosity: options.verbose ? 'verbose' : 'normal' });
  const silentReporter = new SilentReporter();

  const controlConfig = {
    ...bundleConfig,
    statsFile: controlStatsFile,
  };

  const controlChecker = new BundleSizeChecker(controlConfig, silentReporter);
  const baselineResult = controlChecker.updateBaseline();

  printSuccess(`Control baseline generated: ${baselineResult.configPath}`);

  // 5. Compare experiment against control baseline
  const experimentConfig = {
    ...bundleConfig,
    statsFile: experimentStatsFile,
  };

  const experimentChecker = new BundleSizeChecker(experimentConfig, reporter);
  const checkResult = experimentChecker.check();

  // 6. Generate HTML diffs (unless disabled)
  const htmlDiffsEnabled = !options.noHtmlDiffs && bundleConfig.htmlDiffs.enabled;

  if (htmlDiffsEnabled) {
    const currentDir = bundleConfig.htmlDiffs.currentDir;
    experimentChecker.generateCurrentStatsTo(currentDir);

    experimentChecker.generateHtmlDiffs({
      controlDir: bundleConfig.baselineDir,
      currentDir,
      outputDir: bundleConfig.htmlDiffs.outputDir,
    });
  }

  // 7. Exit with appropriate code
  if (!checkResult.passed) {
    process.exit(1);
  }
}
