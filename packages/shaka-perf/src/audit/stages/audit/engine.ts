/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import {
  createLighthouseBenchmark,
  createWorkerLighthouseSamplingPool,
  measureTest,
  type NavigationSample,
  type PhaseSample,
} from '../../../bench/core';
import { lhConfigForViewport } from '../../../bench/core/lighthouse-config';
import { resolvePlaywrightOptions } from '../../../config';
import { ensureLighthousePatchRegistered } from '../../../bench/core/patched-lighthouse/register-patch';
import { writeAccessibilityClientScore } from '../accessibility/client-sidecar';
import { parseAccessibilityScoreStdout } from './accessibility-score';
import type { TestContext } from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { StageFailureError, findFailureMediaName } from '../../../stage/stage-failure';
import { safeReaddir, toPosixRelative } from '../../../pipeline/path-utils';
import { classifyMetric, levelForMetric } from './metrics';
import type { AuditMetric, AuditResult, AuditStageConfig } from './stage';

const execFileAsync = promisify(execFile);

// Standalone vanilla-Lighthouse a11y-score runner (the perf gather mis-times a11y; see its header).
const ACCESSIBILITY_SCORE_RUNNER = path.join(__dirname, 'accessibility-score-runner.mjs');

// Cap concurrent a11y passes - each spawns its own Chrome and audit units run in
// parallel, so without this a wide audit could launch a Chrome per unit.
const A11Y_SCORE_CONCURRENCY = Math.max(1, Math.min(4, os.cpus().length - 1));
let a11yScoreActive = 0;
const a11yScoreWaiters: Array<() => void> = [];
async function withA11yScoreSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (a11yScoreActive >= A11Y_SCORE_CONCURRENCY) {
    await new Promise<void>((resolve) => a11yScoreWaiters.push(resolve));
  }
  a11yScoreActive++;
  try {
    return await fn();
  } finally {
    a11yScoreActive--;
    a11yScoreWaiters.shift()?.();
  }
}

