/**
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

/** Fails on any regression. */
export function defaultPolicy(regression: Regression): PolicyResult {
  return {
    shouldFail: true,
    message: `Regression detected: ${regression.type} in ${regression.componentName}`,
  };
}

export class RegressionDetector {
  private policy: RegressionPolicyFunction;

  constructor({ policy = defaultPolicy }: RegressionDetectorConfig = {}) {
    this.policy = policy;
  }

  createNewComponentRegression(component: ComponentSize): Regression {
    return {
      componentName: component.name,
      type: RegressionType.NEW_COMPONENT,
      sizeKb: component.gzipSizeKb,
      chunksCount: component.chunksCount,
    };
  }

  createRemovedComponentRegression(component: BaselineComponent): Regression {
    return {
      componentName: component.name,
      type: RegressionType.REMOVED_COMPONENT,
      sizeKb: Number(component.gzipSizeKb),
    };
  }

  createIncreasedSizeRegression(comparison: SizeComparison): Regression {
    return {
      componentName: comparison.name,
      type: RegressionType.INCREASED_SIZE,
      sizeDiffKb: comparison.sizeDiffKb,
      expectedSizeKb: comparison.expectedSizeKb,
      actualSizeKb: comparison.actualSizeKb,
    };
  }

  createIncreasedChunksCountRegression(comparison: SizeComparison): Regression {
    return {
      componentName: comparison.name,
      type: RegressionType.INCREASED_CHUNKS_COUNT,
      expectedChunksCount: comparison.expectedChunksCount,
      actualChunksCount: comparison.actualChunksCount,
    };
  }

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

  evaluateRegression(regression: Regression): PolicyResult {
    return this.policy(regression);
  }

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
