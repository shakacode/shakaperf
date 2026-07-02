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
import { loadTests } from '../../../config-loader';
import createLogger from '../util/logger';
import compare from '../util/compare/index';
import { unitIdForTest } from '../../../pipeline/unit-id';
import type { RuntimeConfig, TestPair } from '../types';
import type Reporter from '../util/Reporter';
import type { Test } from '../util/Reporter';

const logger = createLogger('report');

const PNG_FIELDS = ['reference', 'test', 'pixelmatchDiffImage', 'diffImage', 'errorScreenshot'] as const;
type PngField = typeof PNG_FIELDS[number];

/**
 * Writes per-test report.json files directly under
 * `<htmlReportDir>/<slug>/artifacts/`, mirroring the unified compare
 * per-unit layout.
 *
 * PNGs captured by the engine into `<htmlReportDir>/{control,experiment}_screenshot/`
 * are moved into the per-test dirs as part of this writer; no monolithic
 * intermediate report.json is produced.
 */
async function writePerTestReports(config: RuntimeConfig, reporter: Reporter): Promise<void> {
  const htmlReportDir = toAbsolute(config, config.htmlReportDir);
  fs.mkdirSync(htmlReportDir, { recursive: true });

  const unitIds = await unitIdsByLabelAndViewport(config);
  const buckets = bucketTests(reporter, unitIds);
  const engineErrors: Array<{ viewport: string; selector: string; msg: string }> = [];

  for (const [key, tests] of buckets) {
    const sep = key.indexOf('\0');
    const slug = key.slice(0, sep);
    const viewport = key.slice(sep + 1);
    const destDir = path.join(htmlReportDir, slug, 'artifacts');
    fs.mkdirSync(destDir, { recursive: true });

    const movedTests = tests.map((t) => moveAndRewritePngs(t, destDir));
    for (const t of movedTests) {
      const msg = (t.pair.error as string | undefined) ?? (t.pair.engineErrorMsg as string | undefined);
      if (msg) {
        engineErrors.push({
          viewport,
          selector: String(t.pair.selector ?? '(unknown selector)'),
          msg,
        });
      }
    }

    const perTestReport = {
      testSuite: reporter.testSuite,
      tests: movedTests,
    };
    fs.writeFileSync(
      path.join(destDir, 'report.json'),
      JSON.stringify(perTestReport, null, 2),
    );
  }

  // Flat capture dirs may hold leftover PNGs from sibling parallel
  // invocations or from pairs whose move was skipped. They're scratch;
  // the next run's runner-owned start-of-run wipe clears them. We don't
  // touch them here so we can't accidentally rm another in-flight
  // invocation's pending files.

  logger.log(`Wrote per-test visreg reports under ${htmlReportDir}/<unit>/artifacts/`);
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

async function unitIdsByLabelAndViewport(config: RuntimeConfig): Promise<Map<string, string>> {
  const tests = await loadTests({
    testPathPattern: config.args.testPathPattern as string | undefined,
    filter: config.args.filter as string | undefined,
    testType: 'visreg',
    log: () => undefined,
  });
  const unitIds = new Map<string, string>();
  for (const test of tests) {
    for (const viewport of config.viewports) {
      const key = `${test.name}\0${viewport.label}`;
      if (!unitIds.has(key)) {
        unitIds.set(key, unitIdForTest(test, viewport.label));
      }
    }
  }
  return unitIds;
}

function bucketTests(reporter: Reporter, unitIds: Map<string, string>): Map<string, Test[]> {
  const buckets = new Map<string, Test[]>();
  for (const t of reporter.tests) {
    const label = t.pair.label;
    const viewport = t.pair.viewportLabel;
    if (!label || !viewport) continue;
    const slug = unitIds.get(`${label}\0${viewport}`);
    if (!slug) continue;
    const key = `${slug}\0${viewport}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }
  return buckets;
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

function toAbsolute(config: RuntimeConfig, p: string): string {
  return path.isAbsolute(p) ? p : path.join(config.projectPath, p);
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
