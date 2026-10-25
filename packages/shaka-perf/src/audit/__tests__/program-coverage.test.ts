/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { loadAbTestsConfig, loadTests } from '../../config-loader';
import { runPipeline } from '../../pipeline/runner';
import { generateCumulativeCoverageReport } from '../stages/code_coverage/cumulative-report';
import { createAuditCommand } from '../program';
import { testIdForTest } from '../../pipeline/unit-id';
import type { AbTestDefinition } from 'shaka-shared';

jest.mock('../../config-loader', () => ({ loadAbTestsConfig: jest.fn(), loadTests: jest.fn() }));
jest.mock('../../pipeline/runner', () => ({ runPipeline: jest.fn() }));
jest.mock('../stages/code_coverage/cumulative-report', () => ({ generateCumulativeCoverageReport: jest.fn() }));
const test = { name: 'selected', file: '/project/test.abtest.ts', line: 1 } as AbTestDefinition;
const selected = { id: testIdForTest(test), outcomes: [] };
const retained = { id: 'retained', outcomes: [] };
let oldExitCode: typeof process.exitCode;
beforeEach(() => {
  oldExitCode = process.exitCode;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(loadAbTestsConfig).mockResolvedValue({ shared: {
    parallelism: 1, controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3031',
    playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
    browserConsole: { failOn: [], allowList: [] },
  } });
  jest.mocked(loadTests).mockResolvedValue([test]);
  jest.mocked(runPipeline).mockResolvedValue({ resultsRoot: '/project/audit-results',
    reportPath: '', testResults: [selected, retained], hasFailures: false, failureSummary: '',
  } as never);
  jest.mocked(generateCumulativeCoverageReport).mockResolvedValue({} as never);
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); process.exitCode = oldExitCode; });
const run = (...args: string[]) => createAuditCommand().parseAsync([
  '--config', '/project/abtests.config.ts', '--categories', 'code_coverage', ...args,
], { from: 'user' });

it('regenerates only selected test and viewport coverage without measuring', async () => {
  await run('--report-only', '--filter', 'selected', '--viewport', 'phone');
  expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reportOnly: true }));
  expect(generateCumulativeCoverageReport).toHaveBeenCalledWith(expect.objectContaining({
    tests: [selected], viewports: ['phone'], configPath: '/project/abtests.config.ts',
  }));
});
it('still writes a partial report before preserving measurement failure status', async () => {
  jest.mocked(runPipeline).mockResolvedValue({ resultsRoot: '/project/audit-results', reportPath: '',
    testResults: [selected], hasFailures: true, failureSummary: 'test failed',
  } as never);
  await run();
  expect(generateCumulativeCoverageReport).toHaveBeenCalledWith(expect.objectContaining({ engineFailures: ['test failed'] }));
  expect(process.exitCode).toBe(1);
});
it('respects skip-report and fails if report generation itself fails', async () => {
  await run('--skip-report');
  expect(generateCumulativeCoverageReport).not.toHaveBeenCalled();
  jest.mocked(generateCumulativeCoverageReport).mockRejectedValue(new Error('disk full'));
  await run('--report-only');
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith('Coverage report failed: disk full');
});
