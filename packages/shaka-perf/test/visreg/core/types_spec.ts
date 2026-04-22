import assert from 'node:assert';
import { defineVisregConfig, VISREG_DEFAULT_CONFIG } from '../../../src/visreg/core/types';
import type { VisregGlobalConfig } from '../../../src/visreg/core/types';

describe('defineVisregConfig', function () {
  it('should return the config object unchanged', function () {
    const config: VisregGlobalConfig = {
      viewports: [
        { label: 'phone', width: 375, height: 667 },
      ],
    };

    const result = defineVisregConfig(config);
    assert.strictEqual(result, config);
  });

  it('should preserve all config properties', function () {
    const config: VisregGlobalConfig = {
      viewports: [
        { label: 'desktop', width: 1280, height: 800 },
      ],
      defaultMisMatchThreshold: 0.05,
      compareRetries: 3,
      compareRetryDelay: 2000,
      maxNumDiffPixels: 100,
      engineOptions: {
        browser: 'chromium',
        args: ['--no-sandbox', '--disable-gpu'],
      },
      paths: {
        htmlReport: 'custom/html_report',
      },
      report: ['browser'],
      asyncCaptureLimit: 3,
      debug: true,
    };

    const result = defineVisregConfig(config);
    assert.strictEqual(result.defaultMisMatchThreshold, 0.05);
    assert.strictEqual(result.compareRetries, 3);
    assert.strictEqual(result.maxNumDiffPixels, 100);
    assert.deepStrictEqual(result.engineOptions!.args, ['--no-sandbox', '--disable-gpu']);
    assert.strictEqual(result.paths!.htmlReport, 'custom/html_report');
    assert.strictEqual(result.debug, true);
  });
});

describe('VISREG_DEFAULT_CONFIG', function () {
  it('should have three default viewports', function () {
    assert.strictEqual(VISREG_DEFAULT_CONFIG.viewports!.length, 3);
  });

  it('should include phone, tablet, and desktop viewports', function () {
    const labels = VISREG_DEFAULT_CONFIG.viewports!.map(function (v) { return v.label; });
    assert.deepStrictEqual(labels, ['phone', 'tablet', 'desktop']);
  });

  it('should have correct phone viewport dimensions', function () {
    const phone = VISREG_DEFAULT_CONFIG.viewports![0];
    assert.strictEqual(phone.width, 375);
    assert.strictEqual(phone.height, 667);
  });

  it('should have correct tablet viewport dimensions', function () {
    const tablet = VISREG_DEFAULT_CONFIG.viewports![1];
    assert.strictEqual(tablet.width, 768);
    assert.strictEqual(tablet.height, 1024);
  });

  it('should have correct desktop viewport dimensions', function () {
    const desktop = VISREG_DEFAULT_CONFIG.viewports![2];
    assert.strictEqual(desktop.width, 1280);
    assert.strictEqual(desktop.height, 800);
  });

  it('should set default paths', function () {
    assert.strictEqual(VISREG_DEFAULT_CONFIG.paths!.htmlReport, 'visreg_data/html_report');
    assert.strictEqual(VISREG_DEFAULT_CONFIG.paths!.ciReport, 'visreg_data/ci_report');
  });

  it('should set default engine options', function () {
    assert.strictEqual(VISREG_DEFAULT_CONFIG.engineOptions!.browser, 'chromium');
    assert.deepStrictEqual(VISREG_DEFAULT_CONFIG.engineOptions!.args, ['--no-sandbox']);
  });

  it('should set default comparison options', function () {
    assert.strictEqual(VISREG_DEFAULT_CONFIG.asyncCaptureLimit, 5);
    assert.strictEqual(VISREG_DEFAULT_CONFIG.compareRetries, 5);
    assert.strictEqual(VISREG_DEFAULT_CONFIG.compareRetryDelay, 1000);
    assert.strictEqual(VISREG_DEFAULT_CONFIG.maxNumDiffPixels, 50);
    assert.strictEqual(VISREG_DEFAULT_CONFIG.defaultMisMatchThreshold, 0.1);
  });

  it('should set default report options', function () {
    assert.deepStrictEqual(VISREG_DEFAULT_CONFIG.report, ['browser', 'CI']);
  });
});
