import engineErrors from '../../../core/util/engineErrors.js';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeConfig } from '../../../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('core/util/engineErrors', function () {
  it('should resolve if no engineErrors errors found', function () {
    const config = {
      tempCompareConfigFileName: path.join(__dirname, 'fixtures/engineErrorsSuccess.json')
    };
    return engineErrors(config as RuntimeConfig).then(function (args) {
      assert.strictEqual(args, undefined);
    });
  });

  it('should reject if engineErros found', function () {
    const config = {
      tempCompareConfigFileName: path.join(__dirname, 'fixtures/engineErrorsFail.json')
    };
    return engineErrors(config as RuntimeConfig).catch(function (args) {
      assert.strictEqual(args.engineErrorMsg, 'Engine error fail');
    });
  });
});
