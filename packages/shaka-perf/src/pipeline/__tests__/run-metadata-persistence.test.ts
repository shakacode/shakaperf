/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { readCheckoutCommit } from '../../twin-servers/helpers/server-commit';
import type { AbTestDefinition } from 'shaka-shared';
import { buildAbTestsConfig } from '../../config';
import { createPipeline } from '../pipeline';
import { runPipeline } from '../runner';
import { ArtifactStore } from '../artifact-store';

jest.mock('node:child_process', () => ({ ...jest.requireActual('node:child_process'), execFile: jest.fn() }));

// These fixtures do not take real measurements; leave the machine queue to real runs.
jest.mock('../measurement-lock', () => ({
  acquireMeasurementLock: async () => ({ release() {} }),
}));

it('automatically persists original metadata and reuses it unchanged in every report format', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-metadata-http-'));
  const originalArgv = process.argv;
  const originalTmpdir = process.env.TMPDIR;
  const targetUrl = 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor';
  const message = `Deploy Homepage\n\nDetails: ${targetUrl}\npassword="demo value"\nCookie: session=demo-session; auth=demo-auth\n\n`;
  execFileSync('git', ['init', cwd], { stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.test', 'commit', '--allow-empty', '--cleanup=verbatim', '-F', '-'], { cwd, input: message, stdio: 'pipe' });
  const deployed = readCheckoutCommit(cwd)!;
  const encoded = Buffer.from(JSON.stringify(deployed)).toString('base64');
  // The operator's current checkout moves; the running image retains its original Git identity.
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.test', 'commit', '--allow-empty', '-m', 'Different current checkout'], { cwd, stdio: 'pipe' });
  expect(readCheckoutCommit(cwd)!.sha).not.toBe(deployed.sha);
  jest.mocked(execFile).mockImplementation(((_file: string, args: string[], _options: unknown, callback: (err: Error | null, output?: { stdout: string }) => void) => {
    if (args[0] === 'ps') callback(null, { stdout: 'container123\n' });
    else if (args[0] === 'inspect') callback(null, { stdout: `{"3000/tcp":[{"HostPort":"3020","HostIp":"0.0.0.0"},{"HostPort":"3020","HostIp":"::"}]}\ncontrol-server\n${encoded}\n` });
    else if (args.includes('git')) callback(new Error('Image excludes .git'));
    else callback(null, { stdout: 'MISSING' });
  }) as never);
  try {
    const url = 'http://127.0.0.1:3020';
    process.env.TMPDIR = cwd;
    process.argv = ['node', 'shaka-perf', 'compare', `--controlURL=${targetUrl}`];
    const config = buildAbTestsConfig({ shared: {
      controlURL: url, experimentURL: url, parallelism: 1,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60000 },
      browserConsole: { failOn: ['error'], allowList: [] }, timeoutMs: 1000, retries: 0, retryDelay: 0,
    } });
    const pipeline = createPipeline({
      name: 'compare', description: 'Metadata persistence fixture', measurementSides: ['control', 'experiment'],
      report: { reportLabel: 'compare', renderHeaderUrls: () => null, renderTestCardUrls: () => null, renderDialogMetaUrls: () => null },
    }, (builder) => {
      const pool = builder.registerWorkerPool(1);
      builder.runStage(pool, {
        measuresApplication: true,
        name: 'visreg', label: 'Visual Diff', category: 'visreg', description: 'Fake measurement; real identity lookup and persistence', selfContainedReportStrip: {},
        applies: () => true, renderArtifacts: () => null, machineReadableSummary: () => ({}),
        async run() { return []; },
      });
      builder.waitForAllTasksFinishAndDispose(pool);
      builder.buildChips({ chipsForAllTests: (entries) => new Map(entries.map(({ test }) => [test, []])) });
      builder.buildSorts({ sortsForAllTests: () => new Map() });
    });
    const test: AbTestDefinition = { name: 'Homepage', startingPath: '/cart?mode=demo#anchor', file: null, line: null, testTypes: null, testFn: async () => {} };
    const result = await runPipeline(pipeline, { cwd, config, controlURL: url, experimentURL: url, tests: [test] });
    const store = new ArtifactStore(path.join(cwd, 'compare-results'));
    expect(execFile).toHaveBeenCalled();
    for (const outcome of result.testResults[0]!.outcomes) {
      expect(outcome.runMetadata?.viewport).toEqual(outcome.viewport);
      expect(store.readOutcome(test, outcome.viewport.label, 'visreg')?.runMetadata).toEqual(outcome.runMetadata);
      expect(outcome.runMetadata?.targets.every((target) => target.commit?.sha === deployed.sha)).toBe(true);
      expect(outcome.runMetadata?.targets[0]?.commit?.message).toBe(message);
      expect(outcome.runMetadata?.targets[0]?.url).toBe(`${url}/cart?mode=demo#anchor`);
      expect(outcome.runMetadata?.command).toContain(targetUrl);
      expect(outcome.runMetadata).not.toHaveProperty('throttling');
    }
    for (const file of ['report.json', 'full-report.html', 'self-contained-performance-report.html']) {
      const content = fs.readFileSync(path.join(cwd, 'compare-results', file), 'utf8');
      expect(content).toContain('runMetadata');
      expect(content).toContain(targetUrl);
      expect(content).toContain('demo-session');
      expect(content).toContain('demo-auth');
    }
  } finally {
    process.argv = originalArgv;
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    jest.mocked(execFile).mockReset();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}, 15000);
