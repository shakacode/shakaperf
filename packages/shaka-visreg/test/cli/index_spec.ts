import assert from 'node:assert';

describe('cli', function () {
  beforeEach(function () {
    jest.resetModules();
  });

  afterEach(function () {
    delete process.exitCode;
  });

  it('should call the runner with --testFile correctly', async function () {
    process.argv = ['node', 'shaka-visreg', 'liveCompare', '--testFile', './ab-tests/test.abtest.ts'];
    const promiseMock = Promise.resolve();
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.mock('../../core/runner', () => ({
      __esModule: true,
      default: runnerMock
    }));

    require('../../cli/index');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('liveCompare', expect.objectContaining({
      testFile: './ab-tests/test.abtest.ts',
    }));
  });

  it('should call the runner with --testPathPattern correctly', async function () {
    process.argv = ['node', 'shaka-visreg', 'liveCompare', '--testPathPattern', 'homepage'];
    const promiseMock = Promise.resolve();
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.mock('../../core/runner', () => ({
      __esModule: true,
      default: runnerMock
    }));

    require('../../cli/index');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('liveCompare', expect.objectContaining({
      testPathPattern: 'homepage',
    }));
  });

  it('should call the runner without --testFile (auto-discovery)', async function () {
    process.argv = ['node', 'shaka-visreg', 'liveCompare'];
    const promiseMock = Promise.resolve();
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.mock('../../core/runner', () => ({
      __esModule: true,
      default: runnerMock
    }));

    require('../../cli/index');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('liveCompare', expect.objectContaining({
      testFile: undefined,
    }));
  });

  it('should exit with code 1 if runner fails', async function () {
    process.argv = ['node', 'shaka-visreg', 'liveCompare', '--testFile', './ab-tests/test.abtest.ts'];
    const promiseMock = Promise.reject(new Error('errorMock'));
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.mock('../../core/runner', () => ({
      __esModule: true,
      default: runnerMock
    }));

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

  it('should call the runner for init command', async function () {
    process.argv = ['node', 'shaka-visreg', 'init'];
    const promiseMock = Promise.resolve();
    const runnerMock = jest.fn().mockReturnValue(promiseMock);
    jest.mock('../../core/runner', () => ({
      __esModule: true,
      default: runnerMock
    }));

    require('../../cli/index');

    await promiseMock;
    assert.strictEqual(process.exitCode, undefined);
    expect(runnerMock).toHaveBeenCalledWith('init', expect.anything());
  });
});
