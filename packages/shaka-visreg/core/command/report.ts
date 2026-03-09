import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { copy, ensureDir } from 'fs-extra';
import chalk from 'chalk';
import _ from 'lodash';
import cloneDeep from 'lodash/cloneDeep.js';
import { createRequire } from 'node:module';
import builder from 'junit-report-builder';
import allSettled from '../util/allSettled.js';
import createLogger from '../util/logger.js';
import compare from '../util/compare/index.js';
import type { RuntimeConfig } from '../types.js';
import type Reporter from '../util/Reporter.js';
import type { Test } from '../util/Reporter.js';

const logger = createLogger('report');
const _require = createRequire(import.meta.url);

async function replaceInFile (file: string, search: string | RegExp, replace: string) {
  const data = await readFile(file, 'utf8');
  const result = data.replace(search, replace);
  await writeFile(file, result, 'utf8');
}

function writeReport (config: RuntimeConfig, reporter: Reporter) {
  const promises = [];

  if (config.report && config.report.indexOf('CI') > -1 && config.ciReport.format === 'junit') {
    promises.push(writeJunitReport(config, reporter));
  }

  if (config.report && config.report.indexOf('json') > -1) {
    promises.push(writeJsonReport(config, reporter));
  }

  promises.push(writeBrowserReport(config, reporter));

  return allSettled(promises);
}

function archiveReport (config: RuntimeConfig) {
  let archivePath = path.join(config.archivePath, config.screenshotDateTime!);

  function toAbsolute (p: string) {
    return (path.isAbsolute(p)) ? p : path.join(config.projectPath, p);
  }

  archivePath = toAbsolute(archivePath);

  return copy(toAbsolute(config.html_report), archivePath).then(function () {
    const file = path.join(archivePath, path.basename(config.compareConfigFileName));
    // replace the "..\\" with "..\\..\\" in the config.js files
    // on windows double escape in order to work properly
    const search = path.sep.replace(/\\/g, '\\\\\\\\');
    const replace = path.sep.replace(/\\/g, '\\\\');
    return replaceInFile(file, new RegExp(`"..${search}`, 'g'), `"..${replace}..${replace}`);
  });
}

async function writeBrowserReport (config: RuntimeConfig, reporter: Reporter) {
  const testConfig = (typeof config.args.config === 'object')
    ? config.args.config
    : Object.assign({}, _require(config.configFileName));

  let browserReporter = cloneDeep(reporter);

  function toAbsolute (p: string) {
    return (path.isAbsolute(p)) ? p : path.join(config.projectPath, p);
  }

  logger.log('Writing browser report');

  return copy(config.comparePath, toAbsolute(config.html_report)).then(function () {
    // Slurp in logs
    const promises: Promise<unknown>[] = [];
    if (config.scenarioLogsInReports) {
      _.forEach(browserReporter.tests, (test: Test) => {
        const pair = test.pair;
        const referenceLog = toAbsolute(pair.referenceLog!);
        const testLog = toAbsolute(pair.testLog!);

        const report = toAbsolute(config.html_report);
        pair.referenceLog = path.relative(report, referenceLog);
        pair.testLog = path.relative(report, testLog);

        const referencePromise = readFile(referenceLog).catch(function (_e: unknown) {
          logger.log(`Ignoring error reading reference log: ${referenceLog}`);
          delete pair.referenceLog;
          // remove non-existing log paths
        });
        const testPromise = readFile(testLog).catch(function (_e: unknown) {
          logger.log(`Ignoring error reading test log: ${testLog}`);
          delete pair.testLog;
          // remove non-existing log paths
        });
        promises.push(referencePromise, testPromise);
      });
      return Promise.all(promises);
    } else {
      // don't pass log paths to client
      _.forEach(browserReporter.tests, (test: Test) => {
        const pair = test.pair;
        delete pair.referenceLog;
        delete pair.testLog;
      });
      return Promise.resolve([] as void[]);
    }
  }).then(function () {
    logger.log('Resources copied');

    // Fixing URLs in the configuration
    _.forEach(browserReporter.tests, (test: Test) => {
      const report = toAbsolute(config.html_report);
      const pair = test.pair;
      pair.reference = path.relative(report, toAbsolute(pair.reference));
      pair.test = path.relative(report, toAbsolute(pair.test));

      if (pair.diffImage) {
        pair.diffImage = path.relative(report, toAbsolute(pair.diffImage));
      }
    });

    const reportConfigFilename = toAbsolute(config.compareConfigFileName);
    const testReportJsonName = toAbsolute(config.bitmaps_test + '/' + config.screenshotDateTime + '/report.json');

    // If this is a dynamic test then we assume browserReporter has one scenario with one or more viewport variants.
    // This scenario with all viewport variants will be appended to any existing report.
    if (testConfig.dynamicTestId) {
      try {
        console.log('Attempting to open: ', testReportJsonName);
        const testReportJson = JSON.parse(readFileSync(testReportJsonName, 'utf8'));
        const scenarioFileNames = browserReporter.tests.map((test: Test) => test.pair.fileName);
        testReportJson.tests = testReportJson.tests.filter((test: Test) => !scenarioFileNames.includes(test.pair.fileName));
        browserReporter.tests.map((test: Test) => testReportJson.tests.push(test));
        browserReporter = testReportJson;
      } catch (err) {
        console.log('Creating new report.');
      }
    }

    const jsonReport = JSON.stringify(browserReporter, null, 2);
    const jsonpReport = `report(${jsonReport});`;

    const jsonConfigWrite = writeFile(testReportJsonName, jsonReport).then(function () {
      logger.log('Copied json report to: ' + testReportJsonName);
    }, function (err: unknown) {
      logger.error('Failed json report copy to: ' + testReportJsonName);
      throw err;
    });

    const jsonpConfigWrite = writeFile(toAbsolute(reportConfigFilename), jsonpReport).then(function () {
      logger.log('Copied jsonp report to: ' + reportConfigFilename);
    }, function (err: unknown) {
      logger.error('Failed jsonp report copy to: ' + reportConfigFilename);
      throw err;
    });

    const promises = [jsonpConfigWrite, jsonConfigWrite];

    return allSettled(promises);
  }).then(async function () {
    if (config.archiveReport) {
      archiveReport(config);
    }

    if (config.openReport && config.report && config.report.indexOf('browser') > -1) {
      const { default: executeCommand } = await import('./index.js');
      return executeCommand('_openReport', config);
    }
    return undefined;
  });
}

