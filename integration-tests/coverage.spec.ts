/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEMO_CWD, EXPERIMENT_CLONE_PATH, EXPERIMENT_PORT, ORIGINAL_REPO, PUMA_CMD,
  env, loud, portIsResponding, readAuditReport, run, stage, waitForPort,
} from './helpers';

const AUDIT_RESULTS_DIR = path.join(DEMO_CWD, 'audit-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'coverage-results');
const COVERAGE_SCRIPT = path.join(
  EXPERIMENT_CLONE_PATH, '.claude', 'skills', 'shaka-perf-coverage', 'coverage-baseline.mts',
);

// Exercises the screenshot-coverage path end to end: the code_coverage stage
// against a DEVELOPMENT bundle (the react19 plugin reads React's debug stacks
// and the bundle's source map, which the production twin-server image lacks),
// then the shaka-perf-coverage skill's `save`, which joins each source's code
// gutters to what a screenshot showed of every element it renders. The
// snapshot it writes — one file per source plus legend.txt — is the tracked
// artifact under integration-tests/snapshots/coverage-results/.
//
// The experiment container is left serving the development bundle, so the
// runner schedules this suite last; the next `servers build` or code sync
// restores the production one.

// Two tests by anchored name (the sabotaged 'Products - Electronics Filter'
// must stay out) and the three sources they render. Both lists are the
// snapshot's identity: widen either and every earlier baseline diff goes stale.
const TEST_FILTER = '^Homepage,^Products List';
const SOURCE_FILES = [
  'components/pages/HomePage.tsx',
  'components/pages/ProductListPage.tsx',
  'components/shared/ProductCard.tsx',
];
const RELEVANT_SOURCES = SOURCE_FILES.map((f) => f.replace(/\./g, '\\.')).join(',');

const PLUGIN_HEADER = /^# source plugin: (\S+) — (\d+) of (\d+) elements located/m;
const CELL = /\b[A-Z]+=(\d+)%/g;

test('audit a development bundle and snapshot screenshot coverage per source @coverage', async () => {
  test.setTimeout(30 * 60 * 1000);

  await stage('Rebuilding the experiment bundle in development mode', () => {
    execSync(
      'yarn shaka-perf servers run-cmd experiment "NODE_ENV=development bin/shakapacker"',
      { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 10 * 60 * 1000 },
    );
  });
  // Production Rails caches the shakapacker manifest in memory
  // (`cache_manifest: true`), so puma keeps serving the old asset names until
  // it restarts. Wait for the port to go dark first, or the new puma fails to
  // bind and dies while the old one is still shutting down.
  await stage('Restarting the experiment server on the new bundle', async () => {
    try { run('yarn shaka-perf servers run-cmd experiment "pkill -f puma || true"'); } catch { /* the pkill can take its own shell down */ }
    const start = Date.now();
    while (portIsResponding(EXPERIMENT_PORT)) {
      if (Date.now() - start > 60_000) throw new Error(`puma on port ${EXPERIMENT_PORT} did not stop within 60s`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    run(`yarn shaka-perf servers run-cmd experiment "${PUMA_CMD} > /tmp/puma.log 2>&1 &"`);
    await waitForPort(EXPERIMENT_PORT);
  });

  if (fs.existsSync(AUDIT_RESULTS_DIR)) fs.rmSync(AUDIT_RESULTS_DIR, { recursive: true, force: true });
  await stage(`Running shaka-perf audit --categories code_coverage over ${TEST_FILTER}`, () => {
    execSync(
      `yarn shaka-perf audit --categories code_coverage --url http://localhost:${EXPERIMENT_PORT} `
      + `--filter ${JSON.stringify(TEST_FILTER)}`,
      { cwd: DEMO_CWD, env, stdio: 'inherit', timeout: 20 * 60 * 1000 },
    );
  });

  const report = readAuditReport(AUDIT_RESULTS_DIR);
  expect([...new Set(report.tests.map((t) => t.name))].sort(), 'the filter must select exactly the two tests')
    .toEqual(['Homepage', 'Products List']);
  const errored = report.tests.filter((t) => t.outcomes.some((o) => o.kind === 'error')).map((t) => t.name);
  expect(errored, 'no test may error').toEqual([]);

  // Every unit's map must locate elements: that is the development build, the
  // react19 plugin, and the source-map fetch working together, independent of
  // `save`. A production bundle writes the same header with 0 located.
  for (const unit of report.tests) {
    const href = unit.outcomes
      .find((o) => o.kind === 'ok' && o.stage === 'code_coverage')?.summary?.visibilityMapHref;
    expect(href, `${unit.name} must have a code_coverage measurement referencing a visibility map`).toBeTruthy();
    const header = PLUGIN_HEADER.exec(fs.readFileSync(path.join(AUDIT_RESULTS_DIR, href!), 'utf-8'));
    expect(header, `${href} must carry the source plugin header`).not.toBeNull();
    expect(header![1], `${href} plugin`).toBe('react19');
    expect(Number(header![2]), `${href} must locate elements`).toBeGreaterThan(0);
  }

  // Run from the demo dir so the script resolves audit-results/ and
  // app/javascript/ relative to it, the way the skill documents.
  const saved = await stage('Saving the coverage snapshot (coverage-baseline.mts save)', () => execFileSync(
    'node', [COVERAGE_SCRIPT, 'save', RELEVANT_SOURCES],
    { cwd: DEMO_CWD, env, encoding: 'utf-8', timeout: 2 * 60 * 1000 },
  ));
  console.log(saved);
  expect(saved, 'save must fill the screenshot column').not.toContain('impossible to estimate');
  const snapshotDir = path.join(DEMO_CWD, /^saved (\S+) /m.exec(saved)![1]);

  const legend = fs.readFileSync(path.join(snapshotDir, 'legend.txt'), 'utf-8');
  const letters = [...legend.matchAll(/^[A-Z]+ = (.+)$/gm)].map((m) => m[1]).sort();
  expect(letters, 'legend must map letters to exactly the two audited tests').toEqual(['Homepage', 'Products List']);
  for (const file of SOURCE_FILES) {
    const text = fs.readFileSync(path.join(snapshotDir, file), 'utf-8');
    expect(text, `${file} must carry code gutters — the bundle must be instrumented`).not.toBe('never loaded\n');
    // Cells sit after the LAST `|` of a line; the source to its left is full of both.
    const shown = text.split('\n')
      .flatMap((line) => [...line.slice(line.lastIndexOf('|') + 1).matchAll(CELL)])
      .map((m) => Number(m[1]))
      .filter((pct) => pct > 0);
    expect(shown.length, `${file} must have at least one element a screenshot showed`).toBeGreaterThan(0);
  }

  // The snapshot IS the tracked artifact, copied as-is so the analyze command
  // can `git diff` it like the logs.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.cpSync(snapshotDir, SNAPSHOT_DIR, { recursive: true });
  loud(`Coverage snapshot written to ${SNAPSHOT_DIR}`);
});
