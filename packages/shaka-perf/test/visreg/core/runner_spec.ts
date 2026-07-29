/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';

describe('the runner', function () {
  let runner: (args?: Record<string, unknown>) => Promise<unknown>;
  let calls: string[];
  let capturedConfig: unknown;

  beforeAll(function () {
    jest.resetModules();
    calls = [];

    jest.mock('../../../src/visreg/core/util/makeConfig', () => ({
      __esModule: true,
      default: function (args?: Record<string, unknown>) {
        calls.push('makeConfig');
        return Promise.resolve({ args });
      }
    }));
    jest.mock('../../../src/visreg/core/util/createComparisonBitmaps', () => ({
      __esModule: true,
      default: function (config: unknown) {
        calls.push('createComparisonBitmaps');
        capturedConfig = config;
        return Promise.resolve();
      }
    }));
    jest.mock('../../../src/visreg/core/report', () => ({
      __esModule: true,
      execute: function (config: unknown) {
        calls.push('report');
        return Promise.resolve(config);
      }
    }));

    const mod = require('../../../src/visreg/core/runner');
    runner = mod.default as unknown as typeof runner;
  });

  it('resolves the config, compares, then reports — in that order', function () {
    return runner({ some: 'option' }).then(function (result) {
      assert.deepStrictEqual(calls, ['makeConfig', 'createComparisonBitmaps', 'report']);
      assert.deepStrictEqual(capturedConfig, { args: { some: 'option' } });
      assert.deepStrictEqual(result, { args: { some: 'option' } });
    });
  });
});
