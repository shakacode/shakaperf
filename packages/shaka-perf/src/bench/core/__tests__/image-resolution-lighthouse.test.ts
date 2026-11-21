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
  { source: '/selected.png', mode: 'pending-and-vector' },
])('collects the expected real Lighthouse result for $source ($mode)', async ({ source, mode }) => {
  const script = `
    const { createServer } = require('node:http');
    const { PNG } = require('pngjs');
    const { chromium } = require('playwright');
    const { launch } = require('chrome-launcher');
    const { runPatchedLighthouse } = require(process.argv[1]);
    (async () => {
      const png = PNG.sync.write(new PNG({width: 400, height: 200}));
      const source = ${JSON.stringify(source)};
      const mode = ${JSON.stringify(mode)};
      const requests = [];
      const server = createServer((req, res) => {
        requests.push(req.url);
        if (req.url === '/stalled.png') return;
        if (req.url === '/alias' || req.url === '/intermediate') {
          res.writeHead(302, {Location: req.url === '/alias' ? '/intermediate' : '/selected.png'}); res.end();
        } else if (req.url === '/selected.png') {
          res.writeHead(200, {'Content-Type': 'image/png'}); res.end(png);
        } else if (req.url === '/vector.png') {
          res.writeHead(200, {'Content-Type': 'image/svg+xml'});
          res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');
        } else {
          res.writeHead(200, {'Content-Type': 'text/html'});
          const otherImages = mode === 'pending-and-vector'
            ? '<img id="stalled" src="/stalled.png" width="100" height="100"><img id="vector" src="/vector.png" width="40" height="20">'
            : '';
          res.end('<!doctype html><title>Image test</title><h1>Image test</h1><img id="photo" src="' + source + '" width="300" height="300" style="object-fit:cover">' + otherImages);
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
          ...(mode === 'pending-and-vector' ? {maxWaitForLoad: 1000} : {}),
        };
        const imageResolution = {minRatio: 0.8, maxRatio: 3};
        const result = await runPatchedLighthouse(url, flags, mode === 'disabled' ? {} : {imageResolution});
        console.log('IMAGE_RESULT=' + JSON.stringify({
          result: result.artifacts.ShakaImageResolution,
          audit: result.lhr.audits['shaka-image-resolution'],
          hasPerformance: !!result.lhr.categories.performance,
          hasImages: !!result.lhr.categories['shaka-images'],
          html: result.report.includes('Image resolution'),
          imageRequests: requests.filter(url => url === '/selected.png').length,
          aliasRequests: requests.filter(url => url === '/alias').length,
          intermediateRequests: requests.filter(url => url === '/intermediate').length,
        }));
      } finally {
        if (chrome) await chrome.kill();
        await new Promise(r => server.close(r));
      }
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    '-e', script, resolve(__dirname, '../../../../dist/bench/core/patched-lighthouse/runPatchedLighthouse.js'),
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
  expect(output.result).toEqual({ images: expect.any(Array), undersized: 1, oversized: 0, unknown: mode === 'pending-and-vector' ? 2 : 0 });
  expect(output.result.images.find((image: { label: string }) => image.label === 'img#photo')).toMatchObject({
    src: expect.stringContaining(source),
    fit: 'cover', sourceWidth: 400, sourceHeight: 200,
    requiredWidth: 1200, requiredHeight: 600, status: 'undersized',
  });
  expect(output.audit.score).toBe(0);
  expect(output.audit.displayValue).toContain('Acceptable source/required pixel ratio: 0.8 to 3.');
  expect(output.audit.details.headings).toHaveLength(1);
  expect(output.audit.details.items.find((item: { url: string }) => item.url.includes(source)).subItems.items).toEqual([
    { resolution: 'img#photo · undersized · object-fit: cover' },
    { resolution: 'Source: 400 × 200 px; required: 1200 × 600 px' },
    { resolution: '0.33× required resolution' },
  ]);
  expect(output.hasImages).toBe(true);
  expect(output.html).toBe(true);
  expect(output.imageRequests).toBe(1);
  expect(output.aliasRequests).toBe(source === '/alias' ? 1 : 0);
  expect(output.intermediateRequests).toBe(source === '/alias' ? 1 : 0);
  if (mode === 'pending-and-vector') {
    for (const label of ['img#stalled', 'img#vector']) {
      const image = output.result.images.find((item: { label: string }) => item.label === label);
      expect(image.status).toBe('unknown');
      expect(image.sourceWidth).toBeUndefined();
      expect(image.sourceHeight).toBeUndefined();
    }
  }
}, 100_000);
