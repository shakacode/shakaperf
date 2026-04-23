import path from 'node:path';
import temp from 'temp';
import fs from 'node:fs';
import hash from 'object-hash';
import os from 'node:os';
import { getGitRunId } from './gitRunId';
import type { RuntimeConfig, VisregConfig } from '../types';

// At runtime this file is at dist/visreg/core/util/, package.json is 4 levels up
const packageJson = require('../../../../package.json');
const { version } = packageJson;
const tmpdir = os.tmpdir();

function extendConfig (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const runId = userConfig.dynamicTestId || getGitRunId();
  config._runBaseDir = path.join(config.projectPath!, 'visreg_data', runId);

  ci(config, userConfig);
  htmlReport(config, userConfig);
  screenshotPaths(config);
  jsonReport(config, userConfig);
  tempCompareConfigPath(config);
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

  // compare command options
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
    testSuiteName: 'shaka-perf-visreg'
  };

  if (userConfig.ci) {
    config.ciReport = {
      format: userConfig.ci.format || config.ciReport.format,
      testReportFileName: userConfig.ci.testReportFileName || config.ciReport.testReportFileName,
      testSuiteName: userConfig.ci.testSuiteName || config.ciReport.testSuiteName
    };
  }
}

// `htmlReportDir` is the scratch directory the visreg engine writes
// `report.json` and screenshot PNGs into. The standalone visreg viewer
// (its index.html template, JSONP shim, and reports archive) was removed
// when the unified `shaka-perf compare` report took over display, so this
// is no longer a user-facing report directory — just an intermediate
// staging area the compare harvester reads from.
function htmlReport (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const baseDir = config._runBaseDir!;
  config.htmlReportDir = path.join(baseDir, 'html_report');

  if (userConfig.paths) {
    config.htmlReportDir = userConfig.paths.htmlReport || config.htmlReportDir;
  }
}

function jsonReport (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.jsonReportDir = path.join(config._runBaseDir!, 'json_report');
  if (userConfig.paths) {
    config.jsonReportDir = userConfig.paths.jsonReport || config.jsonReportDir;
  }

  config.compareJsonFileName = path.join(config.jsonReportDir!, 'jsonReport.json');
}

function tempCompareConfigPath (config: Partial<RuntimeConfig>) {
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
