/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from '@playwright/test';
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


async function side() {
  let frames: string[] = ['green'];
  let visits = 0;
  let hideStableAfterFirst = false;
  const server = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(204).end(); return; }
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
    url: `http://127.0.0.1:${address.port}`, visits: () => visits,
    reset(next: string[], options: { hideStableAfterFirst?: boolean } = {}) {
      visits = 0;
      frames = next;
      hideStableAfterFirst = options.hideStableAfterFirst ?? false;
    },
    close: () => server.close(),
  };
}

test('desktop measurements preserve perf and reuse only current visreg frames across restarts', async ({ page }, testInfo) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-visreg-measurement-'));
  const [control, experiment] = await Promise.all([side(), side()]);
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
      shared: { controlURL: control.url, experimentURL: experiment.url, viewports: ['desktop'],
        parallelism: 1, retries: 2, retryDelay: 0, playwrightOptions: { browser: 'chromium', waitTimeout: 30000 },
        browserConsole: { failOn: ['error'], allowList: [] } },
      perf: { numberOfMeasurements: 2 }, visreg: { compareRetries: 3, compareRetryDelay: 0, maxNumDiffPixels: 0 },
    };
    fs.writeFileSync(path.join(cwd, 'abtests.config.js'), 'module.exports = ' + JSON.stringify(config));
    const cleanupLog = path.join(cwd, 'cleanups');
    const cli = path.join(repo, 'packages/shaka-perf/dist/cli.js');
    // Observe the actual store operation; delegate every call to its real implementation.
    const observedCli = path.join(cwd, 'compare.cjs');
    fs.writeFileSync(observedCli, `
      const { ArtifactStore } = require(${JSON.stringify(path.join(path.dirname(cli), 'pipeline/artifact-store.js'))});
      const clear = ArtifactStore.prototype.prepareMeasurement;
      ArtifactStore.prototype.prepareMeasurement = function (...args) {
        require('node:fs').appendFileSync(${JSON.stringify(cleanupLog)}, 'clear\\n');
        return clear.apply(this, args);
      };
      require(${JSON.stringify(cli)});
    `);
    async function compare(args: string[], expectedExit = 0) {
      fs.writeFileSync(cleanupLog, '');
      const loader = path.join(repo, '.pnp.loader.mjs');
      const options = [process.env.NODE_OPTIONS, '--require', JSON.stringify(path.join(repo, '.pnp.cjs')),
        '--experimental-loader', JSON.stringify(loader)].filter(Boolean).join(' ');
      let output: string;
      try {
        const completed = await exec(process.execPath, [observedCli, 'compare', ...args], {
          cwd, env: { ...process.env, NODE_OPTIONS: options }, maxBuffer: 16 * 1024 * 1024, timeout: 180000,
        });
        output = completed.stdout;
        expect(expectedExit).toBe(0);
      } catch (err) {
        const failure = err as { code?: number; stdout?: string; stderr?: string };
        output = failure.stdout ?? '';
        if (failure.code !== expectedExit) throw new Error(`${failure.stdout}\n${failure.stderr}`, { cause: err });
      }
      expect(fs.readFileSync(cleanupLog, 'utf8')).toBe(args.includes('--report-only') ? '' : 'clear\n');
      return output;
    }
    const results = path.join(cwd, 'compare-results');
    await compare(['--categories', 'perf']);
    const unit = path.join(results, fs.readdirSync(results).find(name => name.startsWith('frame-desktop-'))!);
    const outcome = (name: string) => JSON.parse(fs.readFileSync(path.join(unit, name + '.json'), 'utf8'));
    const perf = outcome('perf');
    expect(perf.kind).toBe('ok');
    const old = outcome('perf-low-noise');
    expect(old.kind).toBe('ok');
    const artifacts = path.join(unit, 'artifacts');
    const perfFiles = fs.readdirSync(artifacts, { recursive: true, encoding: 'utf8' }).filter(name =>
      fs.statSync(path.join(artifacts, name)).isFile());
    const hashes = () => perfFiles.map(name =>
      createHash('sha256').update(fs.readFileSync(path.join(artifacts, name))).digest('hex'));
    const originalHashes = hashes();
    const visreg = ['--categories', 'visreg'];
    control.reset(['green']); experiment.reset(['green']);
    await compare(visreg);
    expect(experiment.visits()).toBe(1);
    const fresh = outcome('visreg');
    expect(fresh.executionDetails.runId).not.toBe(perf.executionDetails.runId);
    expect(fresh.measurement[0]).toMatchObject({ diffImage: null, visualComparisonCount: 1 });
    async function checkReport() {
      expect(outcome('perf')).toEqual(perf);
      expect(outcome('perf-low-noise')).toEqual(old);
      expect(outcome('visreg')).toEqual(fresh);
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
    await checkReport();
    await compare(['--report-only']);
    await checkReport();

    // The old green experiment frame would match the new green control.
    control.reset(['green']); experiment.reset(['blue']);
    await compare(visreg, 1);
    expect(outcome('visreg').measurement[0].diffImage).toEqual(expect.any(String));

    // First capture red/blue. After the retry crashes, blue/yellow matches
    // only by pairing the restarted control with the initial experiment.
    const hideMatched = { hideStableAfterFirst: true };
    control.reset(['red', 'red', 'blue'], hideMatched);
    experiment.reset(['blue', 'crash', 'yellow'], hideMatched);
    await compare(visreg);
    expect(experiment.visits()).toBe(3);
    const recovered = outcome('visreg');
    expect(recovered.executionDetails.taskRetries).toBe(1);
    expect(recovered.measurement).toEqual([
      expect.objectContaining({ selector: '#frame', diffImage: null, visualComparisonCount: 2, savedByRetries: true }),
      expect.objectContaining({ selector: '#stable', diffImage: null, visualComparisonCount: 1 }),
    ]);

    // Two workers crash before saving their round. On the final worker the
    // distinct control/experiment pool sizes grow from 2/3 to 2/4, 3/4, 4/4.
    // Stop on its second retry, with one local retry still available.
    control.reset(['red', 'lime', 'brown', 'red', 'brown', 'red', 'teal', 'pink']);
    experiment.reset(['blue', 'orange', 'crash', 'purple', 'crash', 'yellow', 'yellow', 'yellow']);
    const log = await compare(visreg, 1);
    expect(log.match(/Retry [123]\/3 for/g)).toEqual([
      'Retry 1/3 for', 'Retry 2/3 for', 'Retry 1/3 for', 'Retry 1/3 for', 'Retry 2/3 for',
    ]);
    expect(experiment.visits()).toBe(8);
    const mismatch = outcome('visreg');
    expect(mismatch.executionDetails.taskRetries).toBe(2);
    expect(mismatch.measurement[0]).toMatchObject({
      selector: '#frame', visualComparisonCount: 6, diffImage: expect.any(String),
    });
    expect(mismatch.measurement[0].visualComparisonLimit).toBeUndefined();
    expect(log).toContain('across 4 control × 4 experiment frames');
    const report = JSON.parse(fs.readFileSync(path.join(results, 'report.json'), 'utf8'));
    expect(report.tests[0].chips).toContainEqual(expect.objectContaining({ tag: 'visual change' }));
  } finally {
    control.close(); experiment.close();
    fs.rmSync(cwd, { force: true, recursive: true });
  }
});
