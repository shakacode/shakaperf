import assert from 'node:assert';

describe('compare command', function () {
  // Dynamically imported mocked modules — types determined at runtime
  let compare: { execute: (config: Record<string, unknown>) => Promise<void> };
  let createComparisonBitmapsStub: jest.Mock;
  let executeCommandStub: jest.Mock;

  async function setupMocks () {
    jest.resetModules();

    createComparisonBitmapsStub = jest.fn().mockResolvedValue(undefined);
    executeCommandStub = jest.fn().mockResolvedValue(undefined);

    jest.mock('../../../../src/visreg/core/util/createComparisonBitmaps', () => ({
      __esModule: true,
      default: createComparisonBitmapsStub
    }));
    jest.mock('../../../../src/visreg/core/command/index', () => ({
      __esModule: true,
      default: executeCommandStub
    }));

    compare = require('../../../../src/visreg/core/command/compare') as unknown as typeof compare;
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

    await compare.execute(config);

    expect(createComparisonBitmapsStub).toHaveBeenCalledTimes(1);
    expect(createComparisonBitmapsStub).toHaveBeenCalledWith(config);
  });

  it('should call _report command after createComparisonBitmaps succeeds', async function () {
    const config = { scenarios: [], viewports: [] };

    await compare.execute(config);

    expect(executeCommandStub).toHaveBeenCalledTimes(1);
    expect(executeCommandStub).toHaveBeenCalledWith('_report', config);
  });

  it('should propagate errors from createComparisonBitmaps', async function () {
    const testError = new Error('Test error from createComparisonBitmaps');
    createComparisonBitmapsStub.mockRejectedValue(testError);

    const config = { scenarios: [], viewports: [] };

    try {
      await compare.execute(config);
      assert.fail('Should have thrown an error');
    } catch (e: unknown) {
      assert(e instanceof Error);
      assert.strictEqual(e.message, 'Test error from createComparisonBitmaps');
    }
  });
});
