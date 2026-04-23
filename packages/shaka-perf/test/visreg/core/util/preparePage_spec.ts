import assert from 'node:assert';
import { TestType } from 'shaka-shared';
import type { AbTestDefinition } from 'shaka-shared';

describe('preparePage', function () {
  let preparePage: typeof import('../../../../src/visreg/core/util/preparePage').default;
  let translateUrl: typeof import('../../../../src/visreg/core/util/preparePage').translateUrl;

  const mockEvaluate = jest.fn();
  const mockGoto = jest.fn();
  const mockWaitForSelector = jest.fn();
  const mockOn = jest.fn();
  const mockRemoveListener = jest.fn();
  const mockAddInitScript = jest.fn();

  function makePage () {
    mockEvaluate.mockReset();
    mockGoto.mockReset();
    mockWaitForSelector.mockReset();
    mockOn.mockReset();
    mockRemoveListener.mockReset();
    mockAddInitScript.mockReset();

    mockGoto.mockResolvedValue(undefined);
    mockWaitForSelector.mockResolvedValue(undefined);
    mockAddInitScript.mockResolvedValue(undefined);
    mockEvaluate.mockResolvedValue({
      visregSelectorsExp: ['document'],
      visregSelectorsExpMap: { document: { exists: 1, isVisible: true } },
    });

    return {
      goto: mockGoto,
      evaluate: mockEvaluate,
      waitForSelector: mockWaitForSelector,
      on: mockOn,
      removeListener: mockRemoveListener,
      addInitScript: mockAddInitScript,
    } as unknown as import('playwright').Page;
  }

  const baseTestDef: AbTestDefinition = {
    name: 'Test',
    startingPath: '/page',
    file: null,
    line: null,
    options: {},
    testTypes: null,
    testFn: async function () {},
  };

  const baseScenario = {
    label: 'Test',
    url: 'http://localhost:3030/page',
    selectors: ['document'],
  };

  const baseViewport = { label: 'desktop', width: 1280, height: 800 };
  const baseConfig = {} as import('../../../../src/visreg/core/types').VisregConfig;
  const baseBrowserContext = {} as import('../../../../src/visreg/core/types').BrowserContext;

  beforeAll(function () {
    jest.mock('../../../../src/visreg/capture/visregTools', () => ({
      __esModule: true,
      default: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../../../src/visreg/capture/helpers/loadCookies', () => ({
      __esModule: true,
      loadCookies: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../../../src/visreg/capture/helpers/waitUntilPageSettled', () => ({
      __esModule: true,
      waitUntilPageSettled: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../../../src/visreg/capture/helpers/clickAndHoverHelper', () => ({
      __esModule: true,
      clickAndHoverHelper: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../../../../src/visreg/core/util/logger', () => ({
      __esModule: true,
      default: function () {
        return { log: function () {}, error: function () {}, warn: function () {} };
      },
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

    it('should pass page, browserContext, and isReference to testFn', async function () {
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
      assert.strictEqual(context.isReference, true);
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
      assert.deepStrictEqual(context.viewport, { label: 'desktop', width: 1280, height: 800 });
      assert.strictEqual(context.testType, TestType.VisualRegression);
    });

    it('should call testFn with isReference=false for experiment page', async function () {
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
      assert.strictEqual(context.isReference, false);
    });

    it('should skip default onReady behavior when _testFn is present', async function () {
      const testFn = jest.fn().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        _testDef: baseTestDef,
      };

      // _testFn takes precedence over the default waitUntilPageSettled + clickAndHoverHelper
      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext);

      assert.strictEqual(testFn.mock.calls.length, 1);
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

    it('should wait for readySelector when provided', async function () {
      const page = makePage();
      const scenario = {
        ...baseScenario,
        readySelector: '#app-loaded',
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext);

      assert.strictEqual(mockWaitForSelector.mock.calls.length, 1);
      assert.strictEqual((mockWaitForSelector.mock.calls[0] as unknown[])[0], '#app-loaded');
    });
  });

  describe('selector defaults', function () {
    it('should default to ["document"] when no selectors provided', async function () {
      const page = makePage();
      const scenario = {
        label: 'No selectors',
        url: 'http://test.com',
      };

      await preparePage(page, scenario.url, scenario as typeof baseScenario, baseViewport, baseConfig, false, baseBrowserContext);

      // The function modifies scenario.selectors in place
      assert.deepStrictEqual((scenario as Record<string, unknown>).selectors, ['document']);
    });
  });
});
