/**
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

export class BaselineWriter {
  private baselineDir: string;

  constructor({ baselineDir }: BaselineWriterConfig) {
    this.baselineDir = baselineDir;
  }

  ensureDirectoryExists(): void {
    if (!fs.existsSync(this.baselineDir)) {
      fs.mkdirSync(this.baselineDir, { recursive: true });
    }
  }

  clearDirectory(): void {
    if (fs.existsSync(this.baselineDir)) {
      fs.rmSync(this.baselineDir, { recursive: true });
    }
    this.ensureDirectoryExists();
  }

  getFilePath(filename: string): string {
    return path.join(this.baselineDir, filename);
  }

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

  calculateTotalSize(sizes: ComponentSize[]): string {
    const total = sizes.reduce((sum, size) => sum + size.gzipSizeKb, 0);
    return total.toFixed(2);
  }

  createBaselineConfig(sizes: ComponentSize[]): BaselineConfig {
    return {
      loadableComponents: this.formatComponents(sizes),
      totalgzipSizeKb: this.calculateTotalSize(sizes),
    };
  }

  writeBaselineFile(filename: string, sizes: ComponentSize[]): string {
    this.ensureDirectoryExists();

    const config = this.createBaselineConfig(sizes);
    const configPath = this.getFilePath(filename);

    const content = JSON.stringify(config, null, 2) + '\n';
    fs.writeFileSync(configPath, content, 'utf8');

    return configPath;
  }
}
