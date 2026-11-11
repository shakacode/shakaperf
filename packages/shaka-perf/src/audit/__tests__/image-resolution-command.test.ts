/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AbTestDefinition } from 'shaka-shared';
import { loadAbTestsConfig, loadTests } from '../../config-loader';
import { ArtifactStore } from '../../pipeline/artifact-store';
import { createAuditCommand } from '../program';
import { runAuditStage } from '../stages/audit/engine';

jest.mock('shaka-shared', () => ({
  ...jest.requireActual('shaka-shared'),
  readTestSource: jest.fn(() => 'abTest("Product", {}, async () => {});'),
}));
jest.mock('../../pipeline/measurement-lock', () => ({
  acquireMeasurementLock: async () => ({ release() {} }),
}));
jest.mock('../../config-loader', () => ({
  ...jest.requireActual('../../config-loader'),
  loadAbTestsConfig: jest.fn(),
  loadTests: jest.fn(),
}));
jest.mock('../stages/audit/engine', () => ({ runAuditStage: jest.fn() }));

describe('audit image resolution failure policy', () => {
  let cwd: string;
  let previousCwd: string;
  let previousExitCode: typeof process.exitCode;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  const test: AbTestDefinition = {
    name: 'Product', file: '/tests/product.abtest.ts', line: 1,
    startingPath: '/', testTypes: null, testFn: async () => {},
  } as AbTestDefinition;
  const config = {
    shared: {
      controlURL: 'http://localhost:3030', experimentURL: 'http://localhost:3030',
      parallelism: 1, viewports: ['desktop'], retries: 0,
      playwrightOptions: { browser: 'chromium', waitTimeout: 1000 },
      browserConsole: { failOn: [], allowList: [] },
    },
  };
  const run = (...args: string[]) => createAuditCommand().exitOverride().parseAsync([
    '--config', path.join(cwd, 'abtests.config.ts'), '--stages', 'audit',
    ...(args.includes('--report-only') ? [] : ['--skip-report']), ...args,
  ], { from: 'user' });
  const measurement = (undersized: number, failOnUndersized = false) => ({
    metrics: [], imageResolution: { images: [], undersized, oversized: 1, unknown: 0, failOnUndersized },
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'image-resolution-command-'));
    process.chdir(cwd);
    jest.mocked(loadAbTestsConfig).mockResolvedValue(config as never);
    jest.mocked(loadTests).mockResolvedValue([test]);
    jest.mocked(runAuditStage).mockReset();
    jest.mocked(runAuditStage).mockResolvedValue(measurement(1));
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    fs.rmSync(cwd, { recursive: true, force: true });
    log.mockRestore();
    error.mockRestore();
  });

  it('reports undersized images without failing by default', async () => {
    await run();
    expect(process.exitCode).toBeUndefined();
  });

  it('fails for configured undersized findings even when top-level reporting is skipped', async () => {
    jest.mocked(runAuditStage).mockResolvedValue(measurement(1, true));
    await run();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('1 test with undersized images'));
  });

  it('forces failure from the command and passes the override to the audit engine', async () => {
    await run('--fail-on-undersized-images');
    expect(process.exitCode).toBe(1);
    expect(jest.mocked(runAuditStage).mock.calls[0]![2]).toMatchObject({ failOnUndersizedImages: true });
  });

  it('does not fail for oversized images alone', async () => {
    jest.mocked(runAuditStage).mockResolvedValue(measurement(0));
    await run('--fail-on-undersized-images');
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    ['--categories', 'accessibility'],
    ['--skip-stages', 'audit'],
    ['--stages', 'accessibility'],
    ['--restart-from-stage', 'accessibility'],
  ])('rejects a failure flag when selection excludes audit (%s %s)', async (...selection) => {
    await expect(createAuditCommand().exitOverride().parseAsync([
      '--config', path.join(cwd, 'abtests.config.ts'), '--fail-on-undersized-images', ...selection,
    ], { from: 'user' })).rejects.toThrow('--fail-on-undersized-images requires the audit stage');
    expect(runAuditStage).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(cwd, 'audit-results'))).toBe(false);
  });

  it('checks saved image findings under report-only without remeasuring', async () => {
    const store = new ArtifactStore(path.join(cwd, 'audit-results'));
    store.writeOutcome(test, 'desktop', { kind: 'ok', stage: 'audit', measurement: measurement(1) });
    await run('--report-only', '--fail-on-undersized-images');
    expect(runAuditStage).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('undersized images'));
    const report = JSON.parse(fs.readFileSync(path.join(cwd, 'audit-results', 'report.json'), 'utf8'));
    expect(report.tests[0].outcomes[0].summary.imageResolution).toMatchObject({
      undersized: 1, oversized: 1, unknown: 0, failOnUndersized: true,
    });
  });

  it('requires a fresh audit when saved results lack image measurements and failure was requested', async () => {
    const store = new ArtifactStore(path.join(cwd, 'audit-results'));
    store.writeOutcome(test, 'desktop', { kind: 'ok', stage: 'audit', measurement: { metrics: [] } });
    await run('--report-only', '--fail-on-undersized-images');
    expect(runAuditStage).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('missing image resolution measurements'));
  });

  it('does not pass a requested image check when no audit results have been saved', async () => {
    await run('--report-only', '--fail-on-undersized-images');
    expect(runAuditStage).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('missing image resolution measurements'));
  });

  it('still renders saved audits made before image checks were available', async () => {
    const store = new ArtifactStore(path.join(cwd, 'audit-results'));
    store.writeOutcome(test, 'desktop', { kind: 'ok', stage: 'audit', measurement: { metrics: [] } });
    await run('--report-only');
    expect(process.exitCode).toBeUndefined();
  });
});
