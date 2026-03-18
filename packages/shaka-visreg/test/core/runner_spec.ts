import assert from 'node:assert';

describe('the runner', function () {
  let runner: (command: string, args: Record<string, unknown>) => Promise<{ command: string; config: unknown }>;

  beforeAll(function () {
    jest.resetModules();

    jest.mock('../../core/util/makeConfig', () => ({
      __esModule: true,
      default: function (command: string, args: Record<string, unknown>) {
        return { command, args };
      }
    }));
    jest.mock('../../core/command/index', () => ({
      __esModule: true,
      default: function (command: string, config: unknown) {
        return Promise.resolve({ command, config });
      }
    }));

    const mod = require('../../core/runner');
    runner = mod.default as unknown as typeof runner;
  });

  it('should call the command/index with the correct config', function () {
    return runner('liveCompare', {}).then(function (args: { command: string; config: unknown }) {
      assert.strictEqual(args.command, 'liveCompare');
      assert.deepStrictEqual(args.config, { command: 'liveCompare', args: {} });
    });
  });
});
