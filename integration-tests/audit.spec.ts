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
  DEMO_CWD, EXPERIMENT_CLONE_PATH,
  CONTROL_PORT, EXPERIMENT_PORT,
  env, loud, startServers, waitForPort,
} from './helpers';

// `shaka-perf audit` writes per-test artifacts (Lighthouse reports,
// screencast.mp4, timeline_frame_*.avif) under `audit-results/`. Each
// per-test artifacts dir is `<results-dir>/<test-slug>/artifacts/`.
const AUDIT_RESULTS_DIR = path.join(DEMO_CWD, 'audit-results');

// The OCR validator that asserts blue "click NNms" chips coincide with
// red "Click" overlays on the same kept frame. Lives inside the temp
// clone so that ESM imports of tesseract.js / sharp resolve against the
// same yarn-pnp store the audit run uses.
const VERIFY_SCRIPT = path.join(
  EXPERIMENT_CLONE_PATH,
  'packages/shaka-perf/verify-click-coincidence.mjs',
);

test('shaka-perf audit produces frames whose blue + red click chips coincide @audit', async () => {
  test.setTimeout(25 * 60 * 1000);

  startServers();
  loud(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`);
  await Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]);

  // Two tests with multiple Playwright-driven clicks each: the products
  // filter test (Category dropdown + Electronics option) and the admin
  // login flow (username + password fields, Login button, side-panel
  // navigation). Together they exercise both desktop and phone
  // viewports, short- and long-INP clicks, and key-press chips
  // interleaved with click chips — the same fixtures the OCR validator
  // was tuned on.
  // Wipe audit-results before running — without this, persisted
  // engine-error files from PRIOR audit runs (against tests we don't
  // filter into this run) cause `shaka-perf audit` to exit non-zero
  // with a `FAILED: N errors` summary that has nothing to do with the
  // filtered tests we care about.
  if (fs.existsSync(AUDIT_RESULTS_DIR)) {
    fs.rmSync(AUDIT_RESULTS_DIR, { recursive: true, force: true });
  }

  loud('Running shaka-perf audit --filter for Products + Form Login');
  // Don't go through helpers.run() — it pipes stdio and only prints on
  // success, so audit failures arrive here as an opaque "Command
  // failed". Inherit stdio so the full audit log streams to the
  // playwright reporter and any failing engine error is visible
  // directly in CI output.
  execSync(
    'yarn shaka-perf audit --filter="Products - Electronics Filter|Form Login"',
    { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 20 * 60 * 1000 },
  );

  // Every per-test directory should have at least one AVIF — otherwise
  // the audit silently produced no frames and the validator below would
  // pass trivially with no signal to inspect.
  expect(fs.existsSync(AUDIT_RESULTS_DIR), `${AUDIT_RESULTS_DIR} must exist after audit`).toBe(true);
  const testDirs = fs.readdirSync(AUDIT_RESULTS_DIR)
    .map((d) => path.join(AUDIT_RESULTS_DIR, d, 'artifacts'))
    .filter((d) => fs.statSync(path.dirname(d)).isDirectory() && fs.existsSync(d));
  expect(testDirs.length, 'audit must produce at least one per-test artifacts directory').toBeGreaterThan(0);
  for (const dir of testDirs) {
    const avifs = fs.readdirSync(dir).filter((f) => f.startsWith('timeline_frame_') && f.endsWith('.avif'));
    expect(avifs.length, `${dir} must contain timeline_frame_*.avif`).toBeGreaterThan(0);
  }

  // Run the OCR validator against the audit-results tree. It exits 0
  // when first-blue == first-red and last-blue == last-red for every
  // test, non-zero otherwise.
  loud('Verifying blue/red click chip coincidence via OCR');
  let stdout = '';
  try {
    stdout = execSync(`yarn node ${JSON.stringify(VERIFY_SCRIPT)} ${JSON.stringify(AUDIT_RESULTS_DIR)}`, {
      cwd: EXPERIMENT_CLONE_PATH,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5 * 60 * 1000,
      encoding: 'utf-8',
    });
    console.log(stdout);
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    console.log(err.stdout ?? '');
    console.log(err.stderr ?? '');
    throw new Error(`verify-click-coincidence.mjs failed with exit ${err.status ?? 'unknown'} — blue/red chips do not coincide. See output above.`);
  }
  expect(stdout, 'validator output must end with PASS').toMatch(/\bPASS\b\s*$/);
});
