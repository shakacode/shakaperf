import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getGitRunId } from '../../../core/util/gitRunId.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const packageJson = _require('../../../package.json');

process.chdir(__dirname);

import makeConfig from '../../../core/util/makeConfig.js';

const { version } = packageJson;
const configFile = _require('./visreg');

// root of visreg package dir, not related to cwd
const visregDir = path.resolve(__dirname, '../../..');
const runId = getGitRunId();
const runBase = path.resolve('visreg_data', runId);

const expectedConfig: Record<string, any> = {
  args: {},
  asyncCompareLimit: undefined,
  visregRoot: visregDir,
  visregVersion: version,
  bitmaps_reference: path.join(runBase, 'bitmaps_reference'),
  bitmaps_test: path.join(runBase, 'bitmaps_test'),
  ci_report: path.join(runBase, 'ci_report'),
  html_report: path.join(runBase, 'html_report'),
  openReport: true,
  comparePath: path.resolve(visregDir, 'compare/output'),
  captureConfigFileNameDefault: path.resolve(
    visregDir,
    'capture/config.default.json'
  ),
  engine: null,
  engine_scripts: path.resolve('visreg_data/engine_scripts'),
  engine_scripts_default: path.resolve(visregDir, 'capture/engine_scripts'),
  perf: {},
  id: configFile.id,
  report: ['browser'],
  ciReport: {
    format: 'junit',
    testReportFileName: 'xunit',
    testSuiteName: 'shaka-visreg'
  },
  compareConfigFileName: path.join(runBase, 'html_report/config.js'),
  compareReportURL: path.join(runBase, 'html_report/index.html'),
  defaultMisMatchThreshold: 0.1,
  debug: false,
  compareRetries: 0,
  compareRetryDelay: 5000,
  maxNumDiffPixels: 0,
  resembleOutputOptions: undefined,
  scenarioLogsInReports: undefined,
  archivePath: path.join(runBase, 'reports'),
  archiveReport: false
};

describe('make config it', function () {
  it('should return the default config correctly', function () {
    const actualConfig = makeConfig('test');

    assert(actualConfig.tempCompareConfigFileName);
    delete actualConfig.tempCompareConfigFileName;

    assert(actualConfig.configFileName);
    delete actualConfig.configFileName;

    assert(actualConfig.projectPath);
    delete actualConfig.projectPath;

    assert(actualConfig.captureConfigFileName);
    delete actualConfig.captureConfigFileName;

    assert(actualConfig.json_report);
    delete actualConfig.json_report;

    assert(actualConfig.compareJsonFileName);
    delete actualConfig.compareJsonFileName;

    assert(actualConfig._runBaseDir);
    delete actualConfig._runBaseDir;

    assert.deepStrictEqual(actualConfig, expectedConfig);
  });
});
