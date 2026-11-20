/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

// Run Lighthouse's native ESM loader outside Jest's module environment.
it.each([
  { source: '/selected.png#fragment', mode: 'enabled' },
  { source: '/alias', mode: 'enabled' },
  { source: '/selected.png', mode: 'disabled' },
  { source: '/late-alias', mode: 'late' },
])('collects the expected real Lighthouse result for $source ($mode)', async ({ source, mode }) => {
  const script = `
    const { createServer } = require('node:http');
    const { PNG } = require('pngjs');
    const { chromium } = require('playwright');
    const { launch } = require('chrome-launcher');
    const { runPatchedLighthouse, importPatchedLighthouse } = require(process.argv[1]);
    const { imageResolutionLighthouseConfig } = require(process.argv[2]);
    (async () => {
      const png = PNG.sync.write(new PNG({width: 400, height: 200}));
      const source = ${JSON.stringify(source)};
      const mode = ${JSON.stringify(mode)};
      const requests = [];
      let lateResponse;
      let responseDuringCollection = false;
      const server = createServer((req, res) => {
        requests.push(req.url);
        if (req.url === '/late-alias') {
          res.writeHead(302, {Location: '/late.png'}); res.end();
        } else if (req.url === '/late.png') {
          lateResponse = res;
        } else if (req.url === '/stalled.png') {
          // Deliberately never respond: ready images must still be measured.
        } else if (req.url === '/alias' || req.url === '/intermediate') {
          res.writeHead(302, {Location: req.url === '/alias' ? '/intermediate' : '/selected.png'}); res.end();
        } else if (req.url === '/selected.png') {
          res.writeHead(200, {'Content-Type': 'image/png'}); res.end(png);
        } else {
          res.writeHead(200, {'Content-Type': 'text/html'});
          const pending = mode === 'late' ? '<img id="stalled" src="/stalled.png" width="100" height="100">' : '';
          const ready = mode === 'late' ? '<img id="ready" src="data:image/png;base64,' + png.toString('base64') + '" width="100" height="100">' : '';
          res.end('<!doctype html><title>Image test</title><h1>Image test</h1>' + pending + '<img id="photo" src="' + source + '" width="300" height="300" style="object-fit:cover">' + ready);
        }
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      let chrome;
      try {
        chrome = await launch({chromePath: chromium.executablePath(), chromeFlags: ['--headless', '--no-sandbox']});
        const url = 'http://127.0.0.1:' + server.address().port;
        const flags = {
          port: chrome.port, onlyCategories: ['performance'], output: 'html', logLevel: 'error',
          formFactor: 'desktop', screenEmulation: {mobile: false, width: 800, height: 600, deviceScaleFactor: 2},
          throttlingMethod: 'provided', disableStorageReset: true,
        };
        const imageResolution = {minRatio: 0.9, maxRatio: 2, failOnUndersized: true};
        let result;
        if (mode === 'late') {
          const lighthouse = await importPatchedLighthouse();
          const config = imageResolutionLighthouseConfig(lighthouse, imageResolution);
          const gatherer = config.artifacts.find(artifact => artifact.id === 'ShakaImageResolution').gatherer.implementation;
          const collect = gatherer.prototype.stopInstrumentation;
          gatherer.prototype.stopInstrumentation = function(context) {
            setTimeout(() => {
              responseDuringCollection = true;
              lateResponse.writeHead(200, {'Content-Type': 'image/png'});
              lateResponse.end(png);
            }, 100);
            return collect.call(this, context);
          };
          result = await lighthouse.default(url, {...flags, maxWaitForLoad: 1000, onlyCategories: ['performance', 'shaka-images']}, config);
        } else {
          result = await runPatchedLighthouse(url, flags, mode === 'disabled' ? {} : {imageResolution});
        }
        console.log('IMAGE_RESULT=' + JSON.stringify({
          result: result.artifacts.ShakaImageResolution,
          audit: result.lhr.audits['shaka-image-resolution'],
          hasPerformance: !!result.lhr.categories.performance,
          hasImages: !!result.lhr.categories['shaka-images'],
          html: result.report.includes('Image resolution'),
          imageRequests: requests.filter(url => url === '/selected.png').length,
          aliasRequests: requests.filter(url => url === '/alias').length,
          intermediateRequests: requests.filter(url => url === '/intermediate').length,
          lateRequests: requests.filter(url => url === '/late.png').length,
          responseDuringCollection,
        }));
      } finally {
        if (chrome) await chrome.kill();
        await new Promise(r => server.close(r));
      }
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    '-e', script, resolve(__dirname, '../../../../dist/bench/core/patched-lighthouse/runPatchedLighthouse.js'),
    resolve(__dirname, '../../../../dist/bench/core/image-resolution-lighthouse.js'),
  ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  const line = stdout.split('\n').find(value => value.startsWith('IMAGE_RESULT='));
  expect(line).toBeDefined();
  const output = JSON.parse(line!.slice('IMAGE_RESULT='.length));
  expect(output.hasPerformance).toBe(true);
  if (mode === 'disabled') {
    expect(output.result).toBeUndefined();
    expect(output.audit).toBeUndefined();
    expect(output.hasImages).toBe(false);
    return;
  }
  expect(output.result).toMatchObject({ undersized: 1, oversized: 0, unknown: mode === 'late' ? 1 : 0, failOnUndersized: true });
  expect(output.result.images.find((image: { label: string }) => image.label === 'img#photo')).toMatchObject({
    src: expect.stringContaining(source),
    fit: 'cover', sourceWidth: 400, sourceHeight: 200,
    requiredWidth: 1200, requiredHeight: 600, status: 'undersized',
  });
  expect(output.audit.score).toBe(0);
  expect(output.audit.details.headings).toHaveLength(1);
  expect(output.audit.details.items.find((item: { url: string }) => item.url.includes(source)).subItems.items).toEqual([
    { resolution: 'img#photo · undersized · object-fit: cover' },
    { resolution: 'Source: 400 × 200 px; required: 1200 × 600 px' },
    { resolution: '0.33× required resolution' },
  ]);
  expect(output.hasImages).toBe(true);
  expect(output.html).toBe(true);
  expect(output.imageRequests).toBe(mode === 'late' ? 0 : 1);
  expect(output.aliasRequests).toBe(source === '/alias' ? 1 : 0);
  expect(output.intermediateRequests).toBe(source === '/alias' ? 1 : 0);
  if (mode === 'late') {
    expect(output.responseDuringCollection).toBe(true);
    expect(output.lateRequests).toBe(1);
    expect(output.result.images.find((image: { label: string }) => image.label === 'img#ready').status).toBe('sufficient');
  }
}, 100_000);
