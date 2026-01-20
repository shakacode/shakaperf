/**
 * RegressionDetector - Detects and classifies bundle size regressions.
 *
 * Analyzes comparison results and creates structured regression objects.
 * Uses a configurable policy function to determine failure conditions.
 */

import {
  RegressionType,
  type Regression,
  type PolicyResult,
  type RegressionPolicyFunction,
  type RegressionDetectorConfig,
  type ComponentSize,
  type BaselineComponent,
  type SizeComparison,
  type ComparisonResult,
  type EvaluationResult,
} from './types';

export { RegressionType };

/**
 * Default policy that fails on any regression.
 */
export function defaultPolicy(regression: Regression): PolicyResult {
  return {
    shouldFail: true,
    message: `Regression detected: ${regression.type} in ${regression.componentName}`,
  };
}

/**
 * Detects and evaluates regressions in bundle sizes.
 */
export class RegressionDetector {
  private policy: RegressionPolicyFunction;

  /**
   * Creates a new RegressionDetector.
   */
  constructor({ policy = defaultPolicy }: RegressionDetectorConfig = {}) {
    this.policy = policy;
  }

  /**
   * Creates a regression object for a new component.
   */
  createNewComponentRegression(component: ComponentSize): Regression {
    return {
      componentName: component.name,
      type: RegressionType.NEW_COMPONENT,
      sizeKb: component.gzipSizeKb,
      chunksCount: component.chunksCount,
    };
  }

  /**
   * Creates a regression object for a removed component.
   */
  createRemovedComponentRegression(component: BaselineComponent): Regression {
    return {
      componentName: component.name,
      type: RegressionType.REMOVED_COMPONENT,
      sizeKb: Number(component.gzipSizeKb),
    };
  }

  /**
   * Creates a regression object for increased size.
   */
  createIncreasedSizeRegression(comparison: SizeComparison): Regression {
    return {
      componentName: comparison.name,
      type: RegressionType.INCREASED_SIZE,
      sizeDiffKb: comparison.sizeDiffKb,
      expectedSizeKb: comparison.expectedSizeKb,
      actualSizeKb: comparison.actualSizeKb,
    };
  }

  /**
   * Creates a regression object for increased chunks count.
   */
  createIncreasedChunksCountRegression(comparison: SizeComparison): Regression {
    return {
      componentName: comparison.name,
      type: RegressionType.INCREASED_CHUNKS_COUNT,
      expectedChunksCount: comparison.expectedChunksCount,
      actualChunksCount: comparison.actualChunksCount,
    };
  }

  /**
   * Detects all regressions from comparison results.
   */
  detectRegressions(comparisonResult: ComparisonResult): Regression[] {
    const regressions: Regression[] = [];

    // New components
    for (const component of comparisonResult.newComponents) {
      regressions.push(this.createNewComponentRegression(component));
    }

    // Removed components
    for (const component of comparisonResult.removedComponents) {
      regressions.push(this.createRemovedComponentRegression(component));
    }

    // Size increases
    for (const comparison of comparisonResult.sizeChanges) {
      regressions.push(this.createIncreasedSizeRegression(comparison));
    }

    // Chunks count increases
    for (const comparison of comparisonResult.chunksCountIncreases) {
      regressions.push(this.createIncreasedChunksCountRegression(comparison));
    }

    return regressions;
  }

  /**
   * Evaluates a regression using the policy function.
   */
  evaluateRegression(regression: Regression): PolicyResult {
    return this.policy(regression);
  }

  /**
   * Evaluates all regressions and determines which cause failures.
   */
  evaluateAll(regressions: Regression[]): EvaluationResult {
    const failures: Regression[] = [];
    const warnings: Regression[] = [];

    for (const regression of regressions) {
      const result = this.evaluateRegression(regression);
      if (result.shouldFail) {
        regression.policyMessage = result.message;
        failures.push(regression);
      } else {
        warnings.push(regression);
      }
    }

    return { failures, warnings };
  }
}