async function measureAccessibilityScore(
  url: string,
  viewport: TestContext['viewport'],
): Promise<number | null> {
  try {
    const { stdout } = await withA11yScoreSlot(() => execFileAsync(process.execPath, [ACCESSIBILITY_SCORE_RUNNER], {
      // Minimal env (NODE_OPTIONS keeps PnP resolution); don't leak the operator's full env to the child.
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
        ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
        A11Y_URL: url,
        A11Y_VIEWPORT: JSON.stringify({
          formFactor: viewport.formFactor,
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
        }),
      },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
    return parseAccessibilityScoreStdout(stdout);
  } catch (err) {
    console.warn(
      chalk.yellow(`[shaka-perf a11y] standard accessibility-score pass failed for ${url}: ${(err as Error).message}`),
    );
    return null;
  }
}

export async function runAuditStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: AuditStageConfig,
): Promise<AuditResult> {
  const artifactsDir = path.join(ctx.runtime.resultsRoot, ctx.testAndViewportId, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  ensureLighthousePatchRegistered();
  // Per-test effective lighthouseConfig (config.audit.lighthouseConfig in an
  // abTest() applies to that test), not the file-level stage config.
  const lhConfig = lhConfigForViewport(ctx.viewport, ctx.config.audit.lighthouseConfig ?? config.lighthouseConfig);
  // Perf-only run: the a11y score comes from measureAccessibilityScore, not this
  // gather. Always keep `performance`; a user override may add categories, not drop it.
  const requestedCategories = lhConfig.onlyCategories?.length ? lhConfig.onlyCategories : [];
  lhConfig.onlyCategories = [...new Set([...requestedCategories, 'performance'])];
  const pool = createWorkerLighthouseSamplingPool<NavigationSample>(workerPool, {
    samplingMode: 'sequential',
  });
  pool.onSampleStart = (_testKey, group, sampleIndex) => {
    console.log(chalk.dim('starting'));
  };

  const benchmark = createLighthouseBenchmark('experiment', ctx.test, {
    viewport: ctx.viewport,
    resultsFolder: artifactsDir,
    lhConfig,
    saveArtifacts: true,
    captureAuditArtifacts: true,
    captureCoverage: true,
    targetUrl: ctx.experimentURL,
    headed: ctx.runtime.headed,
    // Effective launch options (shared.playwrightOptions ← per-test config);
    // the fork maps args/headless onto chrome flags.
    playwrightOptions: resolvePlaywrightOptions(ctx.config, 'audit'),
  });
  let sampleGroups;
  try {
    sampleGroups = await measureTest(
      [benchmark],
      1,
      pool,
      { testKey: `${ctx.testAndViewportId}:audit` },
    );
  } catch (err) {
    // The Lighthouse worker wrote the failure media (a screencast video, or a
    // screenshot when no video was available) directly into artifactsDir
    // (== ctx.artifacts.dir). It stays inlined as a base64 data URI so it
    // survives in the shareable lightweight report.html — small enough per
    // failed test to be worth carrying inline, and the at-a-glance value is
    // high.
    const mediaName = findFailureMediaName(err);
    if (mediaName) {
      try {
        throw new StageFailureError(err, { media: ctx.artifacts.inlineDataUri(mediaName) });
      } catch (inlineErr) {
        if (inlineErr instanceof StageFailureError) throw inlineErr;
        console.warn(chalk.yellow(`failed to inline audit failure media ${mediaName}: ${(inlineErr as Error).message}`));
      }
    }
    throw err;
  }
  console.log(chalk.dim('lighthouse sample done'));
  const sample = sampleGroups.find((group) => group.group === 'experiment')?.samples[0];
  if (!sample) {
    throw new Error(`audit did not collect a Lighthouse sample for ${ctx.viewport.label}`);
  }

  // Persist the a11y score to <id>/accessibility-client.json (report reads phone).
  const accessibilityScore = await measureAccessibilityScore(ctx.experimentURL, ctx.viewport);
  if (accessibilityScore != null) {
    writeAccessibilityClientScore(
      path.join(ctx.runtime.resultsRoot, ctx.testAndViewportId),
      accessibilityScore,
    );
  } else {
    console.warn(chalk.yellow(`[shaka-perf a11y] no accessibility score for ${ctx.testAndViewportId}`));
  }

  const coverageStatementIds = readCoverageStatementIds(artifactsDir);
  mirrorCoverageToNycOutput(artifactsDir, ctx.runtime.resultsRoot, ctx.testAndViewportId);
  const metrics = sample.phases.map(auditMetricForPhase);
  printAuditLevels(ctx, metrics);
  const artifact = await readAuditArtifact({
    perTestDir: artifactsDir,
    reportRoot: ctx.runtime.resultsRoot,
    metrics,
  });
  if (coverageStatementIds) artifact.coverageStatementIds = coverageStatementIds;
  return artifact;
}

function auditMetricForPhase(phase: PhaseSample): AuditMetric {
  const { group } = classifyMetric(phase.phase);
  // run-lighthouse multiplies LH `numericValue` (already in ms) by 1000,
  // so phase.duration for ms-unit phases is in microseconds. Normalize
  // back to ms here so thresholds and the formatter all see the same
  // unit they expect. See bench/__tests__/noise-resilience.test.ts:87
  // for the same correction in the bench path.
  const value = phase.unit === 'ms' ? phase.duration / 1000 : phase.duration;
  const level = levelForMetric(phase.phase, value);
  return {
    label: phase.phase,
    value,
    unit: phase.unit,
    display: formatValue(value, phase.unit),
    group,
    ...(level ? { level } : {}),
  };
}

function formatValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return String(value);
  if (unit === 'ms') return `${Math.round(value)}ms`;
  if (unit === 'KB') return `${Math.round(value)}KB`;
  if (unit === '/100') return `${Math.round(value)}/100`;
  return `${Math.round(value)}${unit}`;
}

function printAuditLevels(ctx: TestContext, metrics: readonly AuditMetric[]): void {
  console.log(chalk.cyan(`${ctx.test.name} · ${ctx.viewport.label} absolute levels`));
  for (const metric of metrics) {
    console.log(`  ${metric.label}: ${metric.display}`);
  }
}

interface ReadAuditArtifactOptions {
  perTestDir: string;
  reportRoot: string;
  metrics: AuditMetric[];
}

async function readAuditArtifact(opts: ReadAuditArtifactOptions): Promise<AuditResult> {
  const files = safeReaddir(opts.perTestDir);
  const experimentLh = files.find((f) => f === 'experiment_lighthouse_report.html') ?? null;
  const artifact: AuditResult = {
    metrics: opts.metrics,
  };

  if (experimentLh) {
    const fullPath = path.join(opts.perTestDir, experimentLh);
    // Reference the LH HTML by relative path (full-report.html sits next to
    // it). The thumbnail stays inlined as a tiny JPEG — it's the preview UI
    // that's still useful at-a-glance, and inlining keeps the lightweight
    // report self-contained for the thumb alone.
    artifact.lighthouseHref = toPosixRelative(opts.reportRoot, fullPath);
    console.log(chalk.dim('LH HTML thumbnail starting'));
    const thumbBuffer = await screenshotLighthouseHtml(fullPath);
    console.log(chalk.dim('LH HTML thumbnail done'));
    if (thumbBuffer) {
      artifact.lighthouseThumbHref = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
    }
  }

  return artifact;
}

const LIGHTHOUSE_THUMB_WIDTH = 320;
const LIGHTHOUSE_THUMB_CAPTURE_WIDTH = 1024;
const LIGHTHOUSE_THUMB_CAPTURE_HEIGHT = 1400;

async function screenshotLighthouseHtml(htmlPath: string): Promise<Buffer | null> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: LIGHTHOUSE_THUMB_CAPTURE_WIDTH, height: LIGHTHOUSE_THUMB_CAPTURE_HEIGHT },
    });
    const page = await context.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
    // Capture at the natural LH layout width (the report doesn't reflow well
    // below ~1000px), viewport-only — fullPage would give a long thin
    // thumbnail; the viewport crop keeps the score circles + overview.
    const shot = await page.screenshot({ type: 'png' });
    return await sharp(shot)
      .resize({ width: LIGHTHOUSE_THUMB_WIDTH })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    console.warn(chalk.yellow(`failed to screenshot Lighthouse HTML at ${htmlPath}: ${(err as Error).message}`));
    return null;
  } finally {
    await browser.close();
  }
}

