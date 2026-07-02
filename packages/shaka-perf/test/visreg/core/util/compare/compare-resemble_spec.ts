/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import compareResemble from '../../../../../src/visreg/core/util/compare/compare-resemble';
import path from 'node:path';

const REF_IMG1 = path.join(__dirname, 'refImage-1.png');
const REF_IMG1_OPTIMIZED = path.join(__dirname, 'refImage-1-optimized.png');
const REF_IMG2 = path.join(__dirname, 'refImage-2.png');
const REF_IMG3 = path.join(__dirname, 'refImage-3.png');

describe('compare-resemble', function () {
  it('should resolve if the same image is compared', function () {
    return compareResemble(REF_IMG1, REF_IMG1, 0, {});
  });
  it('should resolve if two images have the same content', function () {
    return compareResemble(REF_IMG1, REF_IMG1_OPTIMIZED, 0, {});
  });
  it('should reject if two images exceed the mismatchThreshold', function () {
    return expect(compareResemble(REF_IMG1, REF_IMG2, 0, {})).rejects.toBeDefined();
  });
  it('should use resemble\'s rounded misMatchPercentage value per default', function () {
    return compareResemble(REF_IMG1, REF_IMG3, 0, {});
  });
  it('should use resemble\'s more precise rawMisMatchPercentage value if specified', function () {
    return expect(
      compareResemble(REF_IMG1, REF_IMG3, 0, { usePreciseMatching: true }, true)
    ).rejects.toBeDefined();
  });
});
