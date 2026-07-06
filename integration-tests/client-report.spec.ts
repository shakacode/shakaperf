/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  env, loud, startServers, waitForPort,
} from './helpers';
import {
  captureClientReportScreenshots,
  captureReportScreenshots,
} from './report-capture';

const AUDIT_RESULTS_DIR = path.join(DEMO_CWD, 'audit-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'audit-results');

// Covers the audit → client-report pipeline end to end, focused on the v2
// client report design (status tiles, per-tab scores in the headers, the
// dominant-problem performance tile, accessibility severity chips, the
// AI-visibility tab) plus the technical full-report over the same audit.
//
// The audit runs over ALL demo ab-tests so the report has enough pages for
// its multi-page layouts, and it deliberately KEEPS the broken products
// selector the global setup injected: that page's engine error is exactly how
// the client report's "we couldn't measure this page" state gets rendered and
// screenshotted. All AI passes are disabled so the captured copy is the
// deterministic built-in fallback — baselines must not vary run to run.
test('audit all pages, render v2 client report, screenshot its states @audit', async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);

  startServers();
  loud(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`);
  await Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]);

  // Fresh audit over every ab-test. The previous (filtered) audit spec's
  // results are wiped by the audit engine itself.
  if (fs.existsSync(AUDIT_RESULTS_DIR)) {
    fs.rmSync(AUDIT_RESULTS_DIR, { recursive: true, force: true });
  }

  loud('Running shaka-perf audit over all demo ab-tests (ai_summary skipped)');
  // Expect a non-zero exit: the sabotaged products selector reliably errors
  // that one test, which is the "could not measure" case the client report
  // must render. Swallow the throw and verify the artifacts below.
  let auditFailed = false;
  try {
    execSync(
      'yarn shaka-perf audit --skip-stages ai_summary',
      { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 40 * 60 * 1000 },
    );
  } catch {
    auditFailed = true;
  }
  if (!auditFailed) {
    throw new Error('Expected shaka-perf audit to exit non-zero (broken products selector), but it exited 0');
  }
  loud('Audit exited non-zero as expected (sabotaged products test errored)');
  expect(fs.existsSync(path.join(AUDIT_RESULTS_DIR, 'report.json')), 'audit must still write report.json').toBe(true);

  // Render the v2 client report deterministically: every claude pass off, so
  // the verdict copy / captions / a11y summaries are the built-in fallbacks.
  loud('Rendering v2 client report (all AI passes disabled)');
  execSync(
    'yarn shaka-perf client-report --results ./audit-results --no-ai-narrative --no-ai-captions --no-ai-a11y --no-ai-agent',
    { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 10 * 60 * 1000 },
  );
  const clientReportPath = path.join(AUDIT_RESULTS_DIR, 'client-report.html');
  expect(fs.existsSync(clientReportPath), 'client-report.html must be written').toBe(true);

  // Snapshots receive ONLY the deep-click report screenshots below. The results
  // tree itself (report JSON/HTML, raw captures with per-run ids in their
  // filenames) is transient and never copied — the report is driven in place,
  // where its relative artifact references resolve, and the full tree stays
  // in the working results dir until the next run.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Deep-click the technical full-report.html: audit cards with metric chips,
  // accessibility findings, agent-readiness results, timeline filmstrips.
  await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(AUDIT_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'audit',
  });

  // Drive the v2 client report through its interactive states: overview with
  // status tiles + tab scores, each tab panel, tile jump, lightbox, severity
  // chip toggle.
  await captureClientReportScreenshots({
    page,
    reportHtmlPath: clientReportPath,
    outDir: SNAPSHOT_DIR,
    label: 'client',
  });

  // The audit ran all three categories, so the v2 report must have all three
  // status tiles and all three tab headers (Performance / Accessibility /
  // AI visibility). The capture pass leaves the page on the client report.
  await expect(page.locator('.v2-tile[data-jump]'), 'v2 report must render 3 status tiles').toHaveCount(3);
  await expect(page.locator('.v2-tab'), 'v2 report must render 3 tab headers').toHaveCount(3);

});
