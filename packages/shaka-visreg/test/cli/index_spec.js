const assert = require('assert');

describe('cli', function () {
  let runnerMock;

  beforeEach(function () {
    jest.resetModules();
  });

  it('should call the runner without custom options correctly', async function () {
    process.argv = ['node', 'backstop', 'test'];
    const promiseMock = Promise.resolve();
    runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.doMock('../../core/runner', () => runnerMock);

    require('../../cli/index');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('test', expect.anything());
  });

  it('should exit with code 1 if runner fails', async function () {
    process.argv = ['node', 'backstop', 'test'];
    const promiseMock = Promise.reject(new Error('errorMock'));
    runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.doMock('../../core/runner', () => runnerMock);

    require('../../cli/index');

    try {
      await promiseMock;
    } catch (e) {
      // expected
    }
    // Give the .catch() handler in cli/index.js time to run
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(process.exitCode, 1);
  });
});
