import assert from 'node:assert';
import path from 'node:path';
import { getGitRunId } from '../../../core/util/gitRunId';
import { VISREG_DEFAULT_CONFIG } from '../../../core/types';

const packageJson = require('../../../package.json');

process.chdir(__dirname);

import makeConfig from '../../../core/util/makeConfig';

const { version } = packageJson;

// root of visreg package dir, not related to cwd
const visregDir = path.resolve(__dirname, '../../..');
const runId = getGitRunId();
const runBase = path.resolve('visreg_data', runId);

// Since no visreg.config.ts exists in the test dir, makeConfig falls back
// to VISREG_DEFAULT_CONFIG. Default paths are relative strings and override
// the absolute runBase paths via extendConfig.
const defaultPaths = VISREG_DEFAULT_CONFIG.paths!;

const expectedConfig: Record<string, any> = {
  args: {},
  asyncCompareLimit: undefined,
  visregRoot: visregDir,
  visregVersion: version,
  controlScreenshotDir: defaultPaths.htmlReport + '/control_screenshot',
  experimentScreenshotDir: defaultPaths.htmlReport + '/experiment_screenshot',
  ciReportDir: defaultPaths.ciReport,
  htmlReportDir: defaultPaths.htmlReport,
  comparePath: path.resolve(visregDir, 'compare/output'),
  captureConfigFileNameDefault: path.resolve(
    visregDir,
    'capture/config.default.ts'
  ),
  engine: null,
  perf: {},
  id: undefined,
  report: VISREG_DEFAULT_CONFIG.report,
  ciReport: {
    format: 'junit',
    testReportFileName: 'xunit',
    testSuiteName: 'shaka-visreg'
  },
  compareConfigFileName: defaultPaths.htmlReport + '/config.js',
  compareReportURL: defaultPaths.htmlReport + '/index.html',
  defaultMisMatchThreshold: 0.1,
  debug: false,
  compareRetries: VISREG_DEFAULT_CONFIG.compareRetries,
  compareRetryDelay: VISREG_DEFAULT_CONFIG.compareRetryDelay,
  maxNumDiffPixels: VISREG_DEFAULT_CONFIG.maxNumDiffPixels,
  resembleOutputOptions: undefined,
  scenarioLogsInReports: undefined,
  archivePath: path.join(runBase, 'reports'),
  archiveReport: false
};

describe('make config it', function () {
  it('should return the default config correctly', async function () {
    const actualConfig = await makeConfig('test');

    assert(actualConfig.tempCompareConfigFileName);
    delete actualConfig.tempCompareConfigFileName;

    assert(actualConfig.configFileName);
    delete actualConfig.configFileName;

    assert(actualConfig.projectPath);
    delete actualConfig.projectPath;

    assert(actualConfig.captureConfigFileName);
    delete actualConfig.captureConfigFileName;

    assert(actualConfig.jsonReportDir);
    delete actualConfig.jsonReportDir;

    assert(actualConfig.compareJsonFileName);
    delete actualConfig.compareJsonFileName;

    assert(actualConfig._runBaseDir);
    delete actualConfig._runBaseDir;

    assert.deepStrictEqual(actualConfig, expectedConfig);
  });
});
