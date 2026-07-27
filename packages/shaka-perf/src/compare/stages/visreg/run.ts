/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import chalk from 'chalk';
import visregRunner from '../../../visreg/core/runner';
import { resolvePlaywrightOptions } from '../../../config';
import type { VisregConfig, Viewport } from '../../../config';
import type { TestContext } from '../../../stage/stage';
import { StageFailureError } from '../../../stage/stage-failure';
import {
  exactTestNameFilter,
  testPathPatternForSingleTest,
} from '../shared/runtime';
import type { VisregResult, VisregStageConfig } from '../visreg';
import { readVisregArtifacts } from './artifacts';

const SINGLE_UNIT_ENGINE_PARALLELISM = 1;

export async function runVisregUnit(
  ctx: TestContext,
  stageConfig: VisregStageConfig,
): Promise<VisregResult> {
  console.log(
    'Loading every test page on both the control server and the experiment server, taking a screenshot of each once the page has settled, and comparing the two screenshots pixel-by-pixel. ' +
    'A test fails when the two sides look visibly different. ' +
    'This is how a code change that does not break anything functionally still gets caught when it accidentally moves a button, shifts a layout, or changes a color.',
  );

  const { testPathPattern, ...visregConfig } = {
    ...stageConfig,
    // Write the effective comparison tuning (already merged into ctx.config) into
    // the temp config so the engine reads it straight, with no merge of its own.
    mismatchThreshold: ctx.config.visreg.mismatchThreshold,
    maxNumDiffPixels: ctx.config.visreg.maxNumDiffPixels,
    comparePixelmatchThreshold: ctx.config.visreg.comparePixelmatchThreshold,
    resembleOutputOptions: ctx.config.visreg.resembleOutputOptions,
    // Best-of-N is per-unit work, so the per-test effective values apply —
    // except under --burn, which replaces retries everywhere: a burn
    // instance's raw outcome IS the measurement, so best-of-N is zeroed.
    compareRetries: ctx.runtime.burn != null ? 0 : ctx.config.visreg.compareRetries,
    compareRetryDelay: ctx.config.visreg.compareRetryDelay,
    viewports: [ctx.viewport],
    // Effective launch options (shared.playwrightOptions ← visreg override ←
    // per-test config), resolved here so the engine reads them straight.
    // `--headed` overrides headless on top so the Playwright browser is
    // visible too — matching the Lighthouse stages.
    playwrightOptions: {
      ...resolvePlaywrightOptions(ctx.config, 'visreg'),
      ...(ctx.runtime.headed ? { headless: false } : {}),
    },
  };

  // Where this unit's artifacts go, straight from the framework — it already
  // resolved the dir for this test, viewport and `--burn` instance. Never
  // rebuild the path: doing so is what let burn drift the engine's output away
  // from where we read it back.
  const unitArtifactsDir = ctx.artifacts.dir;
  const configPath = writeTempVisregConfig(visregConfig, unitArtifactsDir);

  const startedAt = Date.now();
  try {
    await visregRunner({
      config: configPath,
      controlURL: ctx.controlURL,
      experimentURL: ctx.experimentURL,
      stageUnitUrls: { controlURL: ctx.controlURL, experimentURL: ctx.experimentURL },
      testPathPattern: testPathPatternForSingleTest(ctx.test, testPathPattern),
      filter: exactTestNameFilter(ctx.test),
    });
    const artifactSet = await readVisregArtifacts({
      artifactsDir: unitArtifactsDir,
      viewport: ctx.viewport,
    });
    if (!artifactSet) {
      throw new Error(`visreg did not produce artifacts for ${ctx.viewport.label}`);
    }
    return artifactSet.artifacts;
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.error(chalk.red(`visreg engine error: ${message}`));
    // Visreg writes per-scenario screenshots into `{control,experiment}_
    // screenshot/` under the results root as it runs. If the engine threw
    // before producing artifacts, the most recent of those is the closest
    // approximation of "what the browser saw before tearing down." Pick
    // the newest PNG written since this unit started so we don't pull in
    // a stale screenshot from a previous test.
    const captured = await captureVisregFailureScreenshot(ctx, unitArtifactsDir, startedAt);
    if (captured) {
      throw new StageFailureError(err, { media: captured });
    }
    throw err;
  } finally {
    try { fs.rmSync(configPath, { force: true }); } catch { /* noop */ }
  }
}

async function captureVisregFailureScreenshot(
  ctx: TestContext,
  unitArtifactsDir: string,
  sinceMs: number,
): Promise<string | undefined> {
  const candidates = [
    path.join(unitArtifactsDir, 'experiment_screenshots'),
    path.join(unitArtifactsDir, 'control_screenshots'),
  ];
  let best: { path: string; mtimeMs: number } | undefined;
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    walkPngs(root, (filePath, mtimeMs) => {
      if (mtimeMs < sinceMs) return;
      if (!best || mtimeMs > best.mtimeMs) best = { path: filePath, mtimeMs };
    });
  }
  if (!best) return undefined;
  try {
    const filename = 'failure-screenshot.png';
    await ctx.artifacts.writeFile(filename, fs.readFileSync(best.path));
    // Inline as base64 data URI — the report shell is a self-contained
    // HTML and can't resolve relative artifact paths.
    return ctx.artifacts.inlineDataUri(filename);
  } catch (copyErr) {
    console.warn(
      chalk.yellow(`failed to copy visreg failure screenshot ${best.path}: ${(copyErr as Error).message}`),
    );
    return undefined;
  }
}

function walkPngs(root: string, visit: (filePath: string, mtimeMs: number) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkPngs(abs, visit);
    } else if (entry.isFile() && abs.toLowerCase().endsWith('.png')) {
      try {
        visit(abs, fs.statSync(abs).mtimeMs);
      } catch {
        /* ignore unreadable */
      }
    }
  }
}

function writeTempVisregConfig(
  visregConfig: Omit<VisregConfig, 'viewports'> & { viewports: Viewport[] },
  unitArtifactsDir: string,
): string {
  const payload = {
    ...visregConfig,
    asyncCaptureLimit: SINGLE_UNIT_ENGINE_PARALLELISM,
    asyncCompareLimit: SINGLE_UNIT_ENGINE_PARALLELISM,
    // The one output location the engine gets: everything it writes goes under
    // this unit's artifacts dir, so the runner's generic per-test wipe (rmSync
    // of the unit dir) clears it — no visreg-specific cleanup anywhere. We read
    // the results back from here (readVisregArtifacts); the engine owns the
    // layout beneath it.
    paths: { artifacts: unitArtifactsDir },
  };
  const hash = crypto.randomBytes(6).toString('hex');
  const tempPath = path.join(os.tmpdir(), `shaka-perf-visreg-${hash}.js`);
  const body = `module.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(tempPath, body);
  return tempPath;
}
