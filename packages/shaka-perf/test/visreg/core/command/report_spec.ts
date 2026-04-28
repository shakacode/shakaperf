import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ReportModule {
  execute: (config: Record<string, unknown>) => Promise<{ passed: number; failed: number }>;
}

describe('visreg core report', function () {
  let report: ReportModule;
  let htmlReportDir: string;
  // The Reporter instance the mocked `compare` resolves to. Tests mutate
  // `tests` per case, then call `report.execute(...)` which reads from this.
  let reporter: { testSuite: string; tests: Array<{ pair: Record<string, unknown>; status: string }>; passed(): number; failed(): number };

  beforeAll(function () {
    jest.resetModules();

    reporter = {
      testSuite: 'visreg',
      tests: [],
      passed() { return this.tests.filter((t) => t.status === 'pass').length; },
      failed() { return this.tests.filter((t) => t.status !== 'pass').length; },
    };

    jest.mock('../../../../src/visreg/core/util/compare/index', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => Promise.resolve(reporter)),
    }));
    jest.mock('../../../../src/visreg/core/util/logger', () => ({
      __esModule: true,
      default: () => ({ log: jest.fn(), error: jest.fn() }),
    }));

    report = require('../../../../src/visreg/core/command/report') as ReportModule;
  });

  beforeEach(function () {
    htmlReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-report-'));
    reporter.tests = [];
  });

  afterEach(function () {
    fs.rmSync(htmlReportDir, { recursive: true, force: true });
  });

  function makeConfig() {
    return { htmlReportDir, projectPath: htmlReportDir };
  }

  function readPerTestReport(slug: string, viewport: string) {
    const p = path.join(htmlReportDir, `visreg-${viewport}`, slug, 'report.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  }

  it('writes a per-test report.json bucketed by (slug, viewport)', async function () {
    reporter.tests = [
      {
        pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'document' },
        status: 'pass',
      },
      {
        pair: { label: 'Homepage', viewportLabel: 'tablet', selector: 'document' },
        status: 'pass',
      },
    ];

    const result = await report.execute(makeConfig());
    expect(result).toEqual({ passed: 2, failed: 0 });

    const desktop = readPerTestReport('homepage', 'desktop');
    expect(desktop.testSuite).toBe('visreg');
    expect(Array.isArray(desktop.tests)).toBe(true);
    expect((desktop.tests as Array<unknown>).length).toBe(1);
    expect(desktop).not.toHaveProperty('engineError');
    expect(desktop).not.toHaveProperty('engineOutput');

    const tablet = readPerTestReport('homepage', 'tablet');
    expect((tablet.tests as Array<unknown>).length).toBe(1);
  });

  it('folds a single pair error into top-level engineError verbatim', async function () {
    reporter.tests = [{
      pair: {
        label: 'Homepage', viewportLabel: 'desktop', selector: 'document',
        engineErrorMsg: 'browser crashed',
      },
      status: 'fail',
    }];

    await report.execute(makeConfig());

    const json = readPerTestReport('homepage', 'desktop');
    expect(json.engineError).toBe('browser crashed');
    expect(json.engineOutput).toMatch(/document/);
    expect(json.engineOutput).toMatch(/browser crashed/);
  });

  it('aggregates multiple pair errors into one engineError summary', async function () {
    reporter.tests = [
      {
        pair: {
          label: 'Homepage', viewportLabel: 'desktop', selector: 'header',
          engineErrorMsg: 'selector not found',
        },
        status: 'fail',
      },
      {
        pair: {
          label: 'Homepage', viewportLabel: 'desktop', selector: 'footer',
          error: 'reference file missing',
        },
        status: 'fail',
      },
    ];

    await report.execute(makeConfig());

    const json = readPerTestReport('homepage', 'desktop');
    expect(json.engineError).toBe('2 pair(s) errored');
    expect(json.engineOutput).toMatch(/header/);
    expect(json.engineOutput).toMatch(/selector not found/);
    expect(json.engineOutput).toMatch(/footer/);
    expect(json.engineOutput).toMatch(/reference file missing/);
  });

  it('removes the flat capture dirs after writing per-test reports', async function () {
    fs.mkdirSync(path.join(htmlReportDir, 'control_screenshot'), { recursive: true });
    fs.mkdirSync(path.join(htmlReportDir, 'experiment_screenshot'), { recursive: true });

    reporter.tests = [{
      pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'document' },
      status: 'pass',
    }];

    await report.execute(makeConfig());

    expect(fs.existsSync(path.join(htmlReportDir, 'control_screenshot'))).toBe(false);
    expect(fs.existsSync(path.join(htmlReportDir, 'experiment_screenshot'))).toBe(false);
  });
});
