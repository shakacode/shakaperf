/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import { convertAbTestToScenario } from '../../../../src/visreg/core/util/convertAbTestToScenario';
import type { AbTestDefinition } from 'shaka-shared';

describe('convertAbTestToScenario', function () {
  const baseDef: AbTestDefinition = {
    name: 'Test scenario',
    startingPath: '/products',
    file: null,
    line: null,
    testTypes: null,
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

  it('should pass through the flat capture config', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      visregSelectors: ['[data-cy="hero"]', 'body'],
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.deepStrictEqual(scenario.selectors, ['[data-cy="hero"]', 'body']);
  });

  it('should route the experiment side through experimentPathOverride', function () {
    const def: AbTestDefinition = {
      ...baseDef,
      experimentPathOverride: '/basket',
    };

    const scenario = convertAbTestToScenario(def, 'http://control', 'http://experiment');

    assert.strictEqual(scenario.url, 'http://experiment/basket');
    assert.strictEqual(scenario.referenceUrl, 'http://control/products');
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

  it('should not set optional properties when the per-test config is minimal', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://control', 'http://experiment');

    // Only required properties should be set
    assert.strictEqual(scenario.label, 'Test scenario');
    assert.strictEqual(scenario.url, 'http://experiment/products');
    assert.strictEqual(scenario.referenceUrl, 'http://control/products');
    assert.deepStrictEqual(scenario.selectors, ['document']);
    assert.ok(scenario._testFn);

    // Deleted per-test options never reach the scenario — interactions and
    // waits live in the test body; thresholds are config-owned.
    assert.deepStrictEqual(
      Object.keys(scenario).sort(),
      ['_testDef', '_testFn', 'label', 'referenceUrl', 'selectors', 'url'],
    );
  });

  it('should use stage unit urls verbatim when provided', function () {
    const scenario = convertAbTestToScenario(baseDef, 'http://control', 'http://experiment', {
      controlURL: 'http://control:1234/products?warm=1',
      experimentURL: 'http://experiment:5678/products?warm=1',
    });

    assert.strictEqual(scenario.url, 'http://experiment:5678/products?warm=1');
    assert.strictEqual(scenario.referenceUrl, 'http://control:1234/products?warm=1');
  });
});
