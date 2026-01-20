/**
 * Generates extended stats JSON files from webpack stats using webpack-bundle-analyzer.
 * Extended stats contain gzip size information for each module, enabling source map generation.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ExtendedStatsGeneratorConfig {
  bundlesDir: string;
}

const FIVE_MINUTES_MS = 300000;

export class ExtendedStatsGenerator {
  private bundlesDir: string;

  constructor(config: ExtendedStatsGeneratorConfig) {
    this.bundlesDir = config.bundlesDir;
  }

  getWebpackStatsPath(loadableStatsFilename: string): string {
    const bundleName = this.extractBundleName(loadableStatsFilename);
    return path.join(this.bundlesDir, `${bundleName}-webpack-stats.json`);
  }

  getExtendedStatsPath(baselineFilename: string): string {
    const bundleName = baselineFilename.replace(/-config\.json$/, '');
    return path.join(this.bundlesDir, `${bundleName}-bundlesize-extended-stats.json`);
  }

  /**
   * Generates extended stats from webpack stats.
   * Returns the output path on success, null if webpack stats don't exist or generation fails.
   */
  generate(loadableStatsFilename: string, baselineFilename: string): string | null {
    const webpackStatsPath = this.getWebpackStatsPath(loadableStatsFilename);
    const extendedStatsPath = this.getExtendedStatsPath(baselineFilename);

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

  private extractBundleName(loadableStatsFilename: string): string {
    return path.basename(loadableStatsFilename, '.json')
      .replace(/-loadable-stats$/, '')
      .replace(/-stats$/, '');
  }
}
