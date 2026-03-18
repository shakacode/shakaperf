import path from 'node:path';
import map from 'p-map';
import fs from 'node:fs';
import cp from 'node:child_process';
import Reporter, { Test } from './../Reporter';
import createLogger from './../logger';
import storeFailedDiffStub from './store-failed-diff-stub';
import type { RuntimeConfig, TestPair, CompareConfig, ResembleOutputOptions } from '../../types';

const logger = createLogger('compare');

const ASYNC_COMPARE_LIMIT = 20;

function comparePair (pair: TestPair, report: Reporter, config: RuntimeConfig, compareConfig: CompareConfig) {
  const Test = report.addTest(pair);

  const referencePath = pair.reference ? path.resolve(config.projectPath, pair.reference) : '';
  const testPath = pair.test ? path.resolve(config.projectPath, pair.test) : '';

  // ENGINE SCRIPT ERROR
  if (pair.engineErrorMsg) {
    const MSG = `Engine error: ${pair.engineErrorMsg}. See scenario – ${pair.label} (${pair.viewportLabel})`;
    Test.status = 'fail';
    logger.error(MSG);
    pair.error = MSG;
    return Promise.resolve(pair);
  }

  // TEST RUN ERROR/EXCEPTION
  if (!referencePath || !testPath) {
    const MSG = `${pair.msg}: ${pair.error}. See scenario – ${pair.scenario!.label} (${pair.viewport!.label})`;
    Test.status = 'fail';
    logger.error(MSG);
    pair.error = MSG;
    return Promise.resolve(pair);
  }

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

  if (pair.expect) {
    const scenarioCount = compareConfig.testPairs.filter((p: TestPair) => p.label === pair.label && p.viewportLabel === pair.viewportLabel).length;
    if (scenarioCount !== pair.expect) {
      Test.status = 'fail';
      const error = `Expect ${pair.expect} images for scenario "${pair.label} (${pair.viewportLabel})", but actually ${scenarioCount} images be found.`;
      logger.error(error);
      pair.error = error;
      return Promise.resolve(pair);
    }
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

    worker.on('message', function (data: { status: string; diff: { misMatchPercentage: number }; diffImage?: string; requireSameDimensions?: boolean; isSameDimensions?: boolean }) {
      worker.kill();
      testInstance.status = data.status;
      // @ts-expect-error. Not sure why it's failing here. Keeping it as is for now. instead of using data.isSameDimensions
      pair.diff = data.diff;

      if (data.status === 'fail') {
        pair.diffImage = data.diffImage;
        logger.error('ERROR { requireSameDimensions: ' + (data.requireSameDimensions ? 'true' : 'false') + ', size: ' + (data.isSameDimensions ? 'ok' : 'isDifferent') + ', content: ' + data.diff.misMatchPercentage + '%, threshold: ' + pair.misMatchThreshold + '% }: ' + pair.label + ' ' + pair.fileName);
      } else {
        logger.success('OK: ' + pair.label + ' ' + pair.fileName);
      }

      resolve(data);
    });
  });
}

export default function compare (config: RuntimeConfig) {
  const compareConfig = JSON.parse(fs.readFileSync(config.tempCompareConfigFileName, 'utf8')).compareConfig;

  const report = new Reporter(config.ciReport.testSuiteName);
  const asyncCompareLimit = config.asyncCompareLimit || ASYNC_COMPARE_LIMIT;
  report.id = config.id;

  return map(compareConfig.testPairs, (pair: TestPair) => comparePair(pair, report, config, compareConfig), { concurrency: asyncCompareLimit })
    .then(
      () => report,
      (e: unknown) => logger.error('The comparison failed with error: ' + e)
    );
}
