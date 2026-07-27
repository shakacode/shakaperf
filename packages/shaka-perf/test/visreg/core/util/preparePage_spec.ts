/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import type { AbTestDefinition } from 'shaka-shared';

describe('preparePage', function () {
  let preparePage: typeof import('../../../../src/visreg/core/util/preparePage').default;
  let translateUrl: typeof import('../../../../src/visreg/core/util/preparePage').translateUrl;

  const mockGoto = jest.fn();

  function makePage () {
    mockGoto.mockReset();

    mockGoto.mockResolvedValue(undefined);

    return {
      goto: mockGoto,
    } as unknown as import('playwright').Page;
  }

  const baseTestDef: AbTestDefinition = {
    name: 'Test',
    startingPath: '/page',
    file: null,
    line: null,
    testTypes: null,
    testFn: async function () {},
  };

  const baseScenario = {
    label: 'Test',
    url: 'http://localhost:3030/page',
    selectors: ['document'],
  };

  const baseViewport = { label: 'desktop', width: 1280, height: 800, formFactor: 'desktop' as const, deviceScaleFactor: 1 };
  const baseConfig = {} as import('../../../../src/visreg/core/types').DecoratedCompareConfig;
  const baseBrowserContext = {} as import('../../../../src/visreg/core/types').BrowserContext;

  beforeAll(function () {
    jest.mock('../../../../src/visreg/capture/visregTools', () => ({
      __esModule: true,
      default: jest.fn().mockResolvedValue(undefined),
    }));

    const mod = require('../../../../src/visreg/core/util/preparePage');
    preparePage = mod.default;
    translateUrl = mod.translateUrl;
  });

  describe('testFn execution', function () {
    it('should call _testFn when present on scenario', async function () {
      const testFn = jest.fn().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        _testDef: baseTestDef,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext);

      assert.strictEqual(testFn.mock.calls.length, 1);
    });

    it('should pass page, browserContext, and isControl to testFn', async function () {
      const testFn = jest.fn().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        _testDef: baseTestDef,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, true, baseBrowserContext);

      const callArgs = testFn.mock.calls[0] as unknown[];
      const context = callArgs[0] as Record<string, unknown>;
      assert.strictEqual(context.page, page);
      assert.strictEqual(context.browserContext, baseBrowserContext);
      assert.strictEqual(context.isControl, true);
    });

    it('should pass scenario (testDef), viewport, and testType to testFn', async function () {
      const testFn = jest.fn().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        _testDef: baseTestDef,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext);

      const callArgs = testFn.mock.calls[0] as unknown[];
      const context = callArgs[0] as Record<string, unknown>;
      assert.strictEqual(context.scenario, baseTestDef);
      assert.deepStrictEqual(context.viewport, baseViewport);
      assert.strictEqual(context.testType, 'visreg');
    });

    it('should call testFn with isControl=false for experiment page', async function () {
      const testFn = jest.fn().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        _testDef: baseTestDef,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext);

      const callArgs = testFn.mock.calls[0] as unknown[];
      const context = callArgs[0] as Record<string, unknown>;
      assert.strictEqual(context.isControl, false);
    });

  });

  describe('translateUrl', function () {
    it('should prefix relative paths with file://', function () {
      const result = translateUrl('./index.html');
      assert.ok(result.startsWith('file://'));
      assert.ok(result.includes('index.html'));
    });

    it('should prefix dot-dot paths with file://', function () {
      const result = translateUrl('../page.html');
      assert.ok(result.startsWith('file://'));
    });

    it('should return http URLs unchanged', function () {
      assert.strictEqual(translateUrl('http://example.com'), 'http://example.com');
    });

    it('should return https URLs unchanged', function () {
      assert.strictEqual(translateUrl('https://example.com'), 'https://example.com');
    });
  });

  describe('page navigation', function () {
    it('should navigate to the provided URL', async function () {
      const page = makePage();

      await preparePage(page, 'http://test.com/page', baseScenario, baseViewport, baseConfig, false, baseBrowserContext);

      assert.strictEqual(mockGoto.mock.calls.length, 1);
      assert.strictEqual((mockGoto.mock.calls[0] as unknown[])[0], 'http://test.com/page');
    });
  });

});
