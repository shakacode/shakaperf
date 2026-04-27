import { abTest, getRegisteredTests, clearRegistry, TestType } from '../ab-test-registry';
import type { AbTestDefinition, TestFnContext } from '../ab-test-registry';

describe('ab-test-registry', () => {
  afterEach(() => {
    clearRegistry();
  });

  describe('abTest', () => {
    it('registers a test definition', () => {
      const testFn = async () => {};
      abTest('My test', { startingPath: '/page' }, testFn);

      const tests = getRegisteredTests();
      expect(tests).toHaveLength(1);
      expect(tests[0].name).toBe('My test');
      expect(tests[0].startingPath).toBe('/page');
      expect(tests[0].testFn).toBe(testFn);
    });

    it('defaults options to empty object when not provided', () => {
      abTest('No options', { startingPath: '/' }, async () => {});

      const tests = getRegisteredTests();
      expect(tests[0].options).toEqual({});
    });

    it('preserves options when provided', () => {
      const options = {
        markers: [{ end: 'marker-end', label: 'My Marker' }],
        resultsFolder: './results',
        visreg: {
          selectors: ['.hero'],
          misMatchThreshold: 0.05,
        },
      };

      abTest('With options', { startingPath: '/page', options }, async () => {});

      const tests = getRegisteredTests();
      expect(tests[0].options).toEqual(options);
    });

    it('registers multiple tests in order', () => {
      abTest('Test A', { startingPath: '/a' }, async () => {});
      abTest('Test B', { startingPath: '/b' }, async () => {});
      abTest('Test C', { startingPath: '/c' }, async () => {});

      const tests = getRegisteredTests();
      expect(tests).toHaveLength(3);
      expect(tests[0].name).toBe('Test A');
      expect(tests[1].name).toBe('Test B');
      expect(tests[2].name).toBe('Test C');
    });
  });

  describe('getRegisteredTests', () => {
    it('returns empty array when no tests registered', () => {
      expect(getRegisteredTests()).toEqual([]);
    });

    it('returns a shallow copy (not the internal array)', () => {
      abTest('Test', { startingPath: '/' }, async () => {});

      const tests1 = getRegisteredTests();
      const tests2 = getRegisteredTests();
      expect(tests1).not.toBe(tests2);
      expect(tests1).toEqual(tests2);
    });

    it('mutating returned array does not affect registry', () => {
      abTest('Test', { startingPath: '/' }, async () => {});

      const tests = getRegisteredTests();
      tests.push({} as AbTestDefinition);

      expect(getRegisteredTests()).toHaveLength(1);
    });
  });

  describe('clearRegistry', () => {
    it('removes all registered tests', () => {
      abTest('Test 1', { startingPath: '/a' }, async () => {});
      abTest('Test 2', { startingPath: '/b' }, async () => {});

      expect(getRegisteredTests()).toHaveLength(2);

      clearRegistry();

      expect(getRegisteredTests()).toHaveLength(0);
    });

    it('allows re-registration after clearing', () => {
      abTest('Original', { startingPath: '/old' }, async () => {});
      clearRegistry();
      abTest('New', { startingPath: '/new' }, async () => {});

      const tests = getRegisteredTests();
      expect(tests).toHaveLength(1);
      expect(tests[0].name).toBe('New');
    });
  });

  describe('testTypes option', () => {
    it('defaults testTypes to null when not provided', () => {
      abTest('No testTypes', { startingPath: '/' }, async () => {});

      const tests = getRegisteredTests();
      expect(tests[0].testTypes).toBeNull();
    });

    it('preserves testTypes when provided', () => {
      abTest(
        'Visreg only',
        { startingPath: '/', testTypes: ['visreg'] },
        async () => {},
      );

      const tests = getRegisteredTests();
      expect(tests[0].testTypes).toEqual(['visreg']);
    });

    it('accepts multiple testTypes', () => {
      abTest(
        'Both types',
        {
          startingPath: '/',
          testTypes: ['visreg', 'perf'],
        },
        async () => {},
      );

      const tests = getRegisteredTests();
      expect(tests[0].testTypes).toEqual(['visreg', 'perf']);
    });
  });

  describe('TestFnContext', () => {
    it('should accept testFn with full context', () => {
      const testFn = async (ctx: TestFnContext) => {
        // Verify all context properties are accessible
        expect(ctx.page).toBeDefined();
        expect(ctx.browserContext).toBeDefined();
        expect(typeof ctx.isReference).toBe('boolean');
        expect(ctx.scenario).toBeDefined();
        expect(ctx.viewport).toBeDefined();
        expect(ctx.testType).toBeDefined();
      };

      abTest('Context test', { startingPath: '/page' }, testFn);

      const tests = getRegisteredTests();
      expect(tests[0].testFn).toBe(testFn);
    });

    it('should accept testFn that only destructures a subset of context', () => {
      // This verifies backward compatibility — existing tests only use { page }
      const testFn = async ({ page }: TestFnContext) => {
        void page;
      };

      abTest('Subset test', { startingPath: '/' }, testFn);
      expect(getRegisteredTests()).toHaveLength(1);
    });
  });

  describe('AbTestVisregConfig', () => {
    it('stores all visreg config properties', () => {
      abTest(
        'Full visreg config',
        {
          startingPath: '/page',
          options: {
            visreg: {
              selectors: ['[data-cy="hero"]'],
              selectorExpansion: true,
              hideSelectors: ['.cookie-banner'],
              removeSelectors: ['.ad-slot'],
              hoverSelector: '.menu-item',
              clickSelector: '.button',
              scrollToSelector: '#footer',
              postInteractionWait: 500,
              misMatchThreshold: 0.1,
              requireSameDimensions: true,
              maxNumDiffPixels: 50,
              compareRetries: 3,
              compareRetryDelay: 1000,
              comparePixelmatchThreshold: 0.3,
              readyEvent: 'app:ready',
              readySelector: '#root',
              readyTimeout: 10000,
              delay: 200,
              cookiePath: 'cookies.json',
            },
            viewports: ['desktop'],
          },
        },
        async () => {},
      );

      const tests = getRegisteredTests();
      const stored = tests[0].options;
      const visreg = stored.visreg!;
      expect(visreg.selectors).toEqual(['[data-cy="hero"]']);
      expect(visreg.misMatchThreshold).toBe(0.1);
      expect(visreg.readyEvent).toBe('app:ready');
      expect(stored.viewports).toEqual(['desktop']);
    });
  });
});
