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
  env, restoreProductsSelector, stage, startServers, waitForPort,
} from './helpers';

// `shaka-perf audit` writes per-test artifacts (Lighthouse reports,
// screencast.mp4, timeline_frame_*.webp + thumbnail AVIFs, and the
// timeline_frames.json metadata that pins chips/annotations to frames)
// under `audit-results/`. Each per-test artifacts dir is
// `<results-dir>/<test-slug>/artifacts/`.
const AUDIT_RESULTS_DIR = path.join(DEMO_CWD, 'audit-results');

// The validator that asserts the measured "click NNms" chips (persisted
// as timeline_frames.json metadata, rendered as React overlays) coincide
// with the red "Click" overlays baked into the recorded frame pixels,
// which it reads via OCR. Lives inside the temp clone so that ESM
// imports of tesseract.js / sharp resolve against the same yarn-pnp
// store the audit run uses.
const VERIFY_SCRIPT = path.join(
  EXPERIMENT_CLONE_PATH,
  'packages/shaka-perf/verify-click-coincidence.mjs',
);

test('shaka-perf audit produces frames whose blue + red click chips coincide @audit', async () => {
  test.setTimeout(25 * 60 * 1000);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

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

  // The global setup sabotaged the products Electronics selector (for the
  // visreg engine-error path); this spec needs the click flow working so the
  // audit produces the click chips the OCR validator inspects.
  restoreProductsSelector();

  // Don't go through helpers.run() — it pipes stdio and only prints on
  // success, so audit failures arrive here as an opaque "Command
  // failed". Inherit stdio so the full audit log streams to the
  // playwright reporter and any failing engine error is visible
  // directly in CI output.
  // ai_summary is skipped: its claude-written sentences vary run to run,
  // which would churn the baseline log for zero OCR signal.
  await stage('Running shaka-perf audit --filter for Products + Form Login', () => {
    execSync(
      'yarn shaka-perf audit --skip-stages ai_summary --filter="Products - Electronics Filter|Form Login"',
      { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 20 * 60 * 1000 },
    );
  });

  // Every per-test directory should have timeline metadata describing at
  // least one frame, and every frame image the metadata references must
  // exist on disk — otherwise the audit silently produced no frames and
  // the validator below would pass trivially with no signal to inspect.
  expect(fs.existsSync(AUDIT_RESULTS_DIR), `${AUDIT_RESULTS_DIR} must exist after audit`).toBe(true);
  const testDirs = fs.readdirSync(AUDIT_RESULTS_DIR)
    .map((d) => path.join(AUDIT_RESULTS_DIR, d, 'artifacts'))
    .filter((d) => fs.statSync(path.dirname(d)).isDirectory() && fs.existsSync(d));
  expect(testDirs.length, 'audit must produce at least one per-test artifacts directory').toBeGreaterThan(0);
  for (const dir of testDirs) {
    const metadataPath = path.join(dir, 'timeline_frames.json');
    expect(fs.existsSync(metadataPath), `${dir} must contain timeline_frames.json`).toBe(true);
    const frames = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Array<{ imageFilename: string }>;
    expect(frames.length, `${metadataPath} must describe at least one frame`).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(
        fs.existsSync(path.join(dir, frame.imageFilename)),
        `${frame.imageFilename} referenced by ${metadataPath} must exist`,
      ).toBe(true);
    }
  }

  // Run the validator against the audit-results tree. It exits 0 when
  // the first/last metadata click-chip frames each also carry the red
  // in-page Click overlay (read from the frame pixels via OCR) for every
  // test, non-zero otherwise.
  const stdout = await stage('Verifying blue/red click chip coincidence (metadata vs OCR)', () => {
    try {
      const out = execSync(`yarn node ${JSON.stringify(VERIFY_SCRIPT)} ${JSON.stringify(AUDIT_RESULTS_DIR)}`, {
        cwd: EXPERIMENT_CLONE_PATH,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000,
        encoding: 'utf-8',
      });
      console.log(out);
      return out;
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      console.log(err.stdout ?? '');
      console.log(err.stderr ?? '');
      throw new Error(`verify-click-coincidence.mjs failed with exit ${err.status ?? 'unknown'} — blue/red chips do not coincide. See output above.`);
    }
  });
  // Belt-and-braces against a vacuous PASS: the validator hard-fails when it
  // validated zero click-chip tests, and this asserts the count line it
  // prints on success so a validator regression can't silently drop it.
  expect(stdout, 'validator must have validated at least one click-chip test').toMatch(/validated [1-9]\d* test/);
  expect(stdout, 'validator output must end with PASS').toMatch(/\bPASS\b\s*$/);
});
