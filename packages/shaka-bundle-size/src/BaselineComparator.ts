/**
 * Loads baseline configuration and compares with current build sizes
 * to detect changes and potential regressions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  BaselineComparatorConfig,
  BaselineConfig,
  ComponentSize,
  BaselineComponent,
  SizeComparison,
  ComparisonResult,
} from './types';

export const UNCATEGORIZED_CHUNKS_NAME = 'uncategorized chunks';

export class BaselineComparator {
  private baselineDir: string;
  private sizeThresholdKb: number;

  constructor({ baselineDir, sizeThresholdKb = 0.1 }: BaselineComparatorConfig) {
    this.baselineDir = baselineDir;
    this.sizeThresholdKb = sizeThresholdKb;
  }

  getBaselineFilePath(filename: string): string {
    return path.join(this.baselineDir, filename);
  }

  loadBaselineFile(filename: string): BaselineConfig {
    const configPath = this.getBaselineFilePath(filename);
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content) as BaselineConfig;
  }

  baselineFileExists(filename: string): boolean {
    return fs.existsSync(this.getBaselineFilePath(filename));
  }

  findComponentByName<T extends { name: string }>(components: T[], name: string): T | undefined {
    return components.find(c => c.name === name);
  }

  compare(actualSizes: ComponentSize[], baseline: BaselineConfig): ComparisonResult {
    const expectedSizes = baseline.loadableComponents || [];

    const result: ComparisonResult = {
      sizeChanges: [],
      newComponents: [],
      removedComponents: [],
      chunksCountIncreases: [],
    };

    // Check for new or changed components
    for (const actual of actualSizes) {
      const expected = this.findComponentByName(expectedSizes, actual.name);

      if (!expected) {
        result.newComponents.push(actual);
        continue;
      }

      const comparison = this.createComparison(actual, expected);

      if (this.hasSizeIncrease(comparison)) {
        result.sizeChanges.push(comparison);
      }

      if (this.hasChunksCountIncrease(comparison)) {
        result.chunksCountIncreases.push(comparison);
      }
    }

    // Check for removed components
    for (const expected of expectedSizes) {
      const actual = this.findComponentByName(actualSizes, expected.name);
      if (!actual) {
        result.removedComponents.push(expected);
      }
    }

    return result;
  }

  createComparison(actual: ComponentSize, expected: BaselineComponent): SizeComparison {
    const actualSizeKb = Number(actual.gzipSizeKb.toFixed(2));
    const expectedSizeKb = Number(expected.gzipSizeKb);

    return {
      name: actual.name,
      actualSizeKb,
      expectedSizeKb,
      sizeDiffKb: actualSizeKb - expectedSizeKb,
      actualChunksCount: actual.chunksCount,
      expectedChunksCount: expected.chunksCount,
    };
  }

  hasSizeIncrease(comparison: SizeComparison): boolean {
    return comparison.sizeDiffKb > this.sizeThresholdKb;
  }

  hasSizeDecrease(comparison: SizeComparison): boolean {
    return comparison.sizeDiffKb < 0;
  }

  hasChunksCountIncrease(comparison: SizeComparison): boolean {
    return comparison.actualChunksCount > comparison.expectedChunksCount;
  }
}
