import { jest } from '@jest/globals';
import assert from 'node:assert';

describe('core report', function () {
  const config = {
    report: ['json'],
    json_report: '/test',
    compareJsonFileName: '/compareJson',
    compareConfigFileName: '/compareConfig',
    html_report: '/html_report',
    bitmaps_test: '/bitmaps_test',
    screenshotDateTime: 'screenshotDateTime',
    args: {
      config: {}
    }
  };

  let report;
  let writeFileStub;

  beforeAll(async function () {
    jest.resetModules();

    const reporterClass = { failed: () => undefined, passed: () => 'passed', getReport: () => { return { test: 123 }; } };
    const compareMock = jest.fn<any>().mockResolvedValue(reporterClass);
    const loggerMock = () => {
      return { log: jest.fn(), error: jest.fn() };
    };
    writeFileStub = jest.fn<any>().mockResolvedValue(undefined);

    jest.unstable_mockModule('../../../core/util/compare/index.js', () => ({
      default: compareMock
    }));
    jest.unstable_mockModule('../../../core/util/logger.js', () => ({
      default: loggerMock
    }));
    jest.unstable_mockModule('node:fs/promises', () => ({
      readFile: jest.fn<any>().mockResolvedValue('{}'),
      writeFile: writeFileStub
    }));
    jest.unstable_mockModule('fs-extra', () => ({
      copy: jest.fn<any>().mockResolvedValue(undefined),
      ensureDir: jest.fn<any>().mockResolvedValue(undefined)
    }));

    report = await import('../../../core/command/report.js');
  });

  it('should generate two json reports and a default browser report when config.report specifies json', function () {
    return report.execute(config).then(() => {
      expect(writeFileStub).toHaveBeenCalledTimes(3);
      expect(writeFileStub).toHaveBeenCalledWith('/compareJson', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/compareConfig', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/bitmaps_test/screenshotDateTime/report.json', expect.anything());
    });
  });
});
