/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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

    it('preserves flat per-test config when provided', () => {
      const beforeNavigate = async () => {};
      abTest('With config', {
        startingPath: '/page',
        experimentPathOverride: '/page-new',
        markers: [{ end: 'marker-end', label: 'My Marker' }],
        visregSelectors: ['.hero'],
        config: { shared: { beforeNavigate } },
      }, async () => {});

      const tests = getRegisteredTests();
      expect(tests[0].experimentPathOverride).toBe('/page-new');
      expect(tests[0].markers).toEqual([{ end: 'marker-end', label: 'My Marker' }]);
      expect(tests[0].visregSelectors).toEqual(['.hero']);
      expect(tests[0].config?.shared?.beforeNavigate).toBe(beforeNavigate);
    });

    it('throws when name contains a comma', () => {
      expect(() =>
        abTest('Has, a comma', { startingPath: '/' }, async () => {}),
      ).toThrow(/must not contain commas/);
      expect(getRegisteredTests()).toHaveLength(0);
    });

    // Test files load via tsx without typechecking, and the config is spread
    // onto the definition — so an unrecognized key is read by nobody and the
    // test silently runs on defaults. Every legacy key must be rejected, not
    // just the two that used to have hand-written guards.
    it.each([
      ['pre-flattening options blob', { options: { visreg: { misMatchThreshold: 0.01 } } }],
      ['stale top-level beforeNavigate', { beforeNavigate: async () => {} }],
      ['stale hideSelectors', { hideSelectors: ['.cookie-banner'] }],
      ['removed visregSelectorExpansion', { visregSelectorExpansion: true }],
      ['removed resultsFolder', { resultsFolder: 'out/' }],
      ['old selectors spelling', { selectors: ['[data-cy="hero"]'] }],
      ['un-nested visreg section', { visreg: { mismatchThreshold: 0.01 } }],
      ['old flat viewports', { viewports: ['desktop'] }],
    ])('rejects %s, naming the key and the legal ones', (_label, extra) => {
      expect(() =>
        abTest('Legacy', { startingPath: '/', ...extra } as never, async () => {}),
      ).toThrow(/unrecognized key\(s\).*abTest\(\) accepts.*BREAKING_CHANGES\.md/s);
      expect(getRegisteredTests()).toHaveLength(0);
    });

    it('accepts every key AbTestConfig declares', () => {
      abTest('Full', {
        startingPath: '/',
        experimentPathOverride: '/basket',
        testTypes: ['visreg'],
        visregSelectors: ['[data-cy="hero"]'],
        markers: [{ start: 'a', end: 'b', label: 'phase' }],
        config: { visreg: { mismatchThreshold: 0.01 } },
      }, async () => {});
      expect(getRegisteredTests()).toHaveLength(1);
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
      expect(tests[0].testTypes).toEqual(['visreg', 'audit']);
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
      expect(tests[0].testTypes).toEqual(['visreg', 'perf', 'audit']);
    });

    it('preserves explicit accessibility testTypes', () => {
      abTest(
        'Accessibility only',
        { startingPath: '/', testTypes: ['accessibility'] },
        async () => {},
      );

      const tests = getRegisteredTests();
      expect(tests[0].testTypes).toEqual(['accessibility', 'audit']);
    });
  });

  describe('TestFnContext', () => {
    it('should accept testFn with full context', () => {
      const testFn = async (ctx: TestFnContext) => {
        // Verify all context properties are accessible
        expect(ctx.page).toBeDefined();
        expect(ctx.browserContext).toBeDefined();
        expect(typeof ctx.isControl).toBe('boolean');
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

  describe('visreg capture config', () => {
    it('stores visregSelectors at the top level', () => {
      abTest(
        'Capture config',
        {
          startingPath: '/page',
          visregSelectors: ['[data-cy="hero"]'],
        },
        async () => {},
      );

      const tests = getRegisteredTests();
      expect(tests[0].visregSelectors).toEqual(['[data-cy="hero"]']);
    });
  });
});
