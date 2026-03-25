describe('core report', function () {
  const config = {
    report: ['json'],
    jsonReportDir: '/test',
    compareJsonFileName: '/compareJson',
    compareConfigFileName: '/compareConfig',
    comparePath: '/compare/output',
    htmlReportDir: '/html_report',
    experimentScreenshotDir: '/experiment_screenshot',
    args: {
      config: {}
    }
  };

  // Dynamically imported mocked module — use Record type since actual shape depends on mocks
  let report: { execute: (config: Record<string, unknown>) => Promise<void> };
  let writeFileStub: jest.Mock;

  beforeAll(function () {
    jest.resetModules();

    const reporterClass = { failed: (): undefined => undefined, passed: () => 'passed', getReport: () => { return { test: 123 }; } };
    const compareMock = jest.fn().mockResolvedValue(reporterClass);
    const loggerMock = () => {
      return { log: jest.fn(), error: jest.fn() };
    };
    writeFileStub = jest.fn().mockResolvedValue(undefined);

    jest.mock('../../../core/util/compare/index', () => ({
      __esModule: true,
      default: compareMock
    }));
    jest.mock('../../../core/util/logger', () => ({
      __esModule: true,
      default: loggerMock
    }));
    jest.mock('node:fs/promises', () => ({
      readFile: jest.fn().mockResolvedValue('{}'),
      writeFile: writeFileStub,
      copyFile: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined)
    }));
    jest.mock('fs-extra', () => ({
      copy: jest.fn().mockResolvedValue(undefined),
      ensureDir: jest.fn().mockResolvedValue(undefined)
    }));

    report = require('../../../core/command/report') as unknown as typeof report;
  });

  it('should generate two json reports and a default browser report when config.report specifies json', function () {
    return report.execute(config).then(() => {
      expect(writeFileStub).toHaveBeenCalledTimes(3);
      expect(writeFileStub).toHaveBeenCalledWith('/compareJson', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/compareConfig', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/experiment_screenshot/report.json', expect.anything());
    });
  });
});
