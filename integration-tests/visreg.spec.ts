/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  assertPlainNonZeroExit, loud, run, stage, startServers, stripAnsi, waitForPort,
} from './helpers';
import { captureReportScreenshots } from './report-capture';
import { formatLogPrefix } from '../packages/shaka-perf/src/pipeline/log-prefix-format';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'visreg-results');

// From the real formatter, so a padding change moves this check with it.
const SIDE_PREFIXES = [formatLogPrefix('control'), formatLogPrefix('experiment')];

test('run shaka-perf compare --categories visreg on twin servers @visreg', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  // Expect a non-zero exit: the hero padding change + broken-selector
  // injection reliably produce mismatches, and compare now propagates that
  // to the exit code. Swallow the throw so we can still verify the report.
  let visregFailed = false;
  let compareOutput = '';
  await stage('Running shaka-perf compare --categories visreg', () => {
    try {
      compareOutput = run('yarn shaka-perf compare --categories visreg', {
        timeout: 15 * 60 * 1000,
      });
    } catch (e) {
      visregFailed = true;
      if (e && typeof e === 'object') {
        const err = e as { stderr?: Buffer; stdout?: Buffer };
        compareOutput = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        if (compareOutput) console.log(compareOutput);
      }
      // Only a plain non-zero exit counts as "failed as designed" — a timeout
      // kill or spawn failure must fail the spec, not masquerade as mismatches.
      assertPlainNonZeroExit(e, 'shaka-perf compare --categories visreg');
    }
  });
  if (!visregFailed) {
    throw new Error('Expected shaka-perf compare --categories visreg to exit non-zero (mismatches), but it exited 0');
  }
  loud('Visreg compare exited non-zero as expected (mismatches detected)');

  // The exit code alone can't distinguish the two ENGINEERED failures from
  // "the servers died and everything mismatched" — pin the specific expected
  // outcomes in the machine report.
  const machineReport = JSON.parse(
    fs.readFileSync(path.join(COMPARE_RESULTS_DIR, 'report.json'), 'utf-8'),
  ) as {
    tests: Array<{
      name: string;
      chips: Array<{ tag: string }>;
      outcomes: Array<{ kind: string; error?: { message?: string; stack?: string } }>;
    }>;
  };
  const rowsFor = (name: string) => machineReport.tests.filter((t) => t.name === name);
  const productsErrors = rowsFor('Products - Electronics Filter')
    .flatMap((t) => t.outcomes)
    .filter((o) => o.kind === 'error');
  expect(
    productsErrors.length,
    'the sabotaged products selector must produce an engine error',
  ).toBeGreaterThan(0);
  expect(
    rowsFor('Homepage').some((t) => t.chips.some((c) => c.tag === 'visual change')),
    'the hero padding change must flag Homepage as a visual change',
  ).toBe(true);

  // Both sides run concurrently, so the `[  control   ]` / `[ experiment ]`
  // column is the only thing naming WHICH side threw. It lands on `err.message`
  // as the error unwinds, after the stage wrapped it — a wrapper that freezes
  // its stack at construction silently drops it. Pin both surfaces.
  const traces = stripAnsi(compareOutput).split('\n').filter((l) => l.startsWith('StageFailureError:'));
  expect(traces.length, 'the sabotaged selector must print a StageFailureError trace').toBeGreaterThan(0);
  for (const text of [...traces, ...productsErrors.map((o) => `${o.error?.message}\n${o.error?.stack}`)]) {
    expect(
      SIDE_PREFIXES.some((p) => text.includes(p)),
      `must name the failing side: ${text}`,
    ).toBe(true);
  }

  // Snapshots receive ONLY the deep-click report screenshots below. The results
  // tree itself (report JSON/HTML, raw captures with per-run ids in their
  // filenames) is transient and never copied — the report is driven in place,
  // where its relative artifact references resolve, and the full tree stays
  // in the working results dir until the next run.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Interact with the unified full-report.html: filter toggles, visreg
  // scrubber, error log surface, test source expansion.
  const shots = await stage('Deep-click full-report capture', () => captureReportScreenshots({
    page,
    reportHtmlPath: path.join(COMPARE_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'visreg',
  }));

  // Every capture interaction is optional-locator by design; this manifest
  // check is what makes a silently-vanished evidence class fail the suite.
  for (const required of ['01-overview', '06-visreg-diff', '06-visreg-diff-scrubbed', '06-visreg-nodiff', '08-logs']) {
    expect(shots, `capture must include the ${required} shot`).toContain(required);
  }
});
