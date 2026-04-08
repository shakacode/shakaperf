import assert from 'node:assert';

describe('the runner', function () {
  let runner: (command: string, args: Record<string, unknown>) => Promise<{ command: string; config: unknown }>;

  beforeAll(function () {
    jest.resetModules();

    jest.mock('../../../src/visreg/core/util/makeConfig', () => ({
      __esModule: true,
      default: function (command: string, args: Record<string, unknown>) {
        return { command, args };
      }
    }));
    jest.mock('../../../src/visreg/core/command/index', () => ({
      __esModule: true,
      default: function (command: string, config: unknown) {
        return Promise.resolve({ command, config });
      }
    }));

    const mod = require('../../../src/visreg/core/runner');
    runner = mod.default as unknown as typeof runner;
  });

  it('should call the command/index with the correct config', function () {
    return runner('compare', {}).then(function (args: { command: string; config: unknown }) {
      assert.strictEqual(args.command, 'compare');
      assert.deepStrictEqual(args.config, { command: 'compare', args: {} });
    });
  });
});
