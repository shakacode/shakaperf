import path from 'node:path';
import * as fs from 'node:fs';
import chalk from 'chalk';
import createLogger from '../util/logger';
import compare from '../util/compare/index';
import { composeEngineErrorPayload } from '../../../compare/engine-error';
import { slugifyForBench } from '../../../compare/harvest/perf';
import type { RuntimeConfig, TestPair } from '../types';
import type Reporter from '../util/Reporter';
import type { Test } from '../util/Reporter';

const logger = createLogger('report');

const PNG_FIELDS = ['reference', 'test', 'pixelmatchDiffImage', 'diffImage', 'errorScreenshot'] as const;
type PngField = typeof PNG_FIELDS[number];

/**
 * Writes per-test report.json files directly under
 * `<htmlReportDir>/visreg-<viewport>/<slug>/`, mirroring the layout perf
 * writes under `<htmlReportDir>/perf-<viewport>/<slug>/`. Each per-test
 * report carries the unified `engineError` / `engineOutput` payload that
 * the compare harvester reads from one shape across both engines.
 *
 * PNGs captured by the engine into `<htmlReportDir>/{control,experiment}_screenshot/`
 * are moved into the per-test dirs as part of this writer; no monolithic
 * intermediate report.json is produced.
 */
function writePerTestReports(config: RuntimeConfig, reporter: Reporter): void {
  const htmlReportDir = toAbsolute(config, config.htmlReportDir);
  fs.mkdirSync(htmlReportDir, { recursive: true });

  const buckets = bucketTests(reporter);

  for (const [key, tests] of buckets) {
    const sep = key.indexOf('\0');
    const slug = key.slice(0, sep);
    const viewport = key.slice(sep + 1);
    const destDir = path.join(htmlReportDir, `visreg-${viewport}`, slug);
    fs.mkdirSync(destDir, { recursive: true });

    const movedTests = tests.map((t) => moveAndRewritePngs(t, destDir));

    const engineErrors: Array<{ selector: string; msg: string }> = [];
    for (const t of movedTests) {
      const msg = (t.pair.error as string | undefined) ?? (t.pair.engineErrorMsg as string | undefined);
      if (msg) engineErrors.push({ selector: String(t.pair.selector ?? '(unknown selector)'), msg });
    }
    const shortMessage = engineErrors.length === 0
      ? null
      : engineErrors.length === 1
        ? engineErrors[0].msg
        : `${engineErrors.length} pair(s) errored`;
    const transcript = engineErrors.length === 0
      ? null
      : engineErrors.map((e) => `── ${e.selector} ──\n${e.msg}`).join('\n\n');

    const perTestReport = {
      ...composeEngineErrorPayload(shortMessage, transcript),
      testSuite: reporter.testSuite,
      tests: movedTests,
    };
    fs.writeFileSync(
      path.join(destDir, 'report.json'),
      JSON.stringify(perTestReport, null, 2),
    );
  }

  // The flat capture dirs are now empty (or hold only PNGs whose pair was
  // skipped/ignored). Either way they're internal scratch; delete so the
  // results tree contains only the per-test layout.
  fs.rmSync(path.join(htmlReportDir, 'control_screenshot'), { recursive: true, force: true });
  fs.rmSync(path.join(htmlReportDir, 'experiment_screenshot'), { recursive: true, force: true });

  logger.log(`Wrote per-test visreg reports under ${htmlReportDir}/visreg-*/`);
}

function bucketTests(reporter: Reporter): Map<string, Test[]> {
  const buckets = new Map<string, Test[]>();
  for (const t of reporter.tests) {
    const label = t.pair.label;
    const viewport = t.pair.viewportLabel;
    if (!label || !viewport) continue;
    const key = `${slugifyForBench(label)}\0${viewport}`;
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
    // them is their parent dir (`control_screenshot/` vs `experiment_screenshot/`).
    // Preserve that dir under destDir so both PNGs land at distinct paths.
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

  writePerTestReports(config, report);

  if (failed) {
    logger.error('*** Mismatch errors found ***');
  }

  return { passed, failed };
}
