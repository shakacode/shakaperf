/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONTROL_PORT, DEMO_CWD, EXPERIMENT_PORT,
  env, loud, stage, startServers, stripAnsi, waitForPort,
} from './helpers';

// A failing visreg side must keep the screenshot taken of its failure. Today
// it does not, and this reproduces that before it is fixed.
//
// Both sides run concurrently in one process, and the first side to reject
// starts tearing the run down while the other may still be capturing. TWO
// independent paths close the page underneath a capture still in flight, and
// closing either one alone leaves the other doing it:
//
//   1. the sibling's own catch calls disposeActiveSidesOnNextTask, which
//      closes every side's context on the next tick (preparedSide.ts)
//   2. Promise.all over the two sides rejects the moment one side does,
//      without waiting for the other, and that rejection unwinds to
//      withPlaywrightBrowser's finally, which closes the whole browser
//      (runCompareAttempts.ts -> runPlaywright.ts)
//
// Either way the capture dies as:
//
//   [shaka-perf failure-screenshot] capture failed: page.screenshot:
//   Target page, context or browser has been closed
//
// The subject is the test the @visreg suite already fails on: global setup
// points its electronics click at a selector that does not exist, so BOTH
// sides time out on the same missing element a moment apart. That is the
// ordinary shape of the bug — a broken selector fails both sides together —
// and it is where the warning first showed up in baseline-visreg.log.
//
// Whether the loser's capture is still running when teardown lands varies run
// to run, so one pass proves nothing. `--burn <n>` runs the test as n
// independent instances with retries zeroed (a retry would mask the very
// flakiness being measured), which turns a sometimes-visible race into a
// measured rate over BURN samples.
//
// Deliberately NOT part of any snapshot suite: tagged @race, which none of the
// tag-driven runner's greps match, so it writes no baseline. It needs the
// containers up and the global-setup sabotage committed, the same
// prerequisites @visreg has. Run it alone:
//
//   yarn test:integration --grep @race
//
// Note it reruns compare in the demo directory, so it overwrites whatever
// demo-ecommerce/compare-results holds from an earlier suite.

const TEST_NAME = 'Products - Electronics Filter';
/** Independent instances per run. Every one is a sample of the race. */
const BURN = 10;
/** What global setup rewrote the electronics click to; both sides time out on it. */
const BROKEN_SELECTOR = 'category-option-electronics-fake-broken-selector';
const RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const OUTPUT_LOG = path.join(DEMO_CWD, 'visreg-failure-screenshot-output.log');
const CAPTURE_FAILED = /\[shaka-perf failure-screenshot\] capture failed/;

function burnInstanceDirs(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter((entry) => /-burn-\d+$/.test(entry))
    .map((entry) => path.join(RESULTS_DIR, entry))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .sort();
}

function failureScreenshotsIn(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => entry.endsWith('-visreg-failure-screenshot.png'))
    .map((entry) => path.basename(entry))
    .sort();
}

test('a failing visreg side keeps its failure screenshot @race', async () => {
  test.setTimeout(30 * 60 * 1000);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  if (fs.existsSync(RESULTS_DIR)) fs.rmSync(RESULTS_DIR, { recursive: true, force: true });

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  await stage(`Burning "${TEST_NAME}" ${BURN} times (visreg)`, () => {
    try {
      stdout = execSync(
        'yarn shaka-perf compare --categories visreg '
        + `--filter ${JSON.stringify(`^${TEST_NAME}$`)} --burn ${BURN}`,
        { cwd: DEMO_CWD, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 25 * 60 * 1000 },
      ).toString();
    } catch (e) {
      const err = e as { status?: number | null; signal?: string | null; stdout?: Buffer; stderr?: Buffer };
      stdout = err.stdout?.toString() ?? '';
      stderr = err.stderr?.toString() ?? '';
      exitCode = err.status ?? -1;
      if (err.signal) throw new Error(`shaka-perf compare was killed by ${err.signal}\n${stderr}`);
    }
  });

  const text = stripAnsi(stdout + '\n' + stderr);
  fs.writeFileSync(OUTPUT_LOG, text);
  loud(`compare output → ${OUTPUT_LOG}`);
  console.log(text.split('\n')
    .filter((l) => /failure-screenshot|Disposing Browser|visreg engine error|task failed/.test(l))
    .join('\n'));

  // Guard the premise: without the sabotage neither side fails, and every
  // assertion below would pass while measuring nothing.
  expect(text, `the electronics click must still point at ${BROKEN_SELECTOR} — `
    + 'global setup injects it; a spec that restored it must not have run before this one')
    .toContain(BROKEN_SELECTOR);
  expect(exitCode, 'both sides time out on the broken selector — compare must exit non-zero').not.toBe(0);

  const instances = burnInstanceDirs();
  expect(instances.length, `--burn ${BURN} must produce ${BURN} result directories`).toBe(BURN);

  // The defect, stated the way the log states it.
  const captureFailures = text.split('\n').filter((l) => CAPTURE_FAILED.test(l));

  // And the artifact those warnings stand in for: both sides failed in every
  // instance, so every instance owes two screenshots.
  const missing = instances
    .map((dir) => ({ instance: path.basename(dir), shots: failureScreenshotsIn(dir) }))
    .filter(({ shots }) => shots.length !== 2);
  console.log(`race hit ${missing.length} of ${instances.length} burn instances`);

  expect(
    captureFailures,
    `no side may lose its failure screenshot to the other side's teardown `
    + `(${captureFailures.length} of ${BURN} instances lost one)`,
  ).toEqual([]);
  expect(
    missing,
    `every burn instance must hold a control AND an experiment failure screenshot`,
  ).toEqual([]);
});
