// @ts-expect-error no type declarations
import resemble from '@mirzazeyrek/node-resemble-js';
import type { ResembleOutputOptions } from '../../types.js';

export default function compareResemble (referencePath: string, testPath: string, misMatchThreshold: number, resembleOutputSettings: ResembleOutputOptions, requireSameDimensions?: boolean) {
  return new Promise(function (resolve, reject) {
    const resembleSettings = resembleOutputSettings || {};
    resemble.outputSettings(resembleSettings);
    const comparison = resemble(referencePath).compareTo(testPath);

    if (resembleSettings.ignoreAntialiasing) {
      comparison.ignoreAntialiasing();
    }

    comparison.onComplete((data: any) => {
      const misMatchPercentage = resembleSettings.usePreciseMatching ? data.rawMisMatchPercentage : data.misMatchPercentage;
      if ((requireSameDimensions === false || data.isSameDimensions === true) && misMatchPercentage <= misMatchThreshold) {
        return resolve(data);
      }
      reject(data);
    });
  });
}
