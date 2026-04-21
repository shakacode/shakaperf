/**
 * Generates extended stats JSON files from webpack stats using webpack-bundle-analyzer.
 * Extended stats contain gzip size information for each module, enabling source map generation.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { IReporter } from './types';

export interface ExtendedStatsGeneratorConfig {
  bundlesDir: string;
  bundleNamePrefix?: string;
  reporter?: IReporter;
}

const FIVE_MINUTES_MS = 300000;

export class ExtendedStatsGenerator {
  private bundlesDir: string;
  private bundleNamePrefix?: string;
  private reporter?: IReporter;

  constructor(config: ExtendedStatsGeneratorConfig) {
    this.bundlesDir = config.bundlesDir;
    this.bundleNamePrefix = config.bundleNamePrefix;
    this.reporter = config.reporter;
  }

  getWebpackStatsPath(): string {
    const filename = this.bundleNamePrefix
      ? `${this.bundleNamePrefix}-webpack-stats.json`
      : 'webpack-stats.json';
    return path.join(this.bundlesDir, filename);
  }

  getExtendedStatsPath(): string {
    const filename = this.bundleNamePrefix
      ? `${this.bundleNamePrefix}-bundlesize-extended-stats.json`
      : 'bundlesize-extended-stats.json';
    return path.join(this.bundlesDir, filename);
  }

  /**
   * Generates extended stats from webpack stats.
   */
  generate(): { path: string } | { error: 'stats-not-found' | 'analyzer-failed'; message: string } {
    const webpackStatsPath = this.getWebpackStatsPath();
    const extendedStatsPath = this.getExtendedStatsPath();

    this.reporter?.info('Generating extended stats...');
    this.reporter?.verbose(`Webpack stats path: ${webpackStatsPath}`);
    this.reporter?.verbose(`Extended stats output: ${extendedStatsPath}`);

    if (!fs.existsSync(webpackStatsPath)) {
      return { error: 'stats-not-found', message: `Webpack stats not found at ${webpackStatsPath}` };
    }

    try {
      this.reporter?.verbose('Running webpack-bundle-analyzer...');
      execSync(
        `yarn webpack-bundle-analyzer -m json -s gzip "${webpackStatsPath}" -r "${extendedStatsPath}"`,
        { stdio: 'pipe', timeout: FIVE_MINUTES_MS }
      );
      this.reporter?.success(`Generated extended stats: ${extendedStatsPath}`);
      return { path: extendedStatsPath };
    } catch (e) {
      const stderr = e instanceof Error && 'stderr' in e ? String((e as any).stderr) : '';
      return {
        error: 'analyzer-failed',
        message: `webpack-bundle-analyzer failed on ${webpackStatsPath}${stderr ? `:\n${stderr}` : ''}`,
      };
    }
  }
}
