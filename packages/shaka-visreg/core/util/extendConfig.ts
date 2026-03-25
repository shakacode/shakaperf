import path from 'node:path';
import temp from 'temp';
import fs from 'node:fs';
import hash from 'object-hash';
import os from 'node:os';
import { getGitRunId } from './gitRunId';
import type { RuntimeConfig, VisregConfig } from '../types';

const packageJson = require('../../package.json');
const { version } = packageJson;
const tmpdir = os.tmpdir();

function extendConfig (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const runId = userConfig.dynamicTestId || getGitRunId();
  config._runBaseDir = path.join(config.projectPath!, 'visreg_data', runId);

  ci(config, userConfig);
  htmlReport(config, userConfig);
  screenshotPaths(config);
  jsonReport(config, userConfig);
  comparePaths(config);
  captureConfigPaths(config);

  config.id = userConfig.id;
  config.engine = userConfig.engine || null;
  config.report = userConfig.report || ['browser'];
  config.defaultMisMatchThreshold = 0.1;
  config.debug = userConfig.debug || false;
  config.resembleOutputOptions = userConfig.resembleOutputOptions;
  config.asyncCompareLimit = userConfig.asyncCompareLimit;
  config.visregVersion = version;
  config.scenarioLogsInReports = userConfig.scenarioLogsInReports;

  // liveCompare command options
  config.compareRetries = userConfig.compareRetries ?? 0;
  config.compareRetryDelay = userConfig.compareRetryDelay ?? 5000;
  config.maxNumDiffPixels = userConfig.maxNumDiffPixels ?? 0;

  return config;
}

function screenshotPaths (config: Partial<RuntimeConfig>) {
  config.controlScreenshotDir = path.join(config.htmlReportDir!, 'control_screenshot');
  config.experimentScreenshotDir = path.join(config.htmlReportDir!, 'experiment_screenshot');
}

function ci (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.ciReportDir = path.join(config._runBaseDir!, 'ci_report');
  if (userConfig.paths) {
    config.ciReportDir = userConfig.paths.ciReport || config.ciReportDir;
  }
  config.ciReport = {
    format: 'junit',
    testReportFileName: 'xunit',
    testSuiteName: 'shaka-visreg'
  };

  if (userConfig.ci) {
    config.ciReport = {
      format: userConfig.ci.format || config.ciReport.format,
      testReportFileName: userConfig.ci.testReportFileName || config.ciReport.testReportFileName,
      testSuiteName: userConfig.ci.testSuiteName || config.ciReport.testSuiteName
    };
  }
}

function htmlReport (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const baseDir = config._runBaseDir!;
  config.htmlReportDir = path.join(baseDir, 'html_report');
  config.openReport = userConfig.openReport === undefined ? true : userConfig.openReport;
  config.archivePath = path.join(baseDir, 'reports');
  config.archiveReport = userConfig.archiveReport === undefined ? false : userConfig.archiveReport;

  if (userConfig.paths) {
    config.htmlReportDir = userConfig.paths.htmlReport || config.htmlReportDir;
    config.archivePath = userConfig.paths.reportsArchive || config.archivePath;
  }

  config.compareConfigFileName = path.join(config.htmlReportDir!, 'config.js');
  config.compareReportURL = path.join(config.htmlReportDir!, 'index.html');
}

function jsonReport (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.jsonReportDir = path.join(config._runBaseDir!, 'json_report');
  if (userConfig.paths) {
    config.jsonReportDir = userConfig.paths.jsonReport || config.jsonReportDir;
  }

  config.compareJsonFileName = path.join(config.jsonReportDir!, 'jsonReport.json');
}

function comparePaths (config: Partial<RuntimeConfig>) {
  config.comparePath = path.join(config.visregRoot!, 'compare/output');
  config.tempCompareConfigFileName = temp.path({ suffix: '.json' });
}

function captureConfigPaths (config: Partial<RuntimeConfig>) {
  const captureDir = path.join(tmpdir, 'capture');
  if (!fs.existsSync(captureDir)) {
    fs.mkdirSync(captureDir);
  }
  const configHash = hash(config);
  config.captureConfigFileName = path.join(tmpdir, 'capture', configHash + '.json');
  config.captureConfigFileNameDefault = path.join(config.visregRoot!, 'capture', 'config.default.ts');
}

export default extendConfig;
