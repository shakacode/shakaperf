/*
 * Copyright (c) 2026 ShakaCode LLC.
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
import type { ArtifactScope } from '../../../pipeline/artifact-store';
import { safeReaddir } from '../../../pipeline/path-utils';
import { classifyMetric, levelForMetric } from './metrics';
import type { AuditMetric, AuditResult, AuditStageConfig } from './stage';
import { realChromeUsesNativeIdentity } from '../../real-chrome';

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
  const artifactsDir = ctx.artifacts.dir;
  fs.mkdirSync(artifactsDir, { recursive: true });

  ensureLighthousePatchRegistered();
  const realChrome = process.env.SHAKAPERF_REAL_CHROME === '1';
  const lighthouseUserAgentMode = !realChrome
    ? 'default'
    : realChromeUsesNativeIdentity(ctx.viewport.formFactor)
      ? 'native'
      : 'viewport';
  const lhConfig = lhConfigForViewport(
    ctx.viewport,
    ctx.config.audit.lighthouseConfig ?? config.lighthouseConfig,
    lighthouseUserAgentMode,
  );
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
    targetUrl: ctx.experimentURL,
    ...(realChrome
      ? {
        realChrome: {
          headless: process.env.SHAKAPERF_REAL_CHROME_HEADLESS === '1',
        },
      }
      : {}),
    // Effective launch options (shared.playwrightOptions ← per-test config);
    // the fork maps args/headless onto chrome flags.
    headed: ctx.runtime.headed,
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
    // (== ctx.artifacts.dir). Keep the stage payload path-only; report
    // generation inlines it for the self-contained report.
    const mediaName = findFailureMediaName(err);
    if (mediaName) {
      throw new StageFailureError(err, { media: ctx.artifacts.pathFor(mediaName) });
    }
    throw err;
  }
  console.log(chalk.dim('lighthouse sample done'));
  const sample = sampleGroups.find((group) => group.group === 'experiment')?.samples[0];
  if (!sample) {
    throw new Error(`audit did not collect a Lighthouse sample for ${ctx.viewport.label}`);
  }

  // Persist the a11y score to <id>/accessibility-client.json (report reads phone).
  // The standalone score runner cannot share the interactive challenge state
  // from the real-Chrome audit browsers. Omitting the score is safer than
  // publishing a score for a bot-wall interstitial.
  const accessibilityScore = realChrome
    ? null
    : await measureAccessibilityScore(ctx.experimentURL, ctx.viewport);
  if (accessibilityScore != null) {
    writeAccessibilityClientScore(
      path.join(ctx.runtime.resultsRoot, ctx.testAndViewportId),
      accessibilityScore,
    );
  } else {
    console.warn(chalk.yellow(`[shaka-perf a11y] no accessibility score for ${ctx.testAndViewportId}`));
  }

  const metrics = sample.phases.map(auditMetricForPhase);
  printAuditLevels(ctx, metrics);
  return readAuditArtifact({
    artifacts: ctx.artifacts,
    metrics,
  });
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
  artifacts: ArtifactScope;
  metrics: AuditMetric[];
}

async function readAuditArtifact(opts: ReadAuditArtifactOptions): Promise<AuditResult> {
  const files = safeReaddir(opts.artifacts.dir);
  const experimentLh = files.find((f) => f === 'experiment_lighthouse_report.html') ?? null;
  const artifact: AuditResult = {
    metrics: opts.metrics,
  };

  if (experimentLh) {
    const fullPath = path.join(opts.artifacts.dir, experimentLh);
    artifact.lighthouseHref = opts.artifacts.pathFor(experimentLh);
    console.log(chalk.dim('LH HTML thumbnail starting'));
    const thumbBuffer = await screenshotLighthouseHtml(fullPath);
    console.log(chalk.dim('LH HTML thumbnail done'));
    if (thumbBuffer) {
      artifact.lighthouseThumbHref = await opts.artifacts.writeFile(
        LIGHTHOUSE_THUMB_FILENAME,
        thumbBuffer,
      );
    }
  }

  return artifact;
}

const LIGHTHOUSE_THUMB_WIDTH = 320;
const LIGHTHOUSE_THUMB_FILENAME = 'experiment_lighthouse_thumbnail.jpg';
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
