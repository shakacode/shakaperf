import path from 'node:path';
import temp from 'temp';
import fs from 'node:fs';
import hash from 'object-hash';
import os from 'node:os';
import { createRequire } from 'node:module';
import { getGitRunId } from './gitRunId.js';
import type { RuntimeConfig, VisregConfig } from '../types.js';

const _require = createRequire(import.meta.url);
const packageJson = _require('../../package.json');
const { version } = packageJson;
const tmpdir = os.tmpdir();

function extendConfig (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const runId = userConfig.dynamicTestId || getGitRunId();
  config._runBaseDir = path.join(config.projectPath!, 'visreg_data', runId);

  bitmapPaths(config, userConfig);
  ci(config, userConfig);
  htmlReport(config, userConfig);
  jsonReport(config, userConfig);
  comparePaths(config);
  captureConfigPaths(config);
  engine(config, userConfig);

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

function bitmapPaths (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  const baseDir = config._runBaseDir!;
  config.bitmaps_reference = path.join(baseDir, 'bitmaps_reference');
  config.bitmaps_test = path.join(baseDir, 'bitmaps_test');
  if (userConfig.paths) {
    config.bitmaps_reference = userConfig.paths.bitmaps_reference || config.bitmaps_reference;
    config.bitmaps_test = userConfig.paths.bitmaps_test || config.bitmaps_test;
  }
}

function ci (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.ci_report = path.join(config._runBaseDir!, 'ci_report');
  if (userConfig.paths) {
    config.ci_report = userConfig.paths.ci_report || config.ci_report;
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
  config.html_report = path.join(baseDir, 'html_report');
  config.openReport = userConfig.openReport === undefined ? true : userConfig.openReport;
  config.archivePath = path.join(baseDir, 'reports');
  config.archiveReport = userConfig.archiveReport === undefined ? false : userConfig.archiveReport;

  if (userConfig.paths) {
    config.html_report = userConfig.paths.html_report || config.html_report;
    config.archivePath = userConfig.paths.reports_archive || config.archivePath;
  }

  config.compareConfigFileName = path.join(config.html_report!, 'config.js');
  config.compareReportURL = path.join(config.html_report!, 'index.html');
}

function jsonReport (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.json_report = path.join(config._runBaseDir!, 'json_report');
  if (userConfig.paths) {
    config.json_report = userConfig.paths.json_report || config.json_report;
  }

  config.compareJsonFileName = path.join(config.json_report!, 'jsonReport.json');
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
  config.captureConfigFileNameDefault = path.join(config.visregRoot!, 'capture', 'config.default.json');
}

function engine (config: Partial<RuntimeConfig>, userConfig: VisregConfig | Record<string, any>) {
  config.engine_scripts = path.join(config.projectPath!, 'visreg_data', 'engine_scripts');
  config.engine_scripts_default = path.join(config.visregRoot!, 'capture', 'engine_scripts');

  if (userConfig.paths) {
    config.engine_scripts = userConfig.paths.engine_scripts || config.engine_scripts;
  }
}

export default extendConfig;
