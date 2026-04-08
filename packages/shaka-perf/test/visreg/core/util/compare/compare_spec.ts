describe('compare', function () {
  // Dynamically imported mocked modules — types determined at runtime
  let compare: (img1: string, img2: string, threshold: number, opts: Record<string, unknown>) => Promise<unknown>;
  let compareHashes: jest.Mock;
  let compareResemble: jest.Mock;
  const error = new Error();

  beforeAll(function () {
    jest.resetModules();

    compareHashes = jest.fn();
    compareResemble = jest.fn();

    jest.mock('../../../../../src/visreg/core/util/compare/compare-hash', () => ({
      __esModule: true,
      default: compareHashes
    }));
    jest.mock('../../../../../src/visreg/core/util/compare/compare-resemble', () => ({
      __esModule: true,
      default: compareResemble
    }));

    const mod = require('../../../../../src/visreg/core/util/compare/compare') as unknown as { default: typeof compare };
    compare = mod.default;
  });

  afterEach(() => {
    compareResemble.mockReset();
    compareHashes.mockReset();
  });

  it.skip('should resolve if compare-hashes succeed', function () {
    compareHashes.mockImplementation((...args: unknown[]) => {
      const [img1, img2] = args as [string, string];
      if (img1 === 'img1.png' && img2 === 'img2.png') return Promise.resolve();
      return Promise.reject(error);
    });
    compareResemble.mockReturnValue(Promise.reject(error));

    return compare('img1.png', 'img2.png', 0, {});
  });

  it.skip('should resolve if compare-hashes fail, but compare-resemble succeeds', function () {
    compareHashes.mockReturnValue(Promise.reject(error));
    compareResemble.mockImplementation((...args: unknown[]) => {
      const [img1, img2] = args as [string, string];
      if (img1 === 'img1.png' && img2 === 'img2.png') return Promise.resolve();
      return Promise.reject(error);
    });

    return compare('img1.png', 'img2.png', 0, {});
  });

  it.skip('should reject if compare-hashes and compare-resemble fail', function () {
    compareHashes.mockReturnValue(Promise.reject(error));
    compareResemble.mockReturnValue(Promise.reject(error));

    return expect(compare('img1.png', 'img2.png', 0, {})).rejects.toBeDefined();
  });
});
