import assert from 'node:assert';
import makeConfig from '../../../core/util/makeConfig.js';

describe('make config', function () {
  it('should pass the filter arg correctly', function () {
    const actualConfig = makeConfig('version', { filter: true });
    assert.strictEqual(actualConfig.args!.filter, true);
  });

  it('should work without an option param', function () {
    const actualConfig = makeConfig('version');
    assert.deepStrictEqual(actualConfig.args!, {});
  });
});