// Drain `coverage.json` (istanbul shape: `{ [absFile]: { s: { [stmtId]: hit
// count } } }`) into a sorted, unique list of `${absFile}:${stmtId}` keys for
// every executed statement. Returned to the chip pass so duplicate-coverage
// detection can run against the in-memory measurement set without re-reading
// disk. Returns `undefined` (not `[]`) when there's no signal — either the
// file is missing, malformed, or the bundle wasn't instrumented — so the chip
// pass can distinguish "no coverage data" from "ran but executed nothing".
function readCoverageStatementIds(artifactsDir: string): string[] | undefined {
  const src = path.join(artifactsDir, 'coverage.json');
  if (!fs.existsSync(src)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(src, 'utf8'));
  } catch (err) {
    console.warn(
      chalk.yellow(
        `[shaka-perf coverage] failed to parse ${src}: ${(err as Error).message}`,
      ),
    );
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const ids: string[] = [];
  for (const [file, fileCov] of Object.entries(raw as Record<string, unknown>)) {
    if (!fileCov || typeof fileCov !== 'object') continue;
    const hits = (fileCov as { s?: unknown }).s;
    if (!hits || typeof hits !== 'object') continue;
    for (const [stmtId, count] of Object.entries(hits as Record<string, unknown>)) {
      if (typeof count === 'number' && count > 0) {
        ids.push(`${file}:${stmtId}`);
      }
    }
  }
  // Sort so set equality / debugging output is order-stable; the chip pass
  // builds Sets so order doesn't matter for correctness.
  ids.sort();
  return ids;
}

// Each audit run captures one test's coverage as a single coverage.json.
// nyc keys FileCoverage entries by absolute file path and sums hit counts
// per location when merging, so mirroring under a unique per-(test,
// viewport) filename lets nyc aggregate them into one report where any
// statement hit by any test counts as covered.
function mirrorCoverageToNycOutput(artifactsDir: string, resultsRoot: string, key: string): void {
  const src = path.join(artifactsDir, 'coverage.json');
  if (!fs.existsSync(src)) {
    // Audit always opts into coverage (`captureCoverage: true` above); a
    // missing file means the worker couldn't drain `__coverage__`. The worker
    // already logs the specific cause — surface the test/viewport so users
    // can correlate.
    console.warn(
      chalk.yellow(
        `[shaka-perf coverage] no coverage.json for ${key} — see earlier ` +
          `'[shaka-perf coverage]' lines for the cause.`,
      ),
    );
    return;
  }
  const nycDir = path.join(resultsRoot, '.nyc_output');
  fs.mkdirSync(nycDir, { recursive: true });
  const slug = key.replace(/[^a-zA-Z0-9._-]+/g, '_');
  fs.copyFileSync(src, path.join(nycDir, `${slug}.json`));
}
