/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { stageIds } from '../packages/shaka-perf/src/stage/stage-ids';
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const repo = path.resolve(__dirname, '..');

const test = base.extend<{ measurement: Awaited<ReturnType<typeof createMeasurement>> }>({
  measurement: async ({}, use) => {
    const measurement = await createMeasurement();
    try {
      await use(measurement);
    } finally {
      measurement.close();
    }
  },
});

test('desktop visreg matches immediately and keeps perf viewable after report regeneration', async ({ measurement, page }, testInfo) => {
  const { runCompare, runVisreg, outcome, setFrames, visits, unitDirectory, results } = measurement;
  await runCompare(['--categories', 'perf']);
  const perf = outcome(stageIds.perf);
  expect(perf.kind).toBe('ok');
  const lowNoise = outcome(stageIds.perfLowNoise);
  expect(lowNoise.kind).toBe('ok');
  const artifacts = path.join(unitDirectory(), 'artifacts');
  const perfFiles = fs.readdirSync(artifacts, { recursive: true, encoding: 'utf8' }).filter(name =>
    fs.statSync(path.join(artifacts, name)).isFile());
  const hashes = () => perfFiles.map(name =>
    createHash('sha256').update(fs.readFileSync(path.join(artifacts, name))).digest('hex'));
  const originalHashes = hashes();
  setFrames(['green'], ['green']);
  await runVisreg();
  expect(visits()).toBe(1);
  const fresh = outcome(stageIds.visreg);
  expect(fresh.executionDetails.runId).not.toBe(perf.executionDetails.runId);
  expect(fresh.measurement[0]).toMatchObject({ diffImage: null, visualComparisonCount: 1 });
  async function expectRetainedPerfInReport() {
    expect(outcome(stageIds.perf)).toEqual(perf);
    expect(outcome(stageIds.perfLowNoise)).toEqual(lowNoise);
    expect(outcome(stageIds.visreg)).toEqual(fresh);
    expect(hashes()).toEqual(originalHashes);
    await page.goto(pathToFileURL(path.join(results, 'full-report.html')).href);
    const toggle = page.getByRole('checkbox', { name: 'Show old runs' });
    await toggle.uncheck();
    await expect(page.locator('.artifact-card__media-button').first()).toBeVisible();
    const lighthouse = page.getByRole('button', { name: /control lh/i }).first();
    await expect(lighthouse).toHaveCount(0);
    await toggle.check();
    await page.screenshot({ path: testInfo.outputPath('show-old-runs.png') });
    await lighthouse.click();
    await expect(page.frameLocator('dialog[open] iframe').locator('.lh-root')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('retained-lighthouse.png') });
  }
  await expectRetainedPerfInReport();
  await runCompare(['--report-only']);
  await expectRetainedPerfInReport();
});

test('a matching screenshot from an older measurement cannot hide a new mismatch', async ({ measurement }) => {
  const { setFrames, runVisreg, outcome } = measurement;
  setFrames(['green'], ['green']);
  await runVisreg();

  // Only the previous experiment screenshot matches the new control.
  setFrames(['green'], ['blue']);
  await runVisreg(1);
  expect(outcome(stageIds.visreg).measurement[0].diffImage).toEqual(expect.any(String));
});

test('a worker restart can match frames captured on different attempts', async ({ measurement }) => {
  // Only the restarted control (blue) matches the first experiment (blue).
  // Hide the already-matched stable selector to catch accidental recapture.
  measurement.setFrames(['red', 'red', 'blue'], ['blue', 'crash', 'yellow'], true);
  await measurement.runVisreg();

  const result = measurement.outcome(stageIds.visreg);
  expect(measurement.visits()).toBe(3);
  expect(result.executionDetails.taskRetries).toBe(1);
  expect(result.executionDetails.measurementMetadata.compareAttempts).toBe(3);
  expect(result.measurement).toEqual([
    expect.objectContaining({ selector: '#frame', diffImage: null, visualComparisonCount: 3, savedByRetries: true }),
    expect.objectContaining({ selector: '#stable', diffImage: null, visualComparisonCount: 1 }),
  ]);
});

test('two interrupted rounds count toward the eight rounds started across three workers', async ({ measurement }) => {
  // Each row is one round. A crash happens before the worker saves either frame.
  const rounds = [
    ['red',   'blue'],    // First worker
    ['lime',  'orange'],
    ['brown', 'crash'],
    ['red',   'purple'],  // Second worker
    ['brown', 'crash'],
    ['red',   'yellow'],  // Third worker
    ['teal',  'yellow'],
    ['pink',  'yellow'],  // Four distinct frames on each side end the comparison.
  ] as const;
  measurement.setFrames(rounds.map(([control]) => control), rounds.map(([, experiment]) => experiment));
  const log = await measurement.runVisreg(1);

  const result = measurement.outcome(stageIds.visreg);
  expect(measurement.visits()).toBe(rounds.length);
  expect(result.executionDetails.taskRetries).toBe(2);
  expect(result.executionDetails.measurementMetadata.compareAttempts).toBe(rounds.length);
  expect(result.measurement[0]).toMatchObject({
    selector: '#frame', visualComparisonCount: rounds.length, diffImage: expect.any(String),
  });
  expect(result.measurement[0].visualComparisonLimit).toBeUndefined();
  expect(log).toContain('across 4 control × 4 experiment frames');
  const report = JSON.parse(fs.readFileSync(path.join(measurement.results, 'report.json'), 'utf8'));
  expect(report.tests[0].chips).toContainEqual(expect.objectContaining({ tag: 'visual change' }));
});

