import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import visregRunner from '../../visreg/core/runner';
import type { SharedConfig, VisregConfig } from '../config';
import { slugifyForBench } from '../harvest/perf';
import { composeEngineErrorPayload } from '../engine-error';

/**
 * Subdirectory under `resultsRoot` where the visreg engine writes its
 * monolithic output before we reslice it into per-test dirs. Kept under
 * `.visreg-scratch` (dot prefix) so it's easy to recognise as intermediate
 * state and doesn't collide with the final `visreg-<viewport>/` dirs.
 */
const SCRATCH_SUBDIR = '.visreg-scratch';

export interface VisregBridgeOptions {
  controlURL: string;
  experimentURL: string;
  /**
   * Root of the unified compare-results tree. The bridge creates its own
   * scratch directory under here, drives the visreg engine against it,
   * and then reslices the engine's monolithic report into per-test
   * `visreg-<viewport>/<slug>/report.json` files mirroring the perf layout.
   */
  resultsRoot: string;
  visregConfig: VisregConfig;
  /**
   * Cross-engine knobs (parallelism, retries, retryDelay) that visreg lowers
   * into its legacy runtime-config field names (`asyncCaptureLimit`,
   * `asyncCompareLimit`, `compareRetries`, `compareRetryDelay`). Sourced by
   * the caller from `abtests.config.ts` `shared.*`.
   */
  sharedConfig: SharedConfig;
  testPathPattern?: string;
  filter?: string;
}

/**
 * Invokes the visreg engine (same entry that powers `visreg-compare`) into
 * a scratch subdirectory, then reslices its monolithic report.json into
 * per-(viewport, test) directories so downstream harvesting mirrors perf's
 * layout. Scratch is deleted on success; on failure it's left behind for
 * debugging.
 *
 * Returns without throwing when the engine completes with threshold mismatches
 * — the caller harvests the per-pair status from per-test report.json files.
 * Real engine crashes (browser driver, CDP, missing config) still throw.
 */
export async function invokeVisregEngine(opts: VisregBridgeOptions): Promise<void> {
  const { controlURL, experimentURL, resultsRoot, visregConfig, sharedConfig, testPathPattern, filter } = opts;

  const scratchDir = path.join(resultsRoot, SCRATCH_SUBDIR);
  // Always start the scratch fresh — leftover PNGs from a prior shard would
  // get picked up by the reslicer and attributed to the wrong measurement.
  fs.rmSync(scratchDir, { recursive: true, force: true });
  fs.mkdirSync(scratchDir, { recursive: true });

  const configPath = writeTempVisregConfig(visregConfig, sharedConfig, scratchDir);

  try {
    await visregRunner('compare', {
      config: configPath,
      controlURL,
      experimentURL,
      testPathPattern,
      filter,
    });
    resliceIntoPerTestDirs(scratchDir, resultsRoot);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } finally {
    // Swallow cleanup errors so a failing tmp-file unlink (EPERM/EBUSY on
    // locked filesystems) can't shadow a primary engine error.
    try { fs.rmSync(configPath, { force: true }); } catch { /* noop */ }
  }
}

