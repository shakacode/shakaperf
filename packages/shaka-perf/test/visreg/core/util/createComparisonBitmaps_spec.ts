import assert from 'node:assert';
import type { RuntimeConfig } from '../../../../src/visreg/core/types';

describe('createComparisonBitmaps', function () {
  let capturedConfig: Record<string, unknown> | null;

  const mockConfig = {
    configFileName: '/tmp/dummy-config.json',
    tempCompareConfigFileName: '/tmp/test-compare-config.json',
    defaultMisMatchThreshold: 0.1,
    defaultRequireSameDimensions: true,
    compareRetries: 3,
    compareRetryDelay: 5000,
    maxNumDiffPixels: 10,
    args: {
      testFile: '/dummy/test.abtest.ts',
      controlURL: 'http://localhost:3020',
      experimentURL: 'http://localhost:3030',
      _loadedVisregConfig: {
        viewports: [
          { label: 'mobile', width: 320, height: 480 },
          { label: 'tablet', width: 1024, height: 768 },
        ],
        engineOptions: { browser: 'chromium' },
      },
    },
  } as unknown as RuntimeConfig;

  afterEach(function () {
    capturedConfig = null;
  });

  function mockRegisteredTests (tests?: unknown[]) {
    const defaultTests = [{
      name: 'Test Scenario 1',
      startingPath: '/page1',
      options: { visreg: {} },
      testFn: async function () {},
    }, {
      name: 'Test Scenario 2',
      startingPath: '/page2',
      options: { visreg: {} },
      testFn: async function () {},
    }];

    return tests || defaultTests;
  }

  function createModule (overrides?: {
    runCompareScenario?: Record<string, unknown>;
    registeredTests?: unknown[];
  }) {
    jest.resetModules();

    const tests = mockRegisteredTests(overrides?.registeredTests);

    jest.mock('shaka-shared', () => ({
      loadTests: function (opts: { filter?: string } = {}) {
        let result = tests;
        if (opts.filter) {
          const patterns = opts.filter.split(',');
          result = tests.filter((t) => patterns.some((p) => new RegExp(p).test((t as { name: string }).name)));
        }
        return Promise.resolve(result);
      },
    }));

    const runCompareScenarioMock = overrides?.runCompareScenario || {
      playwright: function (scenarioView: Record<string, unknown>) {
        capturedConfig = scenarioView.config as Record<string, unknown>;
        return Promise.resolve({
          testPairs: [{
            test: '/path/to/test.png',
            reference: '/path/to/ref.png',
            selector: 'body',
          }],
        });
      },
    };

    jest.mock('node:fs/promises', () => ({
      writeFile: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/runCompareScenario', () => runCompareScenarioMock);
    jest.mock('../../../../src/visreg/core/util/runPlaywright', () => ({
      createPlaywrightBrowser: function () { return Promise.resolve({}); },
      disposePlaywrightBrowser: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/ensureDirectoryPath', () => ({
      __esModule: true,
      default: function () {},
    }));
    jest.mock('../../../../src/visreg/core/util/logger', () => ({
      __esModule: true,
      default: function () {
        return { log: function () {}, error: function () {} };
      },
    }));
    const mod = require('../../../../src/visreg/core/util/createComparisonBitmaps');
    return mod.default;
  }

  it('should pass compare config options to scenarios', async function () {
    const createComparisonBitmaps = createModule();
    await createComparisonBitmaps(mockConfig);

    assert(capturedConfig, 'Should have captured config');
    assert.strictEqual(capturedConfig.compareRetries, 3, 'Should pass compareRetries');
    assert.strictEqual(capturedConfig.compareRetryDelay, 5000, 'Should pass compareRetryDelay');
    assert.strictEqual(capturedConfig.maxNumDiffPixels, 10, 'Should pass maxNumDiffPixels');
  });

  it('should set isCompare flag', async function () {
    const createComparisonBitmaps = createModule();
    await createComparisonBitmaps(mockConfig);

    assert(capturedConfig, 'Should have captured config');
    assert.strictEqual(capturedConfig.isCompare, true, 'Should set isCompare to true');
    assert.strictEqual(capturedConfig.isControl, false, 'Should set isControl to false');
  });

  it('should throw error when no tests registered', async function () {
    jest.resetModules();

    const noTestsError = new Error('No tests registered in /dummy/test.abtest.ts. Did you call abTest()?');
    jest.mock('shaka-shared', () => ({
      loadTests: function () { return Promise.reject(noTestsError); },
    }));

    jest.mock('node:fs/promises', () => ({
      writeFile: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/runCompareScenario', () => ({
      playwright: function () { return Promise.resolve({ testPairs: [] }); },
    }));
    jest.mock('../../../../src/visreg/core/util/runPlaywright', () => ({
      createPlaywrightBrowser: function () { return Promise.resolve({}); },
      disposePlaywrightBrowser: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/ensureDirectoryPath', () => ({
      __esModule: true,
      default: function () {},
    }));
    jest.mock('../../../../src/visreg/core/util/logger', () => ({
      __esModule: true,
      default: function () {
        return { log: function () {}, error: function () {} };
      },
    }));

    const mod = require('../../../../src/visreg/core/util/createComparisonBitmaps');
    const createComparisonBitmaps = mod.default;

    let errorThrown = false;
    try {
      await createComparisonBitmaps(mockConfig);
    } catch (e: unknown) {
      errorThrown = true;
      assert(e instanceof Error);
      assert(
        e.message.includes('No tests registered'),
        'Error should mention no tests registered: ' + e.message,
      );
    }

    assert(errorThrown, 'Should have thrown an error');
  });

  it('should filter scenarios by filter arg', async function () {
    let scenarioCount = 0;
    const createComparisonBitmaps = createModule({
      runCompareScenario: {
        playwright: function (scenarioView: Record<string, unknown>) {
          scenarioCount++;
          capturedConfig = scenarioView.config as Record<string, unknown>;
          return Promise.resolve({ testPairs: [] });
        },
      },
    });

    const configWithFilter = {
      ...mockConfig,
      args: { ...mockConfig.args, filter: 'Scenario 1' },
    };

    await createComparisonBitmaps(configWithFilter);

    // With filter 'Scenario 1', only 1 scenario should match (Test Scenario 1)
    // multiplied by 2 viewports = 2 calls
    assert.strictEqual(scenarioCount, 2, 'Should only process filtered scenarios');
  });

  it('should load scenarios from testFile and convert via registry', async function () {
    const mockTestFn = async function () {};

    const capturedScenarios: Array<Record<string, unknown>> = [];
    const createComparisonBitmaps = createModule({
      registeredTests: [{
        name: 'Test from registry',
        startingPath: '/page1',
        options: {
          visreg: {
            selectors: ['[data-cy="hero"]'],
            misMatchThreshold: 0.05,
          },
        },
        testFn: mockTestFn,
      }],
      runCompareScenario: {
        playwright: function (scenarioView: Record<string, unknown>) {
          capturedConfig = scenarioView.config as Record<string, unknown>;
          const scenario = scenarioView.scenario as Record<string, unknown>;
          capturedScenarios.push(scenario);
          return Promise.resolve({ testPairs: [] });
        },
      },
    });

    await createComparisonBitmaps(mockConfig);

    assert(capturedConfig, 'Should have captured config');
    // 1 scenario × 2 viewports = 2 scenario views
    assert.strictEqual(capturedScenarios.length, 2, 'Should have 2 scenario views (1 scenario × 2 viewports)');
    assert.strictEqual(capturedScenarios[0].label, 'Test from registry');
    assert.strictEqual(capturedScenarios[0].url, 'http://localhost:3030/page1');
    assert.strictEqual(capturedScenarios[0].referenceUrl, 'http://localhost:3020/page1');
    assert.deepStrictEqual(capturedScenarios[0].selectors, ['[data-cy="hero"]']);
    assert.strictEqual(capturedScenarios[0].misMatchThreshold, 0.05);
    assert.strictEqual(capturedScenarios[0]._testFn, mockTestFn, 'Should attach testFn');
  });

  it('should use default control and experiment URLs', async function () {
    const capturedScenarios: Array<Record<string, unknown>> = [];
    const createComparisonBitmaps = createModule({
      registeredTests: [{
        name: 'Default URLs test',
        startingPath: '/products',
        options: {},
        testFn: async function () {},
      }],
      runCompareScenario: {
        playwright: function (scenarioView: Record<string, unknown>) {
          capturedConfig = scenarioView.config as Record<string, unknown>;
          capturedScenarios.push(scenarioView.scenario as Record<string, unknown>);
          return Promise.resolve({ testPairs: [] });
        },
      },
    });

    const configWithoutURLs = {
      ...mockConfig,
      args: {
        testFile: '/dummy/test.abtest.ts',
        _loadedVisregConfig: (mockConfig.args as Record<string, unknown>)._loadedVisregConfig,
      },
    };

    await createComparisonBitmaps(configWithoutURLs);

    // Without explicit URLs, defaults should be used
    assert.strictEqual(capturedScenarios[0].url, 'http://localhost:3030/products');
    assert.strictEqual(capturedScenarios[0].referenceUrl, 'http://localhost:3020/products');
  });

  it('should auto-discover test files when testFile is not provided', async function () {
    const capturedScenarios: Array<Record<string, unknown>> = [];
    const createComparisonBitmaps = createModule({
      registeredTests: [{
        name: 'Auto-discovered test',
        startingPath: '/auto',
        options: {},
        testFn: async function () {},
      }],
      runCompareScenario: {
        playwright: function (scenarioView: Record<string, unknown>) {
          capturedConfig = scenarioView.config as Record<string, unknown>;
          capturedScenarios.push(scenarioView.scenario as Record<string, unknown>);
          return Promise.resolve({ testPairs: [] });
        },
      },
    });

    const configWithoutTestFile = {
      ...mockConfig,
      args: {
        _loadedVisregConfig: (mockConfig.args as Record<string, unknown>)._loadedVisregConfig,
      },
    };

    await createComparisonBitmaps(configWithoutTestFile);

    assert(capturedScenarios.length > 0, 'Should have processed auto-discovered scenarios');
    assert.strictEqual(capturedScenarios[0].label, 'Auto-discovered test');
  });

  it('should throw when loadTests throws (no test files found)', async function () {
    jest.resetModules();

    const noFilesError = new Error('No .abtest.ts or .abtest.js files found. Use --testFile to specify a file directly.');
    jest.mock('shaka-shared', () => ({
      loadTests: function () { return Promise.reject(noFilesError); },
    }));

    jest.mock('node:fs/promises', () => ({
      writeFile: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/runCompareScenario', () => ({
      playwright: function () { return Promise.resolve({ testPairs: [] }); },
    }));
    jest.mock('../../../../src/visreg/core/util/runPlaywright', () => ({
      createPlaywrightBrowser: function () { return Promise.resolve({}); },
      disposePlaywrightBrowser: function () { return Promise.resolve(); },
    }));
    jest.mock('../../../../src/visreg/core/util/ensureDirectoryPath', () => ({
      __esModule: true,
      default: function () {},
    }));
    jest.mock('../../../../src/visreg/core/util/logger', () => ({
      __esModule: true,
      default: function () {
        return { log: function () {}, error: function () {} };
      },
    }));

    const mod = require('../../../../src/visreg/core/util/createComparisonBitmaps');
    const createComparisonBitmaps = mod.default;

    const configNoTestFile = {
      ...mockConfig,
      args: {
        _loadedVisregConfig: (mockConfig.args as Record<string, unknown>)._loadedVisregConfig,
      },
    };

    let errorThrown = false;
    try {
      await createComparisonBitmaps(configNoTestFile);
    } catch (e: unknown) {
      errorThrown = true;
      assert(e instanceof Error);
      assert(e.message.includes('No .abtest.ts or .abtest.js files found'), 'Error should mention no files found: ' + e.message);
    }
    assert(errorThrown, 'Should have thrown an error');
  });
});
