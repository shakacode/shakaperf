import assert from 'node:assert';
import makeConfig from '../../../core/util/makeConfig.js';

describe('make config', function () {
  it('should pass the filter arg correctly', function () {
    const actualConfig = makeConfig('init', { filter: true });
    assert.strictEqual(actualConfig.args!.filter, true);
  });

  it('should work without an option param', function () {
    const actualConfig = makeConfig('init');
    assert.deepStrictEqual(actualConfig.args!, {});
  });

  it('should skip loading config file when testFile is provided', function () {
    const actualConfig = makeConfig('liveCompare', {
      testFile: './ab-tests/shop-now.bench.ts',
      config: 'visreg.config.ts',
    });
    // Should not throw even though visreg.config.ts doesn't exist on disk
    assert.strictEqual(actualConfig.args!.testFile, './ab-tests/shop-now.bench.ts');
  });
});
