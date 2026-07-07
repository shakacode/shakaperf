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
  ORIGINAL_REPO, EXPERIMENT_CLONE_PATH, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  assertPlainNonZeroExit, env, loud, startServers, waitForPort,
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
// The audit runs over a small FILTERED set of ab-tests (homepage + shop-now,
// matching the perf/visreg slice, plus products for the error path) — enough
// pages for the report's multi-page layouts without paying to audit all ~19.
// It deliberately KEEPS the broken products selector the global setup injected.
// That exercises the audit's engine-error path end to end: the non-zero exit,
// and the error card in the TECHNICAL full-report (the products test is
// desktop-only while the v2 client report is phone-framed, so the client
// report's own "couldn't measure this page" state is NOT covered here — it
// would need a phone-viewport failure). All AI passes are disabled so the
// captured copy is the deterministic built-in fallback — baselines must not
// vary run to run.
//
// Keep products in the pattern: the erroredTests assertion below pins it as the
// sole engineered failure, so dropping it would remove the non-zero exit this
// spec is built around.
const AUDIT_TEST_PATH_PATTERN =
  './ab-tests/homepage.abtest.ts|./ab-tests/shop-now.abtest.ts|./ab-tests/products.abtest.ts';
test('audit filtered pages, render v2 client report, screenshot its states @audit', async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);

  // This spec's audit must exit non-zero via the sabotaged selector, which
  // exists only in the temp clone global setup creates — in live mode
  // (SKIP_GLOBAL_SETUP=1 against the developer's working tree) the audit
  // would exit 0 and the expectation below would fail spuriously.
  test.skip(
    EXPERIMENT_CLONE_PATH === ORIGINAL_REPO,
    'needs the sabotaged temp clone from global setup — incompatible with SKIP_GLOBAL_SETUP=1',
  );

  // Fail fast if the sabotage silently vanished (a drifted global-setup
  // replace would otherwise surface only ~30 min later as "audit exited 0").
  const productsAbtest = fs.readFileSync(
    path.join(EXPERIMENT_CLONE_PATH, 'demo-ecommerce/ab-tests/products.abtest.ts'),
    'utf-8',
  );
  expect(
    productsAbtest.includes('category-option-electronics-fake-broken-selector'),
    'global setup must have injected the broken products selector',
  ).toBe(true);

  startServers();
  loud(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`);
  await Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]);

  // Fresh audit over the filtered ab-tests. The audit engine wipes audit-results on
  // its own; this manual wipe is belt-and-braces so persisted engine errors
  // from the earlier FILTERED audit spec can't leak into this run's report.
  if (fs.existsSync(AUDIT_RESULTS_DIR)) {
    fs.rmSync(AUDIT_RESULTS_DIR, { recursive: true, force: true });
  }

  loud(`Running shaka-perf audit over the filtered ab-tests (${AUDIT_TEST_PATH_PATTERN}, ai_summary skipped)`);
  // Expect a non-zero exit: the sabotaged products selector reliably errors
  // that one test. Swallow the throw and verify the artifacts below.
  let auditFailed = false;
  try {
    execSync(
      `yarn shaka-perf audit --skip-stages ai_summary --testPathPattern ${JSON.stringify(AUDIT_TEST_PATH_PATTERN)}`,
      { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 40 * 60 * 1000 },
    );
  } catch (e) {
    auditFailed = true;
    // Only a plain non-zero exit counts as "failed as designed" — a timeout
    // kill or spawn failure must fail the spec, not masquerade as the
    // engineered error.
    assertPlainNonZeroExit(e, 'shaka-perf audit');
  }
  if (!auditFailed) {
    throw new Error('Expected shaka-perf audit to exit non-zero (broken products selector), but it exited 0');
  }
  loud('Audit exited non-zero as expected (sabotaged products test errored)');
  expect(fs.existsSync(path.join(AUDIT_RESULTS_DIR, 'report.json')), 'audit must still write report.json').toBe(true);

  // The non-zero exit must come from the ENGINEERED error alone. If any
  // other test errored (servers dying mid-audit, flaky engine), the baseline
  // would quietly become a report full of broken pages.
  const auditReport = JSON.parse(
    fs.readFileSync(path.join(AUDIT_RESULTS_DIR, 'report.json'), 'utf-8'),
  ) as { tests: Array<{ name: string; outcomes: Array<{ kind: string }> }> };
  const erroredTests = [...new Set(
    auditReport.tests
      .filter((t) => t.outcomes.some((o) => o.kind === 'error'))
      .map((t) => t.name),
  )];
  expect(erroredTests, 'only the sabotaged products test may error').toEqual(['Products - Electronics Filter']);

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
  const auditShots = await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(AUDIT_RESULTS_DIR, 'full-report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'audit',
  });

  // Drive the v2 client report through its interactive states: overview with
  // status tiles + tab scores, each tab panel, tile jump, lightbox, severity
  // chip toggle.
  const clientShots = await captureClientReportScreenshots({
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

  // Every capture interaction is optional-locator by design; these manifest
  // checks are what make a silently-vanished evidence class fail the suite.
  for (const required of ['01-overview', '07-a11y-dialog', '08-logs']) {
    expect(auditShots, `technical-report capture must include the ${required} shot`).toContain(required);
  }
  for (const required of ['05-artifact-lighthouse', '05-artifact-timeline']) {
    expect(auditShots, `technical-report capture must include the ${required} shot`).toContain(required);
  }
  for (const required of ['01-overview', '02-tab-a11y', '02-tab-agent', '04-lightbox']) {
    expect(clientShots, `client-report capture must include the ${required} shot`).toContain(required);
  }
});