test('a measurement records every started round even when all workers fail', async ({ measurement }) => {
  measurement.setFrames(['red'], ['crash']);
  await measurement.runVisreg(1);

  const result = measurement.outcome(stageIds.visreg);
  expect(result.kind).toBe('error');
  expect(result.executionDetails.taskRetries).toBe(2);
  expect(result.executionDetails.measurementMetadata.compareAttempts).toBe(3);
  expect(measurement.visits()).toBe(3);
});

async function startFrameServer() {
  let frames: string[] = ['green'];
  let visits = 0;
  let hideStableAfterFirst = false;
  const server = http.createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(204).end();
      return;
    }
    const frame = frames[Math.min(visits++, frames.length - 1)];
    res.setHeader('Content-Type', 'text/html');
    const stable = hideStableAfterFirst && visits > 1 ? '' : '<div id="stable">Stable</div>';
    res.end(`<title>Fixture</title><body data-frame="${frame}">${stable}
      <div id="frame" style="width:32px;height:32px;background:${frame}"></div></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
  return {
    url: `http://127.0.0.1:${address.port}`,
    visits: () => visits,
    reset(next: string[], options: { hideStableAfterFirst?: boolean } = {}) {
      visits = 0;
      frames = next;
      hideStableAfterFirst = options.hideStableAfterFirst ?? false;
    },
    close: () => server.close(),
  };
}

async function createMeasurement() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-visreg-measurement-'));
  const [control, experiment] = await Promise.all([startFrameServer(), startFrameServer()]);
  function close() {
    control.close();
    experiment.close();
    fs.rmSync(cwd, { force: true, recursive: true });
  }

  try {
    fs.mkdirSync(path.join(cwd, 'node_modules'));
    fs.symlinkSync(path.join(repo, 'packages/shaka-shared'), path.join(cwd, 'node_modules/shaka-shared'));
    fs.mkdirSync(path.join(cwd, 'ab-tests'));
    fs.writeFileSync(path.join(cwd, 'ab-tests/frame.abtest.js'), `
      const { abTest } = require('shaka-shared');
      abTest('Frame', { startingPath: '/', visregSelectors: ['#frame', '#stable'] }, async ({ page, testType }) => {
        if (testType === 'visreg' && await page.locator('body').getAttribute('data-frame') === 'crash')
          throw new Error('Injected visual round failure');
      });
    `);
    const config = {
      shared: {
        controlURL: control.url,
        experimentURL: experiment.url,
        viewports: ['desktop'],
        parallelism: 1,
        retries: 2,
        retryDelay: 0,
        playwrightOptions: { browser: 'chromium', waitTimeout: 30000 },
        browserConsole: { failOn: ['error'], allowList: [] },
      },
      perf: { numberOfMeasurements: 2 },
      visreg: { compareRetries: 3, compareRetryDelay: 0, maxNumDiffPixels: 0 },
    };
    fs.writeFileSync(path.join(cwd, 'abtests.config.js'), 'module.exports = ' + JSON.stringify(config));
    const cleanupLog = path.join(cwd, 'cleanups');
    const cli = path.join(repo, 'packages/shaka-perf/dist/cli.js');
    // Observe the actual store operation; delegate every call to its real implementation.
    const observedCli = path.join(cwd, 'compare.cjs');
    fs.writeFileSync(observedCli, `
      const { ArtifactStore } = require(${JSON.stringify(path.join(path.dirname(cli), 'pipeline/artifact-store.js'))});
      const clear = ArtifactStore.prototype.resetSelectedStageResults;
      ArtifactStore.prototype.resetSelectedStageResults = function (...args) {
        require('node:fs').appendFileSync(${JSON.stringify(cleanupLog)}, 'clear\\n');
        return clear.apply(this, args);
      };
      require(${JSON.stringify(cli)});
    `);
    async function runCompare(args: string[], expectedExit = 0) {
      fs.writeFileSync(cleanupLog, '');
      const loader = path.join(repo, '.pnp.loader.mjs');
      const options = [process.env.NODE_OPTIONS, '--require', JSON.stringify(path.join(repo, '.pnp.cjs')),
        '--experimental-loader', JSON.stringify(loader)].filter(Boolean).join(' ');
      let output: string;
      let exitCode = 0;
      try {
        const completed = await exec(process.execPath, [observedCli, 'compare', ...args], {
          cwd, env: { ...process.env, NODE_OPTIONS: options }, maxBuffer: 16 * 1024 * 1024, timeout: 180000,
        });
        output = completed.stdout;
      } catch (err) {
        const failure = err as { code?: number; stdout?: string; stderr?: string };
        output = failure.stdout ?? '';
        if (typeof failure.code !== 'number') throw err;
        exitCode = failure.code;
        output += failure.stderr ?? '';
      }
      expect(exitCode, output).toBe(expectedExit);
      expect(fs.readFileSync(cleanupLog, 'utf8')).toBe(args.includes('--report-only') ? '' : 'clear\n');
      return output;
    }

    const results = path.join(cwd, 'compare-results');
    function unitDirectory() {
      const unit = fs.readdirSync(results).find(name => name.startsWith('frame-desktop-'));
      if (!unit) throw new Error('Missing desktop measurement directory');
      return path.join(results, unit);
    }

    function outcome(stage: string) {
      return JSON.parse(fs.readFileSync(path.join(unitDirectory(), stage + '.json'), 'utf8'));
    }

    function setFrames(controlFrames: string[], experimentFrames: string[], hideStableAfterFirst = false) {
      control.reset(controlFrames, { hideStableAfterFirst });
      experiment.reset(experimentFrames, { hideStableAfterFirst });
    }

    return {
      results, unitDirectory, outcome, setFrames, runCompare,
      runVisreg: (expectedExit = 0) => runCompare(['--categories', 'visreg'], expectedExit),
      visits: experiment.visits,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
