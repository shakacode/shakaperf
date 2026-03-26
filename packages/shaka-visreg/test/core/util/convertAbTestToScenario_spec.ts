import assert from 'node:assert';
import { convertAbTestToScenario } from '../../../core/util/convertAbTestToScenario';
import type { AbTestDefinition } from 'shaka-shared';

describe('convertAbTestToScenario', function () {
  const baseDef: AbTestDefinition = {
    name: 'Test scenario',
    startingPath: '/products',
    file: null,
    line: null,
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
    assert.deepStrictEqual(scenario.viewports, [{ label: 'mobile', width: 375, height: 667 }]);
  });

  it('should attach testFn as _testFn on the scenario', function () {
    const testFn = async function () {};
    const def: AbTestDefinition = { ...baseDef, testFn };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario._testFn, testFn);
  });

  it('should attach the full test definition as _testDef', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://control', 'http://experiment');

    assert.strictEqual(scenario._testDef, baseDef);
    assert.strictEqual(scenario._testDef!.name, 'Test scenario');
    assert.strictEqual(scenario._testDef!.startingPath, '/products');
  });

  it('should pass through interaction properties', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          hoverSelector: '.nav-item',
          hoverSelectors: ['.menu-a', '.menu-b'],
          clickSelector: '.btn-submit',
          clickSelectors: ['.tab-1', '.tab-2'],
          scrollToSelector: '#footer',
          postInteractionWait: 500,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.hoverSelector, '.nav-item');
    assert.deepStrictEqual(scenario.hoverSelectors, ['.menu-a', '.menu-b']);
    assert.strictEqual(scenario.clickSelector, '.btn-submit');
    assert.deepStrictEqual(scenario.clickSelectors, ['.tab-1', '.tab-2']);
    assert.strictEqual(scenario.scrollToSelector, '#footer');
    assert.strictEqual(scenario.postInteractionWait, 500);
  });

  it('should pass through comparison threshold properties', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          requireSameDimensions: false,
          compareRetries: 3,
          compareRetryDelay: 2000,
          liveComparePixelmatchThreshold: 0.2,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.requireSameDimensions, false);
    assert.strictEqual(scenario.compareRetries, 3);
    assert.strictEqual(scenario.compareRetryDelay, 2000);
    assert.strictEqual(scenario.liveComparePixelmatchThreshold, 0.2);
  });

  it('should pass through ready state properties', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          readyEvent: 'app:loaded',
          readySelector: '#main-content',
          readyTimeout: 15000,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.readyEvent, 'app:loaded');
    assert.strictEqual(scenario.readySelector, '#main-content');
    assert.strictEqual(scenario.readyTimeout, 15000);
  });

  it('should pass through cookiePath', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          cookiePath: 'cookies/admin.json',
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.cookiePath, 'cookies/admin.json');
  });

  it('should set selectorExpansion when provided', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          selectorExpansion: true,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.selectorExpansion, true);
  });

  it('should set removeSelectors when provided', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          removeSelectors: ['.ad-banner', '.tracking-pixel'],
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.deepStrictEqual(scenario.removeSelectors, ['.ad-banner', '.tracking-pixel']);
  });

  it('should preserve falsy numeric values (0) via != null check', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          misMatchThreshold: 0,
          delay: 0,
          readyTimeout: 0,
          postInteractionWait: 0,
          maxNumDiffPixels: 0,
          compareRetries: 0,
          compareRetryDelay: 0,
          liveComparePixelmatchThreshold: 0,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.misMatchThreshold, 0);
    assert.strictEqual(scenario.delay, 0);
    assert.strictEqual(scenario.readyTimeout, 0);
    assert.strictEqual(scenario.postInteractionWait, 0);
    assert.strictEqual(scenario.maxNumDiffPixels, 0);
    assert.strictEqual(scenario.compareRetries, 0);
    assert.strictEqual(scenario.compareRetryDelay, 0);
    assert.strictEqual(scenario.liveComparePixelmatchThreshold, 0);
  });

  it('should not set optional properties when visreg config is empty', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: { visreg: {} },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    // Only required properties should be set
    assert.strictEqual(scenario.label, 'Test scenario');
    assert.strictEqual(scenario.url, 'http://experiment/products');
    assert.strictEqual(scenario.referenceUrl, 'http://control/products');
    assert.deepStrictEqual(scenario.selectors, ['document']);
    assert.ok(scenario._testFn);

    // Optional properties should not be set
    assert.strictEqual(scenario.hideSelectors, undefined);
    assert.strictEqual(scenario.removeSelectors, undefined);
    assert.strictEqual(scenario.hoverSelector, undefined);
    assert.strictEqual(scenario.clickSelector, undefined);
    assert.strictEqual(scenario.misMatchThreshold, undefined);
    assert.strictEqual(scenario.readyEvent, undefined);
    assert.strictEqual(scenario.cookiePath, undefined);
    assert.strictEqual(scenario.viewports, undefined);
  });

  it('should set requireSameDimensions to false when explicitly false', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      options: {
        visreg: {
          requireSameDimensions: false,
        },
      },
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.requireSameDimensions, false);
  });
});
