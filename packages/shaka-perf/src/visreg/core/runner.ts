import executeCommand from './command/index';
import makeConfig from './util/makeConfig';
import type { RuntimeConfig } from './types';

export { defineVisregConfig } from './types';
export type { VisregGlobalConfig } from './types';

export default async function (command: string, options?: Record<string, unknown>) {
  const config = await makeConfig(command, options) as RuntimeConfig;
  return executeCommand(command, config);
}

/* ***
// Sample of the config object that is created on `shaka-perf visreg-init` by makeConfig()

{ args:
    { _: [ 'init' ],
        h: false,
        help: false,
        v: false,
        version: false,
        i: false,
        config: 'visreg.config.ts'
    },
    visregRoot: '/path/to/shaka-perf/visreg',
    projectPath: '/path/to/project',
    perf: { init: { started: 2018-09-23T04:01:09.673Z } },
    configFileName: '/path/to/project/visreg.config.ts',
    controlScreenshotDir: '/path/to/project/visreg_data/html_report/control_screenshot',
    experimentScreenshotDir: '/path/to/project/visreg_data/html_report/experiment_screenshot',
    ciReportDir: '/path/to/project/visreg_data/ci_report',
    ciReport:
    {
        format: 'junit',
        testReportFileName: 'xunit',
        testSuiteName: 'shaka-perf-visreg'
    },
    htmlReportDir: '/path/to/project/visreg_data/html_report',
    compareConfigFileName: '/path/to/project/visreg_data/html_report/config.js',
    compareReportURL: '/path/to/project/visreg_data/html_report/index.html',
    comparePath: '/path/to/shaka-perf/compare/output',
    id: undefined,
    engine: null,
    report: [ 'browser' ],
    defaultMisMatchThreshold: 0.1,
    debug: false,
    resembleOutputOptions: undefined,
    asyncCompareLimit: undefined,
    visregVersion: '6.3.25'
}
*** */
