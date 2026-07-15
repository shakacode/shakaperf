/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import * as fs from 'node:fs';
import chalk from 'chalk';
import createLogger from '../util/logger';
import compare from '../util/compare/index';
import type { RuntimeConfig, TestPair } from '../types';
import type Reporter from '../util/Reporter';
import type { Test } from '../util/Reporter';

const logger = createLogger('report');

const PNG_FIELDS = ['reference', 'test', 'pixelmatchDiffImage', 'diffImage', 'errorScreenshot'] as const;
type PngField = typeof PNG_FIELDS[number];

/**
 * Writes this invocation's report.json into the unit artifacts dir the caller
 * pinned (`paths.unitArtifacts`), mirroring the unified compare per-unit layout.
 *
 * PNGs captured by the engine into the flat `{control,experiment}_screenshot/`
 * dirs are moved in alongside it; no monolithic intermediate report.json is
 * produced. One invocation measures one unit (the compare stage pins a single
 * test and viewport), so every pair the reporter holds belongs in that one dir.
 */
async function writePerTestReports(config: RuntimeConfig, reporter: Reporter): Promise<void> {
  const destDir = config.unitArtifactsDir;
  fs.mkdirSync(destDir, { recursive: true });

  const engineErrors: Array<{ viewport: string; selector: string; msg: string }> = [];
  const movedTests = reporter.tests.map((t) => moveAndRewritePngs(t, destDir));
  for (const t of movedTests) {
    const msg = (t.pair.error as string | undefined) ?? (t.pair.engineErrorMsg as string | undefined);
    if (msg) {
      engineErrors.push({
        viewport: String(t.pair.viewportLabel ?? '(unknown viewport)'),
        selector: String(t.pair.selector ?? '(unknown selector)'),
        msg,
      });
    }
  }

  fs.writeFileSync(
    path.join(destDir, 'report.json'),
    JSON.stringify({ testSuite: reporter.testSuite, tests: movedTests }, null, 2),
  );

  // Flat capture dirs may hold leftover PNGs from sibling parallel
  // invocations or from pairs whose move was skipped. They're scratch;
  // the next run's runner-owned start-of-run wipe clears them. We don't
  // touch them here so we can't accidentally rm another in-flight
  // invocation's pending files.

  logger.log(`Wrote visreg report under ${destDir}`);
  if (engineErrors.length > 0) {
    logger.error(formatEngineErrorTranscript(engineErrors));
    throw new Error(summarizeEngineErrors(engineErrors));
  }
}

function summarizeEngineErrors(errors: readonly { msg: string }[]): string {
  return errors.length === 1 ? errors[0].msg : `${errors.length} pair(s) errored`;
}

function formatEngineErrorTranscript(
  errors: readonly { viewport: string; selector: string; msg: string }[],
): string {
  return errors
    .map((e) => `-- ${e.viewport} / ${e.selector} --\n${e.msg}`)
    .join('\n\n');
}

function moveAndRewritePngs(t: Test, destDir: string): { pair: TestPair; status: string } {
  const pair: TestPair = { ...t.pair };
  for (const field of PNG_FIELDS) {
    const src = (pair as unknown as Record<PngField, unknown>)[field];
    if (typeof src !== 'string' || src.length === 0) continue;
    if (!path.isAbsolute(src)) continue;

    // The engine's filename template doesn't include control/experiment, so
    // `pair.reference` and `pair.test` share a basename — what disambiguates
    // them is their parent dir (`control_screenshots/` vs `experiment_screenshots/`).
    // Preserve that dir under destDir so both PNGs land at distinct paths.
    // (When the engine already wrote under the unit's artifacts dir, src and
    // dest coincide and the rename below is a harmless no-op.)
    const parentName = path.basename(path.dirname(src));
    const relPath = path.join(parentName, path.basename(src));
    const destAbs = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    try {
      fs.renameSync(src, destAbs);
    } catch {
      // Already moved (sibling pair shared the ref PNG) or source missing —
      // harvester resolves under destDir either way.
    }
    (pair as unknown as Record<PngField, unknown>)[field] = relPath;
  }
  return { pair, status: t.status };
}

export interface VisregCompareResult {
  passed: number;
  failed: number;
}

export async function execute(config: RuntimeConfig): Promise<VisregCompareResult> {
  const compareResult = await compare(config);
  if (!compareResult) {
    logger.error('Comparison failed, no report generated.');
    return { passed: 0, failed: 0 };
  }
  const report = compareResult as Reporter;

  const failed = report.failed();
  const passed = report.passed();
  logger.log('Test completed...');
  logger.log(chalk.green(passed + ' Passed'));
  logger.log(chalk[(failed ? 'red' : 'green') as 'red' | 'green'](+failed + ' Failed'));

  await writePerTestReports(config, report);

  if (failed) {
    logger.error('*** Mismatch errors found ***');
  }

  return { passed, failed };
}
