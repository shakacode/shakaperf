/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDiscoverAbtestsCommand } from '../program';

describe('parse-report without a path', () => {
  const tmpDir = path.join(__dirname, 'tmp-parse-report-fanout');
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    process.exitCode = undefined;
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('continues after a malformed report and reports the bad path', async () => {
    const badReport = path.join(tmpDir, 'compare-results', 'a-bad', 'artifacts', 'report.json');
    const goodReport = path.join(tmpDir, 'compare-results', 'b-good', 'artifacts', 'report.json');
    fs.mkdirSync(path.dirname(badReport), { recursive: true });
    fs.mkdirSync(path.dirname(goodReport), { recursive: true });
    fs.writeFileSync(badReport, '{');
    fs.writeFileSync(goodReport, JSON.stringify({
      tests: [{ status: 'pass', pair: { label: 'Good report' } }],
    }));
    process.chdir(tmpDir);

    await createDiscoverAbtestsCommand().parseAsync(['node', 'shaka-perf', 'parse-report'], { from: 'node' });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read or parse report compare-results/a-bad/artifacts/report.json'),
    );
    expect(logSpy).toHaveBeenCalledWith('Total: 1  Pass: 1  Fail: 0  Other: 0');
    expect(process.exitCode).toBe(1);
  });
});
