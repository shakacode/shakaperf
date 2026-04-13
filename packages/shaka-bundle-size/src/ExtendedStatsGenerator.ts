/**
 * Generates extended stats JSON files from webpack stats using webpack-bundle-analyzer.
 * Extended stats contain gzip size information for each module, enabling source map generation.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ExtendedStatsGeneratorConfig {
  bundlesDir: string;
  bundleNamePrefix?: string;
}

const FIVE_MINUTES_MS = 300000;

export class ExtendedStatsGenerator {
  private bundlesDir: string;
  private bundleNamePrefix?: string;

  constructor(config: ExtendedStatsGeneratorConfig) {
    this.bundlesDir = config.bundlesDir;
    this.bundleNamePrefix = config.bundleNamePrefix;
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

    if (!fs.existsSync(webpackStatsPath)) {
      return { error: 'stats-not-found', message: `Webpack stats not found at ${webpackStatsPath}` };
    }

    try {
      execSync(
        `yarn webpack-bundle-analyzer -m json -s gzip "${webpackStatsPath}" -r "${extendedStatsPath}"`,
        { stdio: 'pipe', timeout: FIVE_MINUTES_MS }
      );
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
