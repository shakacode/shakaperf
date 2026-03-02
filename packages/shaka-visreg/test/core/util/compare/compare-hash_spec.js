import compareHash from '../../../../core/util/compare/compare-hash.js';
import path from 'node:path';
import assert from 'node:assert';

const REF_IMG1 = path.join(import.meta.dirname, 'refImage-1.png');
const REF_IMG1_OPTIMIZED = path.join(import.meta.dirname, 'refImage-1-optimized.png');
const REF_IMG2 = path.join(import.meta.dirname, 'refImage-2.png');

describe('compare-hashes', function () {
  it('should resolve if the same image is compared', function () {
    const expectedResult = {
      isSameDimensions: true,
      dimensionDifference: { width: 0, height: 0 },
      misMatchPercentage: '0.00'
    };

    return compareHash(REF_IMG1, REF_IMG1)
      .then(data => assert.deepStrictEqual(data, expectedResult));
  });
  it('should reject if two images have the same content', function () {
    return expect(compareHash(REF_IMG1, REF_IMG1_OPTIMIZED)).rejects.toBeDefined();
  });
  it('should reject if two images exceed the mismatchThreshold', function () {
    return expect(compareHash(REF_IMG1, REF_IMG2)).rejects.toBeDefined();
  });
});
