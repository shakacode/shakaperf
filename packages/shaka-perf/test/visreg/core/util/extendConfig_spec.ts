/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import path from 'node:path';
import extendConfig from '../../../../src/visreg/core/util/extendConfig';

describe('computeConfig_spec', function () {
  const baseConfig = { projectPath: process.cwd(), visregRoot: process.cwd() };
  // `paths.artifacts` is required: the compare stage always pins the dir this
  // invocation writes into, and the engine refuses to guess one.
  const ARTIFACTS = '/tmp/shaka-unit/artifacts';
  const userConfig = (extra: Record<string, unknown> = {}) => ({ paths: { artifacts: ARTIFACTS }, ...extra });

  it('should override engine from config file', function () {
    const actualConfig = extendConfig({ ...baseConfig }, userConfig({ engine: 'playwright' }));
    assert.strictEqual(actualConfig.engine, 'playwright');
  });

  it('should override resembleOutputOptions from config file', function () {
    const actualConfig = extendConfig({ ...baseConfig }, userConfig({ resembleOutputOptions: { transparency: 0.3 } }));
    assert.strictEqual(actualConfig.resembleOutputOptions!.transparency, 0.3);
  });

  describe('compare config options', function () {
    it('should set default compareRetries to 0', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig());
      assert.strictEqual(actualConfig.compareRetries, 0);
    });

    it('should override compareRetries from user config', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig({ compareRetries: 5 }));
      assert.strictEqual(actualConfig.compareRetries, 5);
    });

    it('should set default compareRetryDelay to 5000', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig());
      assert.strictEqual(actualConfig.compareRetryDelay, 5000);
    });

    it('should override compareRetryDelay from user config', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig({ compareRetryDelay: 10000 }));
      assert.strictEqual(actualConfig.compareRetryDelay, 10000);
    });

    it('should set default maxNumDiffPixels to 0', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig());
      assert.strictEqual(actualConfig.maxNumDiffPixels, 0);
    });

    it('should override maxNumDiffPixels from user config', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig({ maxNumDiffPixels: 100 }));
      assert.strictEqual(actualConfig.maxNumDiffPixels, 100);
    });

    it('should pass all compare options together', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig({
        compareRetries: 3,
        compareRetryDelay: 7500,
        maxNumDiffPixels: 50
      }));
      assert.strictEqual(actualConfig.compareRetries, 3);
      assert.strictEqual(actualConfig.compareRetryDelay, 7500);
      assert.strictEqual(actualConfig.maxNumDiffPixels, 50);
    });
  });

  describe('artifact paths', function () {
    it('derives every output dir from the single pinned artifacts dir', function () {
      const actualConfig = extendConfig({ ...baseConfig }, userConfig());

      assert.strictEqual(actualConfig.unitArtifactsDir, ARTIFACTS);
      assert.strictEqual(actualConfig.controlScreenshotDir, path.join(ARTIFACTS, 'control_screenshots'));
      assert.strictEqual(actualConfig.experimentScreenshotDir, path.join(ARTIFACTS, 'experiment_screenshots'));
    });

    it('refuses to guess where to write when the caller pinned nothing', function () {
      // Defaulting here would scatter the unit's output somewhere the caller
      // isn't reading, surfacing as "visreg did not produce artifacts".
      assert.throws(
        () => extendConfig({ ...baseConfig }, {}),
        /no paths.artifacts provided/,
      );
    });
  });
});
