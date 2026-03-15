import executeCommand from './command/index.js';
import makeConfig from './util/makeConfig.js';
import type { RuntimeConfig } from './types.js';

export { defineVisregConfig } from './types.js';
export type { VisregGlobalConfig } from './types.js';

export default async function (command: string, options?: Record<string, unknown>) {
  const config = await makeConfig(command, options) as RuntimeConfig;
  return executeCommand(command, config);
}

/* ***
// Sample of the config object that is created on `shaka-visreg init` by makeConfig()

{ args:
    { _: [ 'init' ],
        h: false,
        help: false,
        v: false,
        version: false,
        i: false,
        config: 'visreg.config.ts'
    },
    visregRoot: '/path/to/shaka-visreg',
    projectPath: '/path/to/project',
    perf: { init: { started: 2018-09-23T04:01:09.673Z } },
    configFileName: '/path/to/project/visreg.config.ts',
    bitmaps_reference: '/path/to/project/visreg_data/bitmaps_reference',
    bitmaps_test: '/path/to/project/visreg_data/bitmaps_test',
    ci_report: '/path/to/project/visreg_data/ci_report',
    ciReport:
    {
        format: 'junit',
        testReportFileName: 'xunit',
        testSuiteName: 'shaka-visreg'
    },
    html_report: '/path/to/project/visreg_data/html_report',
    openReport: true,
    compareConfigFileName: '/path/to/project/visreg_data/html_report/config.js',
    compareReportURL: '/path/to/project/visreg_data/html_report/index.html',
    comparePath: '/path/to/shaka-visreg/compare/output',
    engine_scripts: '/path/to/project/visreg_data/engine_scripts',
    engine_scripts_default: '/path/to/shaka-visreg/capture/engine_scripts',
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
