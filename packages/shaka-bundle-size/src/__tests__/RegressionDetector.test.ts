import { RegressionDetector, RegressionType, defaultPolicy } from '../RegressionDetector';
import type { ComparisonResult, ComponentSize, BaselineComponent, SizeComparison, Regression } from '../types';

describe('defaultPolicy', () => {
  it('returns shouldFail: true for INCREASED_SIZE', () => {
    const regression: Regression = {
      componentName: 'App',
      type: RegressionType.INCREASED_SIZE,
    };
    const result = defaultPolicy(regression);
    expect(result.shouldFail).toBe(true);
    expect(result.message).toContain('increasedSize');
    expect(result.message).toContain('App');
  });

  it('returns shouldFail: true for NEW_COMPONENT', () => {
    const regression: Regression = {
      componentName: 'NewWidget',
      type: RegressionType.NEW_COMPONENT,
    };
    const result = defaultPolicy(regression);
    expect(result.shouldFail).toBe(true);
    expect(result.message).toContain('newComponent');
    expect(result.message).toContain('NewWidget');
  });

  it('returns shouldFail: true for REMOVED_COMPONENT', () => {
    const regression: Regression = {
      componentName: 'OldWidget',
      type: RegressionType.REMOVED_COMPONENT,
    };
    const result = defaultPolicy(regression);
    expect(result.shouldFail).toBe(true);
    expect(result.message).toContain('removedComponent');
    expect(result.message).toContain('OldWidget');
  });

  it('returns shouldFail: true for INCREASED_CHUNKS_COUNT', () => {
    const regression: Regression = {
      componentName: 'Header',
      type: RegressionType.INCREASED_CHUNKS_COUNT,
    };
    const result = defaultPolicy(regression);
    expect(result.shouldFail).toBe(true);
    expect(result.message).toContain('increasedChunksCount');
    expect(result.message).toContain('Header');
  });
});

