const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
  <head>
    <title>Shaka Vis Reg Report</title>
    <style>
      @font-face {
          font-family: 'latoregular';
          src: url('./assets/fonts/lato-regular-webfont.woff2') format('woff2'),
              url('./assets/fonts/lato-regular-webfont.woff') format('woff');
      }
      @font-face {
          font-family: 'latobold';
          src: url('./assets/fonts/lato-bold-webfont.woff2') format('woff2'),
              url('./assets/fonts/lato-bold-webfont.woff') format('woff');
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>function report(r){window.tests=r;}</script>
    <script src="config.js"></script>
    <script src="index_bundle.js"></script>
  </body>
</html>`;

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
        if (typeof filePath === 'string' && filePath.endsWith('index.html')) {
          return Promise.resolve(HTML_TEMPLATE);
        }
        // Return empty Buffer for font files, empty string for JS files
        if (typeof filePath === 'string' && filePath.endsWith('.woff2')) {
          return Promise.resolve(Buffer.from(''));
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

  it('should inline the config JSONP data into the HTML', function () {
    return report.execute(config).then(() => {
      const htmlCall = writeFileStub.mock.calls.find(
        (call: unknown[]) => call[0] === '/html_report/index.html'
      );
      expect(htmlCall).toBeDefined();
      const htmlContent = htmlCall![1] as string;
      // Config should be inlined, not as external script src
      expect(htmlContent).not.toContain('<script src="config.js">');
      expect(htmlContent).toContain('report(');
    });
  });
});
