import { jest } from '@jest/globals';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import type { RuntimeConfig } from '../../../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('createComparisonBitmaps', function () {
  // Captured from mock — shape determined at runtime by the mocked module
  let capturedConfig: Record<string, unknown> | null;

  const fixturesDir = path.join(__dirname, 'fixtures');
  const configFilePath = path.join(fixturesDir, 'mockComparisonConfig.json');

  const mockConfigJSON = {
    id: 'test-config',
    viewports: [
      { label: 'phone', width: 320, height: 480 },
      { label: 'tablet', width: 1024, height: 768 }
    ],
    scenarios: [
      {
        label: 'Test Scenario 1',
        url: 'http://test.com/page1',
        referenceUrl: 'http://ref.com/page1'
      },
      {
        label: 'Test Scenario 2',
        url: 'http://test.com/page2',
        referenceUrl: 'http://ref.com/page2'
      }
    ],
    paths: {
      bitmaps_reference: 'visreg_data/bitmaps_reference',
      bitmaps_test: 'visreg_data/bitmaps_test'
    },
    engine: 'playwright'
  };

  const mockConfig = {
    configFileName: configFilePath,
    tempCompareConfigFileName: '/tmp/test-compare-config.json',
    defaultMisMatchThreshold: 0.1,
    defaultRequireSameDimensions: true,
    compareRetries: 3,
    compareRetryDelay: 5000,
    maxNumDiffPixels: 10,
    args: {}
  } as unknown as RuntimeConfig;

  beforeAll(function () {
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(configFilePath, JSON.stringify(mockConfigJSON));
  });

  afterEach(function () {
    capturedConfig = null;
  });

  afterAll(function () {
    try { unlinkSync(configFilePath); } catch (_e) { /* ignore */ }
  });

  async function createModule (overrides?: Record<string, unknown>) {
    jest.resetModules();

    const runCompareScenarioMock = (overrides && overrides.runCompareScenario) || {
      playwright: function (scenarioView: Record<string, unknown>) {
        capturedConfig = scenarioView.config as Record<string, unknown>;
        return Promise.resolve({
          testPairs: [{
            test: '/path/to/test.png',
            reference: '/path/to/ref.png',
            selector: 'body'
          }]
        });
      }
    };

    jest.unstable_mockModule('node:fs/promises', () => ({
      writeFile: function () { return Promise.resolve(); }
    }));
    jest.unstable_mockModule('../../../core/util/runCompareScenario.js', () => runCompareScenarioMock);
    jest.unstable_mockModule('../../../core/util/runPlaywright.js', () => ({
      createPlaywrightBrowser: function () { return Promise.resolve({}); },
      disposePlaywrightBrowser: function () { return Promise.resolve(); }
    }));
    jest.unstable_mockModule('../../../core/util/ensureDirectoryPath.js', () => ({
      default: function () {}
    }));
    jest.unstable_mockModule('../../../core/util/logger.js', () => ({
      default: function () {
        return { log: function () {}, error: function () {} };
      }
    }));

    const mod = await import('../../../core/util/createComparisonBitmaps.js');
    return mod.default;
  }

  it('should pass compare config options to scenarios', async function () {
    const createComparisonBitmaps = await createModule();
    await createComparisonBitmaps(mockConfig);

    assert(capturedConfig, 'Should have captured config');
    assert.strictEqual(capturedConfig.compareRetries, 3, 'Should pass compareRetries');
    assert.strictEqual(capturedConfig.compareRetryDelay, 5000, 'Should pass compareRetryDelay');
    assert.strictEqual(capturedConfig.maxNumDiffPixels, 10, 'Should pass maxNumDiffPixels');
  });

  it('should set isCompare flag', async function () {
    const createComparisonBitmaps = await createModule();
    await createComparisonBitmaps(mockConfig);

    assert(capturedConfig, 'Should have captured config');
    assert.strictEqual(capturedConfig.isCompare, true, 'Should set isCompare to true');
    assert.strictEqual(capturedConfig.isReference, false, 'Should set isReference to false');
  });

  it('should throw error when scenario missing referenceUrl', async function () {
    const badConfigJSON = {
      id: 'test-config',
      viewports: mockConfigJSON.viewports,
      paths: mockConfigJSON.paths,
      engine: 'playwright',
      scenarios: [
        { label: 'Missing referenceUrl', url: 'http://test.com/page' }
      ]
    };

    const badConfigFilePath = path.join(fixturesDir, 'mockComparisonConfig_bad.json');
    writeFileSync(badConfigFilePath, JSON.stringify(badConfigJSON));

    try {
      const createComparisonBitmaps = await createModule();
      const badMockConfig = {
        ...mockConfig,
        configFileName: badConfigFilePath
      };

      let errorThrown = false;
      try {
        await createComparisonBitmaps(badMockConfig);
      } catch (e: unknown) {
        errorThrown = true;
        assert(e instanceof Error);
        assert(
          e.message.toLowerCase().includes('referenceurl') ||
          e.message.toLowerCase().includes('reference'),
          'Error should mention referenceUrl: ' + e.message
        );
      }

      assert(errorThrown, 'Should have thrown an error');
    } finally {
      try { unlinkSync(badConfigFilePath); } catch (_e) { /* ignore */ }
    }
  });

  it('should filter scenarios by filter arg', async function () {
    let scenarioCount = 0;
    const createComparisonBitmaps = await createModule({
      runCompareScenario: {
        playwright: function (scenarioView: Record<string, unknown>) {
          scenarioCount++;
          capturedConfig = scenarioView.config as Record<string, unknown>;
          return Promise.resolve({ testPairs: [] });
        }
      }
    });

    const configWithFilter = {
      ...mockConfig,
      args: { filter: 'Scenario 1' }
    };

    await createComparisonBitmaps(configWithFilter);

    // With filter 'Scenario 1', only 1 scenario should match (Test Scenario 1)
    // multiplied by 2 viewports = 2 calls
    assert.strictEqual(scenarioCount, 2, 'Should only process filtered scenarios');
  });

  it('should ensure viewport labels exist', async function () {
    const configWithUnlabeledViewports = {
      id: 'test-config',
      paths: mockConfigJSON.paths,
      engine: 'playwright',
      scenarios: mockConfigJSON.scenarios,
      viewports: [
        { name: 'phone', width: 320, height: 480 }, // name but no label
        { width: 1024, height: 768 } // neither name nor label
      ]
    };

    const unlabeledConfigFilePath = path.join(fixturesDir, 'mockComparisonConfig_unlabeled.json');
    writeFileSync(unlabeledConfigFilePath, JSON.stringify(configWithUnlabeledViewports));

    try {
      const createComparisonBitmaps = await createModule();
      const unlabeledMockConfig = {
        ...mockConfig,
        configFileName: unlabeledConfigFilePath
      };

      await createComparisonBitmaps(unlabeledMockConfig);

      // The module should have set label = name for the first viewport
      assert((capturedConfig!.viewports as Array<{ label?: string }>)[0].label, 'First viewport should have label');
    } finally {
      try { unlinkSync(unlabeledConfigFilePath); } catch (_e) { /* ignore */ }
    }
  });
});
