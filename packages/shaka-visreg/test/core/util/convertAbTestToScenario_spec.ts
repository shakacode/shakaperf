import assert from 'node:assert';
import { convertAbTestToScenario } from '../../../core/util/convertAbTestToScenario.js';
import type { AbTestDefinition } from 'shaka-shared';

describe('convertAbTestToScenario', function () {
  const baseDef: AbTestDefinition = {
    name: 'Test scenario',
    startingPath: '/products',
    options: {},
    testFn: async function () {},
  };

  it('should set label, url, and referenceUrl from test definition', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://localhost:3020', 'http://localhost:3030');

    assert.strictEqual(scenario.label, 'Test scenario');
    assert.strictEqual(scenario.url, 'http://localhost:3030/products');
    assert.strictEqual(scenario.referenceUrl, 'http://localhost:3020/products');
  });

  it('should default selectors to ["document"]', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://localhost:3020', 'http://localhost:3030');

    assert.deepStrictEqual(scenario.selectors, ['document']);
  });

  it('should pass through visreg config properties', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          selectors: ['[data-cy="hero"]', 'body'],
          misMatchThreshold: 0.05,
          maxNumDiffPixels: 10,
          delay: 100,
          hideSelectors: ['.cookie-banner'],
          onBeforeScript: 'playwright/onBefore.ts',
          viewports: [{ label: 'mobile', width: 375, height: 667 }],
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.deepStrictEqual(scenario.selectors, ['[data-cy="hero"]', 'body']);
    assert.strictEqual(scenario.misMatchThreshold, 0.05);
    assert.strictEqual(scenario.maxNumDiffPixels, 10);
    assert.strictEqual(scenario.delay, 100);
    assert.deepStrictEqual(scenario.hideSelectors, ['.cookie-banner']);
    assert.strictEqual(scenario.onBeforeScript, 'playwright/onBefore.ts');
    assert.deepStrictEqual(scenario.viewports, [{ label: 'mobile', width: 375, height: 667 }]);
  });

  it('should attach testFn as _testFn on the scenario', function () {
    const testFn = async function () {};
    const def: AbTestDefinition = { ...baseDef, testFn };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario._testFn, testFn);
  });

  it('should not set onReadyScript', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.onReadyScript, undefined);
  });
});
