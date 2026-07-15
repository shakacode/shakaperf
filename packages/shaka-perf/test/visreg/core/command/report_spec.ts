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

interface ReportModule {
  execute: (config: Record<string, unknown>) => Promise<{ passed: number; failed: number }>;
}

describe('visreg core report', function () {
  let report: ReportModule;
  let scratchDir: string;
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
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-report-'));
    unitArtifactsDir = path.join(scratchDir, 'homepage-desktop-abc12345-burn-2', 'artifacts');
    reporter.tests = [];
  });

  afterEach(function () {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  // The compare runner pins one test and one viewport per invocation, and pins
  // the dir to write into — a burn-suffixed one under `--burn`. The engine never
  // derives it.
  let unitArtifactsDir: string;

  function makeConfig() {
    return {
      projectPath: scratchDir,
      unitArtifactsDir,
      args: {},
      viewports: [{ label: 'desktop' }],
    };
  }

  function readPerTestReport() {
    const p = path.join(unitArtifactsDir, 'report.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  }

  it('writes report.json into the dir it was given, not one it derives', async function () {
    reporter.tests = [
      {
        pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'document' },
        status: 'pass',
      },
      {
        pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'header' },
        status: 'pass',
      },
    ];

    const result = await report.execute(makeConfig());
    expect(result).toEqual({ passed: 2, failed: 0 });

    // Writing anywhere but the dir the runner owns means the stage reads back an
    // empty dir and reports "did not produce artifacts".
    const json = readPerTestReport();
    expect(json.testSuite).toBe('visreg');
    expect((json.tests as Array<unknown>).length).toBe(2);
    expect(json).not.toHaveProperty('engineError');
    expect(json).not.toHaveProperty('engineOutput');
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

    const json = readPerTestReport();
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

    const json = readPerTestReport();
    expect(json).not.toHaveProperty('engineError');
    expect(json).not.toHaveProperty('engineOutput');
    expect((json.tests as Array<unknown>).length).toBe(2);
  });

  it('leaves flat capture dirs for the runner-owned wipe', async function () {
    fs.mkdirSync(path.join(scratchDir, 'control_screenshot'), { recursive: true });
    fs.mkdirSync(path.join(scratchDir, 'experiment_screenshot'), { recursive: true });

    reporter.tests = [{
      pair: { label: 'Homepage', viewportLabel: 'desktop', selector: 'document' },
      status: 'pass',
    }];

    await report.execute(makeConfig());

    expect(fs.existsSync(path.join(scratchDir, 'control_screenshot'))).toBe(true);
    expect(fs.existsSync(path.join(scratchDir, 'experiment_screenshot'))).toBe(true);
  });
});