function writeTempVisregConfig(
  visregConfig: VisregConfig,
  sharedConfig: SharedConfig,
  htmlReportDir: string,
): string {
  const payload = {
    ...visregConfig,
    // Lower the cross-engine `shared.parallelism` + retry policy into the
    // legacy visreg runtime-config field names. `asyncCaptureLimit` bounds
    // concurrent browser captures; `asyncCompareLimit` bounds concurrent
    // pixel comparisons. Both map cleanly onto a single "cpu budget" knob.
    asyncCaptureLimit: sharedConfig.parallelism,
    asyncCompareLimit: sharedConfig.parallelism,
    compareRetries: sharedConfig.retries,
    compareRetryDelay: sharedConfig.retryDelay,
    paths: {
      htmlReport: htmlReportDir,
    },
    report: ['browser'],
  };
  const hash = crypto.randomBytes(6).toString('hex');
  const tempPath = path.join(os.tmpdir(), `shaka-perf-visreg-${hash}.js`);
  const body = `module.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(tempPath, body);
  return tempPath;
}

interface ScratchPair {
  reference?: string;
  test?: string;
  pixelmatchDiffImage?: string | null;
  diffImage?: string | null;
  errorScreenshot?: string | null;
  label?: string;
  viewportLabel?: string;
  // Any other fields on the pair are preserved verbatim when we rewrite.
  [key: string]: unknown;
}

interface ScratchReport {
  testSuite?: string;
  tests?: Array<{ pair: ScratchPair; status?: string }>;
}

/**
 * Read the scratch report.json, bucket entries by (slug, viewportLabel),
 * move the referenced PNGs into the per-test dir, rewrite the paths to be
 * basename-relative, and write one report.json per bucket.
 *
 * PNGs are *moved* (renameSync) because the scratch dir is deleted after;
 * if a pair somehow lacks a file we leave the pair's field as-is and the
 * harvester's `embedAsBase64` returns empty for that image.
 */
function resliceIntoPerTestDirs(scratchDir: string, resultsRoot: string): void {
  const reportPath = path.join(scratchDir, 'report.json');
  if (!fs.existsSync(reportPath)) return;

  let report: ScratchReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ScratchReport;
  } catch {
    return;
  }

  const pngFields = ['reference', 'test', 'pixelmatchDiffImage', 'diffImage', 'errorScreenshot'] as const;
  type PngField = typeof pngFields[number];
  // Bucket key: `${slug}\0${viewport}`. Null byte is safe since slugs are
  // [a-z0-9-] and viewport labels are plain strings without control chars.
  const buckets = new Map<string, Array<{ pair: ScratchPair; status?: string }>>();
  for (const entry of report.tests ?? []) {
    const label = entry.pair.label;
    const viewport = entry.pair.viewportLabel;
    if (!label || !viewport) continue;
    const slug = slugifyForBench(label);
    const key = `${slug}\0${viewport}`;
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  }

  for (const [key, entries] of buckets) {
    const sep = key.indexOf('\0');
    const slug = key.slice(0, sep);
    const viewport = key.slice(sep + 1);
    const destDir = path.join(resultsRoot, `visreg-${viewport}`, slug);
    fs.mkdirSync(destDir, { recursive: true });

    const rewrittenEntries = entries.map(({ pair, status }) => {
      const next: ScratchPair = { ...pair };
      for (const field of pngFields) {
        const src = next[field];
        if (typeof src !== 'string' || src.length === 0) continue;
        const srcAbs = path.isAbsolute(src) ? src : path.join(scratchDir, src);
        const basename = path.basename(srcAbs);
        const destAbs = path.join(destDir, basename);
        try {
          fs.renameSync(srcAbs, destAbs);
          (next as Record<PngField, unknown>)[field] = basename;
        } catch {
          // Missing / already moved (a pair can share a ref PNG with a
          // sibling pair) — leave the field but flip the path to basename
          // so the harvester looks in destDir anyway.
          (next as Record<PngField, unknown>)[field] = basename;
        }
      }
      return { pair: next, status };
    });

    // Aggregate any pair-level error into the unified engineError +
    // engineOutput shape that perf also writes. This is the single
    // place both engines produce a "view logs" payload so the harvester
    // reads from one shape and the UI opens one dialog.
    const pairErrors: Array<{ selector: string; msg: string }> = [];
    for (const { pair } of rewrittenEntries) {
      const msg = (pair.error as string | undefined) ?? (pair.engineErrorMsg as string | undefined);
      if (msg) pairErrors.push({ selector: String(pair.selector ?? '(unknown selector)'), msg });
    }
    const shortMessage = pairErrors.length === 0
      ? null
      : pairErrors.length === 1
        ? pairErrors[0].msg
        : `${pairErrors.length} pair(s) errored`;
    const transcript = pairErrors.length === 0
      ? null
      : pairErrors.map((e) => `── ${e.selector} ──\n${e.msg}`).join('\n\n');
    const engineErrorPayload = composeEngineErrorPayload(shortMessage, transcript);

    const perTestReport = {
      ...engineErrorPayload,
      testSuite: report.testSuite,
      tests: rewrittenEntries,
    };
    fs.writeFileSync(
      path.join(destDir, 'report.json'),
      JSON.stringify(perTestReport, null, 2),
    );
  }
}
