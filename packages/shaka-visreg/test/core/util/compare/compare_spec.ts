import { jest } from '@jest/globals';

describe('compare', function () {
  let compare;
  let compareHashes;
  let compareResemble;
  const error = new Error();

  beforeAll(async function () {
    jest.resetModules();

    compareHashes = jest.fn();
    compareResemble = jest.fn();

    jest.unstable_mockModule('../../../../core/util/compare/compare-hash.js', () => ({
      default: compareHashes
    }));
    jest.unstable_mockModule('../../../../core/util/compare/compare-resemble.js', () => ({
      default: compareResemble
    }));

    compare = (await import('../../../../core/util/compare/compare.js') as any).default;
  });

  afterEach(() => {
    compareResemble.mockReset();
    compareHashes.mockReset();
  });

  it.skip('should resolve if compare-hashes succeed', function () {
    compareHashes.mockImplementation((img1, img2) => {
      if (img1 === 'img1.png' && img2 === 'img2.png') return Promise.resolve();
      return Promise.reject(error);
    });
    compareResemble.mockReturnValue(Promise.reject(error));

    return compare('img1.png', 'img2.png', 0, {});
  });

  it.skip('should resolve if compare-hashes fail, but compare-resemble succeeds', function () {
    compareHashes.mockReturnValue(Promise.reject(error));
    compareResemble.mockImplementation((img1, img2, threshold, opts) => {
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
