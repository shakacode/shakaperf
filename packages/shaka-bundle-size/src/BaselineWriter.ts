/**
 * BaselineWriter - Writes baseline configuration files.
 *
 * Generates baseline config JSON files from current build sizes.
 * These files serve as the reference for future comparisons.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  BaselineWriterConfig,
  ComponentSize,
  BaselineComponent,
  BaselineConfig,
} from './types';

/**
 * Writes baseline configuration files for bundle size comparisons.
 */
export class BaselineWriter {
  private baselineDir: string;

  /**
   * Creates a new BaselineWriter.
   */
  constructor({ baselineDir }: BaselineWriterConfig) {
    this.baselineDir = baselineDir;
  }

  /**
   * Ensures the baseline directory exists.
   */
  ensureDirectoryExists(): void {
    if (!fs.existsSync(this.baselineDir)) {
      fs.mkdirSync(this.baselineDir, { recursive: true });
    }
  }

  /**
   * Clears existing baseline directory contents.
   */
  clearDirectory(): void {
    if (fs.existsSync(this.baselineDir)) {
      fs.rmSync(this.baselineDir, { recursive: true });
    }
    this.ensureDirectoryExists();
  }

  /**
   * Gets the config file path for an app.
   */
  getConfigPath(appName: string): string {
    return path.join(this.baselineDir, `${appName}-config.json`);
  }

  /**
   * Formats component sizes for baseline config.
   */
  formatComponents(sizes: ComponentSize[]): BaselineComponent[] {
    return sizes
      .map(size => ({
        name: size.name,
        chunksCount: size.chunksCount,
        brotliSizeKb: size.brotliSizeKb.toFixed(2),
        gzipSizeKb: size.gzipSizeKb.toFixed(2),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Calculates total gzip size from components.
   */
  calculateTotalSize(sizes: ComponentSize[]): string {
    const total = sizes.reduce((sum, size) => sum + size.gzipSizeKb, 0);
    return total.toFixed(2);
  }

  /**
   * Creates baseline config object from component sizes.
   */
  createBaselineConfig(sizes: ComponentSize[]): BaselineConfig {
    return {
      loadableComponents: this.formatComponents(sizes),
      totalgzipSizeKb: this.calculateTotalSize(sizes),
    };
  }

  /**
   * Writes baseline config for an app.
   */
  writeBaseline(appName: string, sizes: ComponentSize[]): string {
    this.ensureDirectoryExists();

    const config = this.createBaselineConfig(sizes);
    const configPath = this.getConfigPath(appName);

    const content = JSON.stringify(config, null, 2) + '\n';
    fs.writeFileSync(configPath, content, 'utf8');

    return configPath;
  }
}
