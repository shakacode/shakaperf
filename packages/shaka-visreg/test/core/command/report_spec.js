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

  beforeAll(function () {
    jest.resetModules();

    const reporterClass = { failed: () => undefined, passed: () => 'passed', getReport: () => { return { test: 123 }; } };
    const compareMock = jest.fn().mockResolvedValue(reporterClass);
    const loggerMock = () => {
      return { log: jest.fn(), error: jest.fn() };
    };
    writeFileStub = jest.fn().mockResolvedValue();
    const fsMock = { ensureDir: () => Promise.resolve(), writeFile: writeFileStub, copy: () => Promise.resolve() };

    jest.doMock('../../../core/util/compare/', () => compareMock);
    jest.doMock('../../../core/util/logger', () => loggerMock);
    jest.doMock('../../../core/util/fs', () => fsMock);

    report = require('../../../core/command/report');
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
