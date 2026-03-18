describe('core report', function () {
  const config = {
    report: ['json'],
    json_report: '/test',
    compareJsonFileName: '/compareJson',
    compareConfigFileName: '/compareConfig',
    comparePath: '/comparePath',
    html_report: '/html_report',
    bitmaps_test: '/bitmaps_test',
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
      readFile: jest.fn().mockImplementation((filePath: string) => {
        // Return empty Buffer for font files, empty string for JS files
        if (typeof filePath === 'string' && filePath.endsWith('.woff2')) {
          return Promise.resolve(Buffer.from(''));
        }
        // Simulate a JS file that contains </script> to test escaping
        if (typeof filePath === 'string' && filePath.endsWith('index_bundle.js')) {
          return Promise.resolve('var x="</script>";');
        }
        return Promise.resolve('');
      }),
      writeFile: writeFileStub
    }));
    jest.mock('fs-extra', () => ({
      copy: jest.fn().mockResolvedValue(undefined),
      ensureDir: jest.fn().mockResolvedValue(undefined)
    }));

    report = require('../../../core/command/report') as unknown as typeof report;
  });

  it('should write a self-contained index.html and json reports when config.report specifies json', function () {
    return report.execute(config).then(() => {
      expect(writeFileStub).toHaveBeenCalledTimes(3);
      expect(writeFileStub).toHaveBeenCalledWith('/compareJson', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/html_report/index.html', expect.anything());
      expect(writeFileStub).toHaveBeenCalledWith('/bitmaps_test/report.json', expect.anything());
    });
  });

  it('should produce a self-contained HTML with no external script references', function () {
    return report.execute(config).then(() => {
      const htmlCall = writeFileStub.mock.calls.find(
        (call: unknown[]) => call[0] === '/html_report/index.html'
      );
      expect(htmlCall).toBeDefined();
      const htmlContent = htmlCall![1] as string;
      // No external script references
      expect(htmlContent).not.toContain('<script src=');
      // Config JSONP is inlined
      expect(htmlContent).toContain('report(');
      // Basic structure is present
      expect(htmlContent).toContain('<div id="root">');
      expect(htmlContent).toContain('Shaka Vis Reg Report');
      // Font is inlined as base64 data URI
      expect(htmlContent).toContain("data:font/woff2;base64,");
      // Worker script is embedded
      expect(htmlContent).toContain('id="diverged-worker-script"');
    });
  });

  it('should escape </script> in inlined JS to prevent premature tag closure', function () {
    return report.execute(config).then(() => {
      const htmlCall = writeFileStub.mock.calls.find(
        (call: unknown[]) => call[0] === '/html_report/index.html'
      );
      expect(htmlCall).toBeDefined();
      const htmlContent = htmlCall![1] as string;
      // The bundle mock 'var x="</script>";' must have </script escaped to <\/script
      // so the inlined content never prematurely closes the <script> tag
      expect(htmlContent).not.toContain('var x="</script>"');
      expect(htmlContent).toContain('var x="<\\/script>"');
    });
  });
});
