import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('the runner', function () {
  let runner: any;

  beforeAll(async function () {
    jest.resetModules();

    jest.unstable_mockModule('../../core/util/makeConfig.js', () => ({
      default: function (command: any, args: any) {
        return { command, args };
      }
    }));
    jest.unstable_mockModule('../../core/command/index.js', () => ({
      default: function (command: any, config: any) {
        return Promise.resolve({ command, config });
      }
    }));

    const mod = await import('../../core/runner.js');
    runner = mod.default;
  });

  it('should call the command/index with the correct config', function () {
    return runner('test', {}).then(function (args: any) {
      assert.strictEqual(args.command, 'test');
      assert.deepStrictEqual(args.config, { command: 'test', args: {} });
    });
  });
});
