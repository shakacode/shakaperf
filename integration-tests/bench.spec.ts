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
  assertPlainNonZeroExit, loud, run, stage, startServers, waitForPort,
} from './helpers';
import { captureReportScreenshots } from './report-capture';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'bench-results');

test('run shaka-perf compare --categories perf on twin servers @perf', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  // Expect a non-zero exit: the LazySection→div swap reliably regresses
  // HomePage perf. We still need the artifacts, so swallow the throw and
  // verify the report was produced below.
  let perfFailed = false;
  await stage('Running shaka-perf compare --categories perf', () => {
    try {
      run(
        [
          'yarn shaka-perf compare',
          '--categories perf',
          '--testPathPattern "./ab-tests/shop-now.abtest.ts|./ab-tests/homepage.abtest.ts"',
        ].join(' '),
        { timeout: 20 * 60 * 1000 },
      );
    } catch (e) {
      perfFailed = true;
      if (e && typeof e === 'object') {
        const err = e as { stderr?: Buffer; stdout?: Buffer };
        if (err.stdout) console.log(err.stdout.toString());
        if (err.stderr) console.log(err.stderr.toString());
      }
      // Only a plain non-zero exit counts as "failed as designed" — a timeout
      // kill or spawn failure must fail the spec, not masquerade as a regression.
      assertPlainNonZeroExit(e, 'shaka-perf compare --categories perf');
    }
  });
  if (!perfFailed) {
    throw new Error('Expected shaka-perf compare --categories perf to exit non-zero (HomePage regression), but it exited 0');
  }
  loud('Perf compare exited non-zero as expected (regression detected)');

  // Pin the ENGINEERED outcome — the LazySection→div swap must be what
  // regressed, not some run-wide collapse that also exits non-zero.
  const machineReport = JSON.parse(
    fs.readFileSync(path.join(COMPARE_RESULTS_DIR, 'report.json'), 'utf-8'),
  ) as { tests: Array<{ name: string; chips: Array<{ tag: string }> }> };
  expect(
    machineReport.tests.some((t) => t.name === 'Homepage' && t.chips.some((c) => c.tag === 'regression')),
    'the LazySection→div swap must flag Homepage with a regression chip',
  ).toBe(true);

  // Snapshots receive ONLY the deep-click report screenshots below. The results
  // tree itself (report JSON/HTML, raw captures with per-run ids in their
  // filenames) is transient and never copied — the report is driven in place,
  // where its relative artifact references resolve, and the full tree stays
  // in the working results dir until the next run.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Interact with the unified full-report.html and capture every distinct
  // state (dialogs, expanded source, filtered grid, timeline preview,
  // scrubber).
  const shots = await stage('Deep-click full-report capture', () => captureReportScreenshots({
    page,
    reportHtmlPath: path.join(COMPARE_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'perf',
  }));

  // Every capture interaction is optional-locator by design; this manifest
  // check is what makes a silently-vanished evidence class fail the suite.
  for (const required of ['01-overview', '08-logs']) {
    expect(shots, `capture must include the ${required} shot`).toContain(required);
  }
  for (const required of ['05-artifact-lighthouse', '05-artifact-timeline']) {
    expect(shots, `capture must include the ${required} shot`).toContain(required);
  }
});
