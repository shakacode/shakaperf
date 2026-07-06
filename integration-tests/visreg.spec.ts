/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  assertPlainNonZeroExit, loud, run, startServers, waitForPort,
} from './helpers';
import { captureReportScreenshots } from './report-capture';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'visreg-results');

test('run shaka-perf compare --categories visreg on twin servers @visreg', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  startServers();
  loud(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`);
  await Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]);

  // Expect a non-zero exit: the hero padding change + broken-selector
  // injection reliably produce mismatches, and compare now propagates that
  // to the exit code. Swallow the throw so we can still verify the report.
  loud('Running shaka-perf compare --categories visreg');
  let visregFailed = false;
  try {
    run('yarn shaka-perf compare --categories visreg', {
      timeout: 15 * 60 * 1000,
    });
  } catch (e) {
    visregFailed = true;
    if (e && typeof e === 'object') {
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      if (err.stdout) console.log(err.stdout.toString());
      if (err.stderr) console.log(err.stderr.toString());
    }
    // Only a plain non-zero exit counts as "failed as designed" — a timeout
    // kill or spawn failure must fail the spec, not masquerade as mismatches.
    assertPlainNonZeroExit(e, 'shaka-perf compare --categories visreg');
  }
  if (!visregFailed) {
    throw new Error('Expected shaka-perf compare --categories visreg to exit non-zero (mismatches), but it exited 0');
  }
  loud('Visreg compare exited non-zero as expected (mismatches detected)');

  // The exit code alone can't distinguish the two ENGINEERED failures from
  // "the servers died and everything mismatched" — pin the specific expected
  // outcomes in the machine report.
  const machineReport = JSON.parse(
    fs.readFileSync(path.join(COMPARE_RESULTS_DIR, 'report.json'), 'utf-8'),
  ) as { tests: Array<{ name: string; chips: Array<{ tag: string }>; outcomes: Array<{ kind: string }> }> };
  const rowsFor = (name: string) => machineReport.tests.filter((t) => t.name === name);
  expect(
    rowsFor('Products - Electronics Filter').some((t) => t.outcomes.some((o) => o.kind === 'error')),
    'the sabotaged products selector must produce an engine error',
  ).toBe(true);
  expect(
    rowsFor('Homepage').some((t) => t.chips.some((c) => c.tag === 'visual change')),
    'the hero padding change must flag Homepage as a visual change',
  ).toBe(true);

  // Snapshots receive ONLY the deep-click report screenshots below. The results
  // tree itself (report JSON/HTML, raw captures with per-run ids in their
  // filenames) is transient and never copied — the report is driven in place,
  // where its relative artifact references resolve, and the full tree stays
  // in the working results dir until the next run.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Interact with the unified full-report.html: filter toggles, visreg
  // scrubber, error log surface, test source expansion.
  const shots = await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(COMPARE_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'visreg',
  });

  // Every capture interaction is optional-locator by design; this manifest
  // check is what makes a silently-vanished evidence class fail the suite.
  for (const required of ['01-overview', '06-visreg-diff', '06-visreg-diff-scrubbed', '06-visreg-nodiff', '08-logs']) {
    expect(shots, `capture must include the ${required} shot`).toContain(required);
  }
});
