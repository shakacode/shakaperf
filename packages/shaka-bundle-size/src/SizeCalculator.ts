/**
 * SizeCalculator - Calculates compressed file sizes.
 *
 * Reads gzip (.gz) and brotli (.br) compressed file sizes and converts to KB.
 * Handles missing files gracefully by returning 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SizeCalculatorConfig, ChunkSizes, TotalSizes } from './types';

/**
 * Calculates compressed sizes for webpack bundle files.
 */
export class SizeCalculator {
  private bundlesDir: string;
  private sizeCache: Map<string, ChunkSizes>;

  /**
   * Creates a new SizeCalculator.
   */
  constructor({ bundlesDir }: SizeCalculatorConfig) {
    this.bundlesDir = bundlesDir;
    this.sizeCache = new Map();
  }

  /**
   * Gets the file size in bytes, returning 0 if file doesn't exist.
   */
  getFileSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  /**
   * Gets the full path to a bundle file.
   */
  getBundlePath(filename: string): string {
    return path.join(this.bundlesDir, filename);
  }

  /**
   * Calculates both gzip and brotli sizes for a chunk file.
   * Results are cached for efficiency.
   */
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

  /**
   * Converts bytes to kilobytes.
   */
  bytesToKb(bytes: number): number {
    return bytes / 1024;
  }

  /**
   * Calculates total sizes for a list of chunk files.
   */
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

  /**
   * Clears the size cache.
   * Useful when files may have changed between calculations.
   */
  clearCache(): void {
    this.sizeCache.clear();
  }
}
