/**
 * Reads gzip (.gz) and brotli (.br) compressed file sizes.
 * Handles missing files gracefully by returning 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SizeCalculatorConfig, ChunkSizes, TotalSizes } from './types';

export class SizeCalculator {
  private bundlesDir: string;
  private sizeCache: Map<string, ChunkSizes>;
  private onMissingFile?: (filePath: string) => void;

  constructor({ bundlesDir, onMissingFile }: SizeCalculatorConfig) {
    this.bundlesDir = bundlesDir;
    this.sizeCache = new Map();
    this.onMissingFile = onMissingFile;
  }

  /** Returns 0 if file doesn't exist, and invokes onMissingFile callback if configured. */
  getFileSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size;
    } catch {
      if (this.onMissingFile) {
        this.onMissingFile(filePath);
      }
      return 0;
    }
  }

  getBundlePath(filename: string): string {
    return path.join(this.bundlesDir, filename);
  }

  /** Results are cached. */
  getChunkSizes(chunkFilename: string): ChunkSizes {
    const cached = this.sizeCache.get(chunkFilename);
    if (cached) {
      return cached;
    }

    const basePath = this.getBundlePath(chunkFilename);
    const sizes: ChunkSizes = {
      gzip: this.getFileSize(`${basePath}.gz`),
      brotli: this.getFileSize(`${basePath}.br`),
    };

    this.sizeCache.set(chunkFilename, sizes);
    return sizes;
  }

  bytesToKb(bytes: number): number {
    return bytes / 1024;
  }

  calculateTotalSizes(chunkFilenames: string[]): TotalSizes {
    let totalGzip = 0;
    let totalBrotli = 0;

    for (const filename of chunkFilenames) {
      const sizes = this.getChunkSizes(filename);
      totalGzip += sizes.gzip;
      totalBrotli += sizes.brotli;
    }

    return {
      gzipSizeKb: this.bytesToKb(totalGzip),
      brotliSizeKb: this.bytesToKb(totalBrotli),
    };
  }

  /** Useful when files may have changed between calculations. */
  clearCache(): void {
    this.sizeCache.clear();
  }
}
