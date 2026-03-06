import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('liveCompare command', function () {
  // Dynamically imported mocked modules — types determined at runtime
  let liveCompare: { execute: (config: Record<string, unknown>) => Promise<void> };
  let createComparisonBitmapsStub: jest.Mock<() => Promise<void>>;
  let executeCommandStub: jest.Mock;
  let runDockerStub: jest.Mock;
  let shouldRunDockerStub: jest.Mock;

  async function setupMocks (options: { dockerMode?: boolean } = {}) {
    jest.resetModules();

    createComparisonBitmapsStub = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    shouldRunDockerStub = jest.fn().mockReturnValue(options.dockerMode || false);
    runDockerStub = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    executeCommandStub = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    jest.unstable_mockModule('../../../core/util/createComparisonBitmaps.js', () => ({
      default: createComparisonBitmapsStub
    }));
    jest.unstable_mockModule('../../../core/util/runDocker.js', () => ({
      shouldRunDocker: shouldRunDockerStub,
      runDocker: runDockerStub
    }));
    jest.unstable_mockModule('../../../core/command/index.js', () => ({
      default: executeCommandStub
    }));

    liveCompare = await import('../../../core/command/liveCompare.js') as unknown as typeof liveCompare;
  }

  beforeEach(async function () {
    await setupMocks();
  });

  it('should call createComparisonBitmaps with config', async function () {
    const config = {
      scenarios: [],
      viewports: [],
      compareRetries: 3,
      compareRetryDelay: 5000,
      maxNumDiffPixels: 10
    };

    await liveCompare.execute(config);

    expect(createComparisonBitmapsStub).toHaveBeenCalledTimes(1);
    expect(createComparisonBitmapsStub).toHaveBeenCalledWith(config);
  });

  it('should call _report command after createComparisonBitmaps succeeds', async function () {
    const config = { scenarios: [], viewports: [] };

    await liveCompare.execute(config);

    expect(executeCommandStub).toHaveBeenCalledTimes(1);
    expect(executeCommandStub).toHaveBeenCalledWith('_report', config);
  });

  it('should run docker when docker mode is enabled', async function () {
    await setupMocks({ dockerMode: true });

    const config = {
      args: { docker: true },
      openReport: false
    };

    await liveCompare.execute(config);

    expect(runDockerStub).toHaveBeenCalledTimes(1);
    expect(runDockerStub).toHaveBeenCalledWith(config, 'liveCompare');
    expect(createComparisonBitmapsStub).not.toHaveBeenCalled();
  });

  it('should open report after docker when openReport is enabled', async function () {
    await setupMocks({ dockerMode: true });

    const config = {
      args: { docker: true },
      openReport: true,
      report: ['browser']
    };

    await liveCompare.execute(config);

    expect(executeCommandStub).toHaveBeenCalledWith('_openReport', config);
  });

  it('should propagate errors from createComparisonBitmaps', async function () {
    const testError = new Error('Test error from createComparisonBitmaps');
    createComparisonBitmapsStub.mockRejectedValue(testError);

    const config = { scenarios: [], viewports: [] };

    try {
      await liveCompare.execute(config);
      assert.fail('Should have thrown an error');
    } catch (e: unknown) {
      assert(e instanceof Error);
      assert.strictEqual(e.message, 'Test error from createComparisonBitmaps');
    }
  });
});
