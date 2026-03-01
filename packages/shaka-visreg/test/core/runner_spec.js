const assert = require('assert');

describe('the runner', function () {
  let runner;

  beforeAll(function () {
    jest.resetModules();

    jest.doMock('../../core/util/makeConfig', () => function (command, args) {
      return { command, args };
    });
    jest.doMock('../../core/command/', () => function (command, config) {
      return Promise.resolve({ command, config });
    });

    runner = require('../../core/runner');
  });

  it('should call the command/index with the correct config', function () {
    return runner('test', {}).then(function (args) {
      assert.strictEqual(args.command, 'test');
      assert.deepStrictEqual(args.config, { command: 'test', args: {} });
    });
  });
});
