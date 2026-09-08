/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { DEMO_CWD, env, loud, stage, stripAnsi } from './helpers';

// Reproduces the perf-stage failure that surfaced, one sample late, as
//   Protocol error (Page.enable): Session closed. Most likely the page has been closed.
//
// Lighthouse's waitForFullyLoaded races its load gates against maxWaitForLoad
// and, once the race settles, cancels the gates — all but one:
//
//   resolveOnFcp.cancel();
//   resolveOnLoadEvent.cancel();
//   resolveOnNetworkIdle.cancel();
//   resolveOnCPUIdle.cancel();        // resolveOnCriticalNetworkIdle: never
//
// shaka-perf's hold makes the timeout branch settle the race exactly when the
// testFn returns. If the page still had a critical (High-priority) request in
// flight at that moment, the critical-idle gate is still pending; it resolves
// a moment later, while Lighthouse collects artifacts, and the load branch —
// which was only waiting for it — creates the cpu-idle poller AFTER cancel()
// ran. Nothing cancels it. Its re-scheduled poll fires after the page is
// closed; only the first poll is chained to reject(), so that rejection is
// unhandled and the worker escalates it to fatal — killing the NEXT sample on
// the same worker.
//
// The fixture (integration-fixtures/orphaned-poller) keeps exactly one fetch
// in flight past maxWaitForLoad and the CPU busy indefinitely; the testFn
// outlasts the cap and stops the fetching just before it returns. On
// unpatched Lighthouse that yields the orphan in the first sample and the
// fatal in the next. The fix in lighthouse.patch must make this run clean.

const FIXTURE_DIR = path.join(DEMO_CWD, 'integration-fixtures', 'orphaned-poller');
const RESULTS_DIR = path.join(FIXTURE_DIR, 'compare-results');
const OUTPUT_LOG = path.join(FIXTURE_DIR, 'compare-output.log');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitForUp(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/up`)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fixture server did not come up on ${port}`);
}

type Outcome = { stage: string; kind: string; error?: { message: string } };
type Report = { tests: Array<{ name: string; outcomes: Outcome[] }> };

test('orphaned cpu-idle poller must not surface as "Session closed" @perf', async () => {
  test.setTimeout(10 * 60 * 1000);

  // The server must live in its own process: execSync below blocks this one,
  // and an in-process server would never answer Lighthouse's navigation.
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(FIXTURE_DIR, 'server.mjs'), String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
  await waitForUp(port);
  loud(`fixture server on http://127.0.0.1:${port}`);
  if (fs.existsSync(RESULTS_DIR)) fs.rmSync(RESULTS_DIR, { recursive: true, force: true });

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    await stage('Running shaka-perf compare --categories perf --burn 1 on the fixture', () => {
      try {
        stdout = execSync('yarn shaka-perf compare --categories perf --burn 1', {
          cwd: FIXTURE_DIR,
          env: { ...env, ORPHAN_FIXTURE_PORT: String(port) },
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 8 * 60 * 1000,
        }).toString();
      } catch (e) {
        const err = e as { status?: number | null; signal?: string | null; stdout?: Buffer; stderr?: Buffer };
        stdout = err.stdout?.toString() ?? '';
        stderr = err.stderr?.toString() ?? '';
        exitCode = err.status ?? -1;
        if (err.signal) throw new Error(`shaka-perf compare was killed by ${err.signal}\n${stderr}`);
      }
    });
  } finally {
    server.kill();
  }

  // Full compare output on disk: the assertions below only quote fragments,
  // and a failure here is only diagnosable from the worker's timing lines.
  const text = stripAnsi(stdout + '\n' + stderr);
  fs.writeFileSync(OUTPUT_LOG, text);
  loud(`compare output → ${OUTPUT_LOG}`);
  console.log(text.split('\n').filter((l) => /task failed|Session closed|has been closed|<<< /.test(l)).join('\n'));

  const reportPath = path.join(RESULTS_DIR, 'report.json');
  expect(fs.existsSync(reportPath), `report.json must be written (exit ${exitCode})`).toBe(true);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as Report;
  const outcomes = report.tests.flatMap((t) => t.outcomes);
  const errors = outcomes.filter((o) => o.kind === 'error').map((o) => `${o.stage}: ${o.error?.message}`).join('\n');

  // The signature of the bug, anywhere in the run.
  expect(/Session closed/.test(text), `no sample may die of "Session closed"\n${errors}`).toBe(false);

  // And the perf stages must actually complete.
  for (const stageName of ['perf-warmup', 'perf', 'perf-low-noise']) {
    const stageOutcomes = outcomes.filter((o) => o.stage === stageName && o.kind !== 'skipped');
    expect(stageOutcomes.length, `${stageName} must have run`).toBeGreaterThan(0);
    expect(
      stageOutcomes.every((o) => o.kind === 'ok'),
      `${stageName} must be clean: ${JSON.stringify(stageOutcomes.map((o) => o.kind))}\n${errors}`,
    ).toBe(true);
  }
});
