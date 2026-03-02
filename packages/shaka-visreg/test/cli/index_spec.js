import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('cli', function () {
  beforeEach(function () {
    jest.resetModules();
  });

  afterEach(function () {
    delete process.exitCode;
  });

  it('should call the runner without custom options correctly', async function () {
    process.argv = ['node', 'backstop', 'test'];
    const promiseMock = Promise.resolve();
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.unstable_mockModule('../../core/runner.js', () => ({
      default: runnerMock
    }));

    await import('../../cli/index.js');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('test', expect.anything());
  });

  it('should exit with code 1 if runner fails', async function () {
    process.argv = ['node', 'backstop', 'test'];
    const promiseMock = Promise.reject(new Error('errorMock'));
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.unstable_mockModule('../../core/runner.js', () => ({
      default: runnerMock
    }));

    await import('../../cli/index.js');

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
