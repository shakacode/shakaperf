import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('preparePage', function () {
  let preparePage: typeof import('../../../core/util/preparePage.js').default;
  let translateUrl: typeof import('../../../core/util/preparePage.js').translateUrl;

  const mockEvaluate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const mockGoto = jest.fn<(...args: unknown[]) => Promise<void>>();
  const mockWaitForSelector = jest.fn<(...args: unknown[]) => Promise<void>>();
  const mockOn = jest.fn();
  const mockRemoveListener = jest.fn();
  const mockAddInitScript = jest.fn<(...args: unknown[]) => Promise<void>>();

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

  const baseScenario = {
    label: 'Test',
    url: 'http://localhost:3030/page',
    selectors: ['document'],
  };

  const baseViewport = { label: 'desktop', width: 1280, height: 800 };
  const baseConfig = {} as import('../../../core/types.js').VisregConfig;
  const baseBrowserContext = {} as import('../../../core/types.js').BrowserContext;
  const engineScriptsPath = '/tmp/engine_scripts';

  beforeAll(async function () {
    jest.unstable_mockModule('../../../capture/visregTools.js', () => ({
      default: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }));
    jest.unstable_mockModule('../../../core/util/logger.js', () => ({
      default: function () {
        return { log: function () {}, error: function () {}, warn: function () {} };
      },
    }));

    const mod = await import('../../../core/util/preparePage.js');
    preparePage = mod.default;
    translateUrl = mod.translateUrl;
  });

  describe('testFn execution', function () {
    it('should call _testFn when present on scenario', async function () {
      const testFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

      assert.strictEqual(testFn.mock.calls.length, 1);
    });

    it('should pass page, browserContext, and isReference to testFn', async function () {
      const testFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, true, baseBrowserContext, engineScriptsPath);

      const callArgs = testFn.mock.calls[0] as unknown[];
      const context = callArgs[0] as Record<string, unknown>;
      assert.strictEqual(context.page, page);
      assert.strictEqual(context.browserContext, baseBrowserContext);
      assert.strictEqual(context.isReference, true);
    });

    it('should call testFn with isReference=false for experiment page', async function () {
      const testFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

      const callArgs = testFn.mock.calls[0] as unknown[];
      const context = callArgs[0] as Record<string, unknown>;
      assert.strictEqual(context.isReference, false);
    });

    it('should not attempt onReadyScript when _testFn is present', async function () {
      const testFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const page = makePage();
      const scenario = {
        ...baseScenario,
        _testFn: testFn,
        onReadyScript: 'should-not-be-loaded.ts',
      };

      // If onReadyScript were attempted on a nonexistent file, it would log a warning
      // but since _testFn takes precedence, onReadyScript should be skipped entirely
      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

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

      await preparePage(page, 'http://test.com/page', baseScenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

      assert.strictEqual(mockGoto.mock.calls.length, 1);
      assert.strictEqual((mockGoto.mock.calls[0] as unknown[])[0], 'http://test.com/page');
    });

    it('should wait for readySelector when provided', async function () {
      const page = makePage();
      const scenario = {
        ...baseScenario,
        readySelector: '#app-loaded',
      };

      await preparePage(page, scenario.url, scenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

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

      await preparePage(page, scenario.url, scenario as typeof baseScenario, baseViewport, baseConfig, false, baseBrowserContext, engineScriptsPath);

      // The function modifies scenario.selectors in place
      assert.deepStrictEqual((scenario as Record<string, unknown>).selectors, ['document']);
    });
  });
});