describe('RegressionDetector', () => {
  describe('createNewComponentRegression', () => {
    it('creates regression for new component', () => {
      const detector = new RegressionDetector();
      const component: ComponentSize = {
        name: 'NewWidget',
        chunksCount: 3,
        gzipSizeKb: 50,
        brotliSizeKb: 40,
      };

      const regression = detector.createNewComponentRegression(component);
      expect(regression.componentName).toBe('NewWidget');
      expect(regression.type).toBe(RegressionType.NEW_COMPONENT);
      expect(regression.sizeKb).toBe(50);
      expect(regression.chunksCount).toBe(3);
    });
  });

  describe('createRemovedComponentRegression', () => {
    it('creates regression for removed component', () => {
      const detector = new RegressionDetector();
      const component: BaselineComponent = {
        name: 'OldWidget',
        chunksCount: 2,
        gzipSizeKb: '30.00',
        brotliSizeKb: '25.00',
      };

      const regression = detector.createRemovedComponentRegression(component);
      expect(regression.componentName).toBe('OldWidget');
      expect(regression.type).toBe(RegressionType.REMOVED_COMPONENT);
      expect(regression.sizeKb).toBe(30);
    });
  });

  describe('createIncreasedSizeRegression', () => {
    it('creates regression for size increase', () => {
      const detector = new RegressionDetector();
      const comparison: SizeComparison = {
        name: 'App',
        actualSizeKb: 115,
        expectedSizeKb: 100,
        sizeDiffKb: 15,
        actualChunksCount: 2,
        expectedChunksCount: 2,
      };

      const regression = detector.createIncreasedSizeRegression(comparison);
      expect(regression.componentName).toBe('App');
      expect(regression.type).toBe(RegressionType.INCREASED_SIZE);
      expect(regression.sizeDiffKb).toBe(15);
      expect(regression.expectedSizeKb).toBe(100);
      expect(regression.actualSizeKb).toBe(115);
    });
  });

  describe('createIncreasedChunksCountRegression', () => {
    it('creates regression for chunks count increase', () => {
      const detector = new RegressionDetector();
      const comparison: SizeComparison = {
        name: 'App',
        actualSizeKb: 100,
        expectedSizeKb: 100,
        sizeDiffKb: 0,
        actualChunksCount: 5,
        expectedChunksCount: 3,
      };

      const regression = detector.createIncreasedChunksCountRegression(comparison);
      expect(regression.componentName).toBe('App');
      expect(regression.type).toBe(RegressionType.INCREASED_CHUNKS_COUNT);
      expect(regression.actualChunksCount).toBe(5);
      expect(regression.expectedChunksCount).toBe(3);
    });
  });

  describe('detectRegressions', () => {
    it('detects all types of regressions', () => {
      const detector = new RegressionDetector();
      const comparisonResult: ComparisonResult = {
        newComponents: [
          { name: 'NewComp', chunksCount: 1, gzipSizeKb: 10, brotliSizeKb: 8 },
        ],
        removedComponents: [
          { name: 'OldComp', chunksCount: 1, gzipSizeKb: '20.00', brotliSizeKb: '15.00' },
        ],
        sizeChanges: [
          { name: 'App', actualSizeKb: 115, expectedSizeKb: 100, sizeDiffKb: 15, actualChunksCount: 2, expectedChunksCount: 2 },
        ],
        chunksCountIncreases: [
          { name: 'Header', actualSizeKb: 50, expectedSizeKb: 50, sizeDiffKb: 0, actualChunksCount: 4, expectedChunksCount: 2 },
        ],
      };

      const regressions = detector.detectRegressions(comparisonResult);
      expect(regressions).toHaveLength(4);

      const types = regressions.map(r => r.type);
      expect(types).toContain(RegressionType.NEW_COMPONENT);
      expect(types).toContain(RegressionType.REMOVED_COMPONENT);
      expect(types).toContain(RegressionType.INCREASED_SIZE);
      expect(types).toContain(RegressionType.INCREASED_CHUNKS_COUNT);
    });

    it('returns empty array when no regressions', () => {
      const detector = new RegressionDetector();
      const comparisonResult: ComparisonResult = {
        newComponents: [],
        removedComponents: [],
        sizeChanges: [],
        chunksCountIncreases: [],
      };

      const regressions = detector.detectRegressions(comparisonResult);
      expect(regressions).toHaveLength(0);
    });

    it('handles multiple regressions of same type', () => {
      const detector = new RegressionDetector();
      const comparisonResult: ComparisonResult = {
        newComponents: [
          { name: 'A', chunksCount: 1, gzipSizeKb: 5, brotliSizeKb: 4 },
          { name: 'B', chunksCount: 2, gzipSizeKb: 10, brotliSizeKb: 8 },
        ],
        removedComponents: [],
        sizeChanges: [],
        chunksCountIncreases: [],
      };

      const regressions = detector.detectRegressions(comparisonResult);
      expect(regressions).toHaveLength(2);
      expect(regressions[0].componentName).toBe('A');
      expect(regressions[1].componentName).toBe('B');
    });
  });

  describe('evaluateRegression', () => {
    it('uses default policy to evaluate', () => {
      const detector = new RegressionDetector();
      const regression: Regression = {
        componentName: 'App',
        type: RegressionType.INCREASED_SIZE,
      };
      const result = detector.evaluateRegression(regression);
      expect(result.shouldFail).toBe(true);
    });

    it('uses custom policy when provided', () => {
      const detector = new RegressionDetector({
        policy: () => ({ shouldFail: false, message: 'Allowed' }),
      });
      const regression: Regression = {
        componentName: 'App',
        type: RegressionType.INCREASED_SIZE,
      };
      const result = detector.evaluateRegression(regression);
      expect(result.shouldFail).toBe(false);
      expect(result.message).toBe('Allowed');
    });
  });

  describe('evaluateAll', () => {
    it('splits regressions into failures and warnings', () => {
      const detector = new RegressionDetector({
        policy: (regression) => ({
          shouldFail: regression.type === RegressionType.INCREASED_SIZE,
          message: 'evaluated',
        }),
      });

      const regressions: Regression[] = [
        { componentName: 'App', type: RegressionType.INCREASED_SIZE },
        { componentName: 'NewComp', type: RegressionType.NEW_COMPONENT },
        { componentName: 'Header', type: RegressionType.INCREASED_SIZE },
      ];

      const result = detector.evaluateAll(regressions);
      expect(result.failures).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].componentName).toBe('NewComp');
    });

    it('attaches policy message to regressions', () => {
      const detector = new RegressionDetector({
        policy: () => ({ shouldFail: true, message: 'Custom message' }),
      });

      const regressions: Regression[] = [
        { componentName: 'App', type: RegressionType.INCREASED_SIZE },
      ];

      detector.evaluateAll(regressions);
      expect(regressions[0].policyMessage).toBe('Custom message');
    });

    it('returns empty arrays for empty input', () => {
      const detector = new RegressionDetector();
      const result = detector.evaluateAll([]);
      expect(result.failures).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
