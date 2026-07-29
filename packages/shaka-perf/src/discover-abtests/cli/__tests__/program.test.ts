/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDiscoverAbtestsCommand, findDefaultVisregReports } from '../program';
import { parseReport } from '../../parse-report';

jest.mock('../../parse-report', () => ({
  parseReport: jest.fn(),
}));

const mockParseReport = parseReport as jest.MockedFunction<typeof parseReport>;

describe('findDefaultVisregReports', () => {
  const tmpDir = path.join(__dirname, 'tmp-default-visreg-reports');
  const originalCwd = process.cwd();

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    mockParseReport.mockReset();
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds and sorts per-unit reports', () => {
    const first = path.join(tmpDir, 'a-test-desktop', 'artifacts', 'report.json');
    const second = path.join(tmpDir, 'b-test-phone', 'artifacts', 'report.json');
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(first, '{"tests": []}');
    fs.writeFileSync(second, '{"tests": []}');
    fs.mkdirSync(path.join(tmpDir, 'other', 'artifacts'), { recursive: true });

    expect(findDefaultVisregReports(tmpDir)).toEqual([first, second]);
  });

  it('returns no reports when the results root is absent', () => {
    expect(findDefaultVisregReports(path.join(tmpDir, 'missing'))).toEqual([]);
  });

  it('uses per-unit reports when parse-report has no path argument', async () => {
    const reportPath = path.join('compare-results', 'home-desktop', 'artifacts', 'report.json');
    fs.mkdirSync(path.join(tmpDir, path.dirname(reportPath)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, reportPath), '{"tests": []}');
    process.chdir(tmpDir);

    await createDiscoverAbtestsCommand().parseAsync(['node', 'shaka-perf', 'parse-report'], { from: 'node' });

    expect(mockParseReport).toHaveBeenCalledWith(reportPath);
  });
});
