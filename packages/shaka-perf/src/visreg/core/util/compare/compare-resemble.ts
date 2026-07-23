/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// @ts-expect-error no type declarations
import resemble from '@mirzazeyrek/node-resemble-js';
import type { ResembleOutputOptions } from '../../types';

export default function compareResemble (referencePath: string, testPath: string, mismatchThreshold: number, resembleOutputSettings: ResembleOutputOptions) {
  return new Promise(function (resolve, reject) {
    const resembleSettings = resembleOutputSettings || {};
    resemble.outputSettings(resembleSettings);
    const comparison = resemble(referencePath).compareTo(testPath);

    if (resembleSettings.ignoreAntialiasing) {
      comparison.ignoreAntialiasing();
    }

    comparison.onComplete((data: { rawMisMatchPercentage: number; misMatchPercentage: number; isSameDimensions: boolean }) => {
      const misMatchPercentage = resembleSettings.usePreciseMatching ? data.rawMisMatchPercentage : data.misMatchPercentage;
      // A dimension change always fails: a resize IS a visual difference.
      if (data.isSameDimensions === true && misMatchPercentage <= mismatchThreshold) {
        return resolve(data);
      }
      reject(data);
    });
  });
}
