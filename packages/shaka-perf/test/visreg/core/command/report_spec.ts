/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { unitIdForTest } from '../../../../src/pipeline/unit-id';

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
    jest.mock('../../../../src/config-loader', () => ({
      loadTests: jest.fn().mockResolvedValue([
        { name: 'Homepage', file: null, line: null },
      ]),
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
    return {
      htmlReportDir,
      projectPath: htmlReportDir,
      args: {},
      viewports: [
        { label: 'desktop' },
        { label: 'tablet' },
      ],
    };
  }

  function readPerTestReport(label: string, viewport: string) {
    const slug = unitIdForTest({ name: label, file: null, line: null } as any, viewport);
    const p = path.join(htmlReportDir, slug, 'artifacts', 'report.json');
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

    const desktop = readPerTestReport('Homepage', 'desktop');
    expect(desktop.testSuite).toBe('visreg');
    expect(Array.isArray(desktop.tests)).toBe(true);
    expect((desktop.tests as Array<unknown>).length).toBe(1);
    expect(desktop).not.toHaveProperty('engineError');
    expect(desktop).not.toHaveProperty('engineOutput');

    const tablet = readPerTestReport('Homepage', 'tablet');
    expect((tablet.tests as Array<unknown>).length).toBe(1);
  });

  it('throws a single pair error after writing artifact JSON without an engine envelope', async function () {
    reporter.tests = [{
      pair: {
        label: 'Homepage', viewportLabel: 'desktop', selector: 'document',
        engineErrorMsg: 'browser crashed',
      },
      status: 'fail',
    }];

    await expect(report.execute(makeConfig())).rejects.toThrow('browser crashed');

    const json = readPerTestReport('Homepage', 'desktop');
    expect(json).not.toHaveProperty('engineError');
    expect(json).not.toHaveProperty('engineOutput');
    expect((json.tests as Array<unknown>).length).toBe(1);
  });

  it('throws an aggregate pair error after writing artifact JSON without an engine envelope', async function () {
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

    await expect(report.execute(makeConfig())).rejects.toThrow('2 pair(s) errored');

    const json = readPerTestReport('Homepage', 'desktop');
    expect(json).not.toHaveProperty('engineError');
    expect(json).not.toHaveProperty('engineOutput');
    expect((json.tests as Array<unknown>).length).toBe(2);
  });

  it('leaves flat capture dirs for the runner-owned wipe', async function () {
    fs.mkdirSync(path.join(htmlReportDir, 'control_screenshot'), { recursive: true });
    fs.mkdirSync(path.join(htmlReportDir, 'experiment_screenshot'), { recursive: true });

    reporter.tests = [{
      pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'document' },
      status: 'pass',
    }];

    await report.execute(makeConfig());

    expect(fs.existsSync(path.join(htmlReportDir, 'control_screenshot'))).toBe(true);
    expect(fs.existsSync(path.join(htmlReportDir, 'experiment_screenshot'))).toBe(true);
  });
});
