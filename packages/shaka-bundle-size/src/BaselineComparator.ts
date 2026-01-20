/**
 * BaselineComparator - Compares actual bundle sizes against baseline.
 *
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

/**
 * Compares actual sizes against baseline expectations.
 */
export class BaselineComparator {
  private baselineDir: string;
  private sizeThresholdKb: number;

  /**
   * Creates a new BaselineComparator.
   */
  constructor({ baselineDir, sizeThresholdKb = 0.1 }: BaselineComparatorConfig) {
    this.baselineDir = baselineDir;
    this.sizeThresholdKb = sizeThresholdKb;
  }

  /**
   * Gets the baseline config file path for an app.
   */
  getBaselineConfigPath(appName: string): string {
    return path.join(this.baselineDir, `${appName}-config.json`);
  }

  /**
   * Loads baseline configuration for an app.
   */
  loadBaseline(appName: string): BaselineConfig {
    const configPath = this.getBaselineConfigPath(appName);
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content) as BaselineConfig;
  }

  /**
   * Checks if baseline exists for an app.
   */
  baselineExists(appName: string): boolean {
    return fs.existsSync(this.getBaselineConfigPath(appName));
  }

  /**
   * Finds a component in a list by name.
   */
  findComponentByName<T extends { name: string }>(components: T[], name: string): T | undefined {
    return components.find(c => c.name === name);
  }

  /**
   * Compares actual sizes against baseline.
   */
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

  /**
   * Creates a comparison object between actual and expected sizes.
   */
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

  /**
   * Checks if a comparison shows a significant size increase.
   */
  hasSizeIncrease(comparison: SizeComparison): boolean {
    return comparison.sizeDiffKb > this.sizeThresholdKb;
  }

  /**
   * Checks if a comparison shows a size decrease.
   */
  hasSizeDecrease(comparison: SizeComparison): boolean {
    return comparison.sizeDiffKb < 0;
  }

  /**
   * Checks if a comparison shows an increased chunks count.
   */
  hasChunksCountIncrease(comparison: SizeComparison): boolean {
    return comparison.actualChunksCount > comparison.expectedChunksCount;
  }
}
