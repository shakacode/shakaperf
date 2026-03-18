import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { copy, ensureDir } from 'fs-extra';
import chalk from 'chalk';
import _ from 'lodash';
import cloneDeep from 'lodash/cloneDeep.js';
import builder from 'junit-report-builder';
import allSettled from '../util/allSettled';
import createLogger from '../util/logger';
import compare from '../util/compare/index';
import type { RuntimeConfig } from '../types';
import type Reporter from '../util/Reporter';
import type { Test } from '../util/Reporter';

const logger = createLogger('report');

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
  function toAbsolute (p: string) {
    return (path.isAbsolute(p)) ? p : path.join(config.projectPath, p);
  }

  const archivePath = toAbsolute(config.archivePath);

  return copy(toAbsolute(config.html_report), archivePath);
}

// Escape </script> occurrences in JS content to prevent premature tag closure when inlined
function safeInlineScript (js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

async function buildInlineHtml (config: RuntimeConfig, jsonpReport: string): Promise<string> {
  const fontsDir = path.join(config.comparePath, 'assets', 'fonts');

  logger.log('Reading assets from: ' + config.comparePath);

  const [bundleJs, diffJs, divergedJs, divergedWorkerJs, latoRegularWoff2, latoBoldWoff2] = await Promise.all([
    readFile(path.join(config.comparePath, 'index_bundle.js'), 'utf8'),
    readFile(path.join(config.comparePath, 'diff.js'), 'utf8'),
    readFile(path.join(config.comparePath, 'diverged.js'), 'utf8'),
    readFile(path.join(config.comparePath, 'divergedWorker.js'), 'utf8'),
    readFile(path.join(fontsDir, 'lato-regular-webfont.woff2')),
    readFile(path.join(fontsDir, 'lato-bold-webfont.woff2')),
  ]);

  // Build combined worker: inline diff.js + diverged.js content, strip importScripts lines
  const workerEventHandler = (divergedWorkerJs as string).split('\n')
    .filter((line: string) => !line.startsWith('importScripts('))
    .join('\n');
  const combinedWorker = `${diffJs as string}\n${divergedJs as string}\n${workerEventHandler}`;

  const latoRegularBase64 = (latoRegularWoff2 as Buffer).toString('base64');
  const latoBoldBase64 = (latoBoldWoff2 as Buffer).toString('base64');

  // Build the HTML directly instead of using template replacement, which is
  // fragile and can silently fail if the template format changes.
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Shaka Vis Reg Report</title>
    <style>
      @font-face {
        font-family: 'latoregular';
        src: url('data:font/woff2;base64,${latoRegularBase64}') format('woff2');
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: 'latobold';
        src: url('data:font/woff2;base64,${latoBoldBase64}') format('woff2');
        font-weight: 700;
        font-style: normal;
      }
      .ReactModal__Body--open { overflow: hidden; }
      .ReactModal__Body--open .header { display: none; }
    </style>
  </head>
  <body style="background-color: #E2E7EA">
    <div id="root"></div>
    <script>function report(r){window.tests=r;}</script>
    <script>${safeInlineScript(jsonpReport)}</script>
    <script>${safeInlineScript(bundleJs as string)}</script>
    <script type="text/plain" id="diverged-worker-script">${safeInlineScript(combinedWorker)}</script>
  </body>
</html>`;
}

async function writeBrowserReport (config: RuntimeConfig, reporter: Reporter) {
  const testConfig = (config.args._loadedVisregConfig as Record<string, unknown>) || {};

  let browserReporter = cloneDeep(reporter);

  function toAbsolute (p: string) {
    return (path.isAbsolute(p)) ? p : path.join(config.projectPath, p);
  }

  logger.log('Writing browser report');

  const reportDir = toAbsolute(config.html_report);

  // Handle log paths if scenarioLogsInReports is enabled
  if (config.scenarioLogsInReports) {
    const logPromises: Promise<unknown>[] = [];
    _.forEach(browserReporter.tests, (test: Test) => {
      const pair = test.pair;
      const referenceLog = toAbsolute(pair.referenceLog!);
      const testLog = toAbsolute(pair.testLog!);

      pair.referenceLog = path.relative(reportDir, referenceLog);
      pair.testLog = path.relative(reportDir, testLog);

      logPromises.push(
        readFile(referenceLog).catch(function (_e: unknown) {
          logger.log(`Ignoring error reading reference log: ${referenceLog}`);
          delete pair.referenceLog;
        }),
        readFile(testLog).catch(function (_e: unknown) {
          logger.log(`Ignoring error reading test log: ${testLog}`);
          delete pair.testLog;
        })
      );
    });
    await Promise.all(logPromises);
  } else {
    _.forEach(browserReporter.tests, (test: Test) => {
      const pair = test.pair;
      delete pair.referenceLog;
      delete pair.testLog;
    });
  }

  // Fix image URLs to be relative to the html_report directory
  _.forEach(browserReporter.tests, (test: Test) => {
    const pair = test.pair;
    pair.reference = path.relative(reportDir, toAbsolute(pair.reference));
    pair.test = path.relative(reportDir, toAbsolute(pair.test));

    if (pair.diffImage) {
      pair.diffImage = path.relative(reportDir, toAbsolute(pair.diffImage));
    }
  });

  const testReportJsonName = toAbsolute(config.bitmaps_test + '/report.json');

  // Merge dynamic test results into existing report if applicable
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

  // Build single self-contained HTML file with all assets inlined
  logger.log('Building self-contained HTML report');
  const inlineHtml = await buildInlineHtml(config, jsonpReport);

  await ensureDir(reportDir);

  const htmlWrite = writeFile(path.join(reportDir, 'index.html'), inlineHtml).then(function () {
    logger.log('Wrote self-contained HTML report to: ' + reportDir);
  }, function (err: unknown) {
    logger.error('Failed writing HTML report to: ' + reportDir);
    throw err;
  });

  const jsonConfigWrite = writeFile(testReportJsonName, jsonReport).then(function () {
    logger.log('Copied json report to: ' + testReportJsonName);
  }, function (err: unknown) {
    logger.error('Failed json report copy to: ' + testReportJsonName);
    throw err;
  });

  await allSettled([htmlWrite, jsonConfigWrite]);

  if (config.archiveReport) {
    archiveReport(config);
  }

  if (config.openReport && config.report && config.report.indexOf('browser') > -1) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executeCommand = require('./index').default;
    return executeCommand('_openReport', config);
  }
  return undefined;
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
  const testConfig = (config.args._loadedVisregConfig as Record<string, unknown>) || {};

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
