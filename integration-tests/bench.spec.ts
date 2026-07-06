/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  loud, run, startServers, waitForPort,
} from './helpers';
import { captureReportScreenshots } from './report-capture';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'bench-results');

test('run shaka-perf compare --categories perf on twin servers @perf', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);

  startServers();
  loud(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`);
  await Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]);

  loud('Running shaka-perf compare --categories perf');
  // Expect a non-zero exit: the LazySection→div swap reliably regresses
  // HomePage perf. We still need the artifacts, so swallow the throw and
  // verify the report was produced below.
  let perfFailed = false;
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
  }
  if (!perfFailed) {
    throw new Error('Expected shaka-perf compare --categories perf to exit non-zero (HomePage regression), but it exited 0');
  }
  loud('Perf compare exited non-zero as expected (regression detected)');

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
  await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(COMPARE_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'perf',
  });
});
