import { jest } from '@jest/globals';

describe('core report', function () {
  const config = {
    report: ['json'],
    json_report: '/test',
    compareJsonFileName: '/compareJson',
    compareConfigFileName: '/compareConfig',
    html_report: '/html_report',
    bitmaps_test: '/bitmaps_test',
    args: {
      config: {}
    }
  };

  // Dynamically imported mocked module — use Record type since actual shape depends on mocks
  let report: { execute: (config: Record<string, unknown>) => Promise<void> };
  let writeFileStub: jest.Mock;

  beforeAll(async function () {
    jest.resetModules();

    const reporterClass = { failed: (): undefined => undefined, passed: () => 'passed', getReport: () => { return { test: 123 }; } };
    const compareMock = jest.fn<() => Promise<typeof reporterClass>>().mockResolvedValue(reporterClass);
    const loggerMock = () => {
      return { log: jest.fn(), error: jest.fn() };
    };
    writeFileStub = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    jest.unstable_mockModule('../../../core/util/compare/index.js', () => ({
      default: compareMock
    }));
    jest.unstable_mockModule('../../../core/util/logger.js', () => ({
      default: loggerMock
    }));
    jest.unstable_mockModule('node:fs/promises', () => ({
      readFile: jest.fn<() => Promise<string>>().mockResolvedValue('{}'),
      writeFile: writeFileStub
    }));
    jest.unstable_mockModule('fs-extra', () => ({
      copy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      ensureDir: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    }));

    report = await import('../../../core/command/report.js') as unknown as typeof report;
  });

  it('should generate two json reports and a default browser report when config.report specifies json', function () {
    return report.execute(config).then(() => {
      expect(writeFileStub).toHaveBeenCalledTimes(3);
      expect(writeFileStub).toHaveBeenCalledWith('/compareJson', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/compareConfig', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/bitmaps_test/report.json', expect.anything());
    });
  });
});