function writeJunitReport (config: RuntimeConfig, reporter: Reporter) {
  logger.log('Writing jUnit Report');

  const suite = builder.testSuite()
    .name(reporter.testSuite);

  _.forEach(reporter.tests, (test: Test) => {
    const testCase = suite.testCase()
      .className(test.pair.selector)
      .name(' ›› ' + test.pair.label);

    if (!test.passed()) {
      const error = 'Design deviation ›› ' + test.pair.label + ' (' + test.pair.selector + ') component';
      testCase.failure(error);
      testCase.error(error);
    }
  });

  return new Promise(function (resolve, reject) {
    let testReportFilename = config.testReportFileName || config.ciReport.testReportFileName;
    testReportFilename = testReportFilename.replace(/\.xml$/, '') + '.xml';
    const destination = path.join(config.ci_report, testReportFilename);

    try {
      builder.writeTo(destination);
      logger.success('jUnit report written to: ' + destination);

      resolve(undefined);
    } catch (e) {
      return reject(e);
    }
  });
}

function writeJsonReport (config: RuntimeConfig, reporter: Reporter) {
  const testConfig = (typeof config.args.config === 'object')
    ? config.args.config
    : Object.assign({}, _require(config.configFileName));

  let jsonReporter = cloneDeep(reporter);

  function toAbsolute (p: string) {
    return (path.isAbsolute(p)) ? p : path.join(config.projectPath, p);
  }

  logger.log('Writing json report');
  return ensureDir(toAbsolute(config.json_report)).then(function () {
    logger.log('Resources copied');

    // Fixing URLs in the configuration
    const report = toAbsolute(config.json_report);
    _.forEach(jsonReporter.tests, (test: Test) => {
      const pair = test.pair;
      pair.reference = path.relative(report, toAbsolute(pair.reference));
      pair.test = path.relative(report, toAbsolute(pair.test));
      pair.referenceLog = path.relative(report, toAbsolute(pair.referenceLog!));
      pair.testLog = path.relative(report, toAbsolute(pair.testLog!));

      if (pair.diffImage) {
        pair.diffImage = path.relative(report, toAbsolute(pair.diffImage));
      }
    });

    const jsonReportFileName = toAbsolute(config.compareJsonFileName);

    // If this is a dynamic test then we assume jsonReporter has one scenario with one or more viewport variants.
    // This scenario with all viewport variants will be appended to any existing report.
    if (testConfig.dynamicTestId) {
      try {
        console.log('Attempting to open: ', jsonReportFileName);
        const jsonReportJson = JSON.parse(readFileSync(jsonReportFileName, 'utf8'));
        const scenarioFileNames = jsonReporter.tests.map((test: Test) => test.pair.fileName);
        jsonReportJson.tests = jsonReportJson.tests.filter((test: Test) => !scenarioFileNames.includes(test.pair.fileName));
        jsonReporter.tests.map((test: Test) => jsonReportJson.tests.push(test));
        jsonReporter = jsonReportJson;
      } catch (err) {
        console.log('Creating new report.');
      }
    }

    return writeFile(jsonReportFileName, JSON.stringify(jsonReporter, null, 2)).then(function () {
      logger.log('Wrote Json report to: ' + jsonReportFileName);
    }, function (err: unknown) {
      logger.error('Failed writing Json report to: ' + jsonReportFileName);
      throw err;
    });
  });
}

export async function execute (config: RuntimeConfig) {
  const compareResult = await compare(config);
  if (!compareResult) {
    logger.error('Comparison failed, no report generated.');
    return;
  }
  const report = compareResult as Reporter;

  const failed = report.failed();
  logger.log('Test completed...');
  logger.log(chalk.green(report.passed() + ' Passed'));
  logger.log(chalk[(failed ? 'red' : 'green') as 'red' | 'green'](+failed + ' Failed'));

  const results = await writeReport(config, report);
  for (let i = 0; i < results.length; i++) {
    if (results[i].state !== 'fulfilled') {
      logger.error('Failed writing report with error: ' + (results[i] as { state: string; reason?: unknown }).reason);
    }
  }

  if (failed) {
    logger.error('*** Mismatch errors found ***');
    throw new Error('Mismatch errors found.');
  }
}
