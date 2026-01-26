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
   * Returns the output path on success, null if webpack stats don't exist or generation fails.
   */
  generate(): string | null {
    const webpackStatsPath = this.getWebpackStatsPath();
    const extendedStatsPath = this.getExtendedStatsPath();

    if (!fs.existsSync(webpackStatsPath)) {
      return null;
    }

    try {
      execSync(
        `yarn webpack-bundle-analyzer -m json -s gzip "${webpackStatsPath}" -r "${extendedStatsPath}"`,
        { stdio: 'pipe', timeout: FIVE_MINUTES_MS }
      );
      return extendedStatsPath;
    } catch {
      return null;
    }
  }
}
