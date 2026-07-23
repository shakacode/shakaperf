/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import map from 'p-map';
import fs from 'node:fs';
import cp from 'node:child_process';
import Reporter, { Test } from './../Reporter';
import createLogger from './../logger';
import storeFailedDiffStub from './store-failed-diff-stub';
import type { RuntimeConfig, TestPair, ResembleOutputOptions, CompareConfig } from '../../types';

const logger = createLogger('compare');

const ASYNC_COMPARE_LIMIT = 20;

function comparePair (pair: TestPair, report: Reporter, config: RuntimeConfig) {
  const Test = report.addTest(pair);

  const referencePath = pair.reference ? path.resolve(config.projectPath, pair.reference) : '';
  const testPath = pair.test ? path.resolve(config.projectPath, pair.test) : '';

  // REFERENCE NOT FOUND ERROR
  if (!fs.existsSync(referencePath)) {
    // save a failed image stub
    storeFailedDiffStub(testPath);

    Test.status = 'fail';
    logger.error('Reference image not found ' + pair.fileName);
    pair.error = 'Reference file not found ' + referencePath;
    return Promise.resolve(pair);
  }

  if (!fs.existsSync(testPath)) {
    Test.status = 'fail';
    logger.error('Test image not found ' + pair.fileName);
    pair.error = 'Test file not found ' + testPath;
    return Promise.resolve(pair);
  }

  const resembleOutputSettings = config.resembleOutputOptions;
  return compareImages(referencePath, testPath, pair, resembleOutputSettings, Test);
}

function compareImages (referencePath: string, testPath: string, pair: TestPair, resembleOutputSettings: ResembleOutputOptions | undefined, testInstance: Test) {
  return new Promise(function (resolve, _reject) {
    const worker = cp.fork(path.join(__dirname, 'compare.js'));
    worker.send({
      referencePath,
      testPath,
      resembleOutputSettings,
      pair
    });

    worker.on('message', function (data: { status: string; diff: { misMatchPercentage: number }; diffImage?: string; isSameDimensions?: boolean }) {
      worker.kill();
      testInstance.status = data.status;
      // @ts-expect-error. Not sure why it's failing here. Keeping it as is for now. instead of using data.isSameDimensions
      pair.diff = data.diff;

      if (data.status === 'fail') {
        pair.diffImage = data.diffImage;
        logger.error('ERROR { size: ' + (data.isSameDimensions ? 'ok' : 'isDifferent') + ', content: ' + data.diff.misMatchPercentage + '%, threshold: ' + pair.mismatchThreshold + '% }: ' + pair.label + ' ' + pair.fileName);
      } else {
        logger.success('OK: ' + pair.label + ' ' + pair.fileName);
      }

      resolve(data);
    });
  });
}

export default function compare (config: RuntimeConfig) {
  const compareConfig = JSON.parse(fs.readFileSync(config.tempCompareConfigFileName, 'utf8')).compareConfig as CompareConfig;

  const report = new Reporter('shaka-perf-visreg');
  const asyncCompareLimit = config.asyncCompareLimit || ASYNC_COMPARE_LIMIT;

  return map(compareConfig.testPairs, (pair: TestPair) => comparePair(pair, report, config), { concurrency: asyncCompareLimit })
    .then(
      () => report,
      (e: unknown) => logger.error('The comparison failed with error: ' + e)
    );
}
