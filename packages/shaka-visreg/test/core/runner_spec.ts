import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('the runner', function () {
  let runner: (command: string, args: Record<string, unknown>) => Promise<{ command: string; config: unknown }>;

  beforeAll(async function () {
    jest.resetModules();

    jest.unstable_mockModule('../../core/util/makeConfig.js', () => ({
      default: function (command: string, args: Record<string, unknown>) {
        return { command, args };
      }
    }));
    jest.unstable_mockModule('../../core/command/index.js', () => ({
      default: function (command: string, config: unknown) {
        return Promise.resolve({ command, config });
      }
    }));

    const mod = await import('../../core/runner.js');
    runner = mod.default as unknown as typeof runner;
  });

  it('should call the command/index with the correct config', function () {
    return runner('liveCompare', {}).then(function (args: { command: string; config: unknown }) {
      assert.strictEqual(args.command, 'liveCompare');
      assert.deepStrictEqual(args.config, { command: 'liveCompare', args: {} });
    });
  });
});
