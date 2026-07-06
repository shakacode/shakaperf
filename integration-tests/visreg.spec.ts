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
  }
  if (!visregFailed) {
    throw new Error('Expected shaka-perf compare --categories visreg to exit non-zero (mismatches), but it exited 0');
  }
  loud('Visreg compare exited non-zero as expected (mismatches detected)');

  // Snapshots receive ONLY the deep-click report screenshots below. The results
  // tree itself (report JSON/HTML, raw captures with per-run ids in their
  // filenames) is transient and never copied — the report is driven in place,
  // where its relative artifact references resolve, and the full tree stays
  // in the working results dir until the next run.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Per-test outcomes are no longer asserted here: compare's non-zero exit
  // code (checked above) is the real signal that the intended visreg
  // mismatches were detected, and the on-disk artifact layout changed from
  // a monolithic `_visreg/html_report/report.json` to per-test
  // `visreg-<viewport>/<slug>/report.json` files. The snapshot copy +
  // screenshots below still exercise the full artifact tree for visual
  // review.

  // Interact with the unified full-report.html: filter toggles, visreg
  // scrubber, error log surface, test source expansion.
  await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(COMPARE_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'visreg',
  });
});
