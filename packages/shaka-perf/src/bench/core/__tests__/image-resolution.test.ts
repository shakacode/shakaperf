/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { classifyImageSources } from '../image-source-type';
import {
  collectImageResolutionMeasurements,
  evaluateImageResolution,
  imageMeasurementPageHelpers,
  type ImageResolutionMeasurement,
} from '../image-resolution';

const config = { minRatio: 1, maxRatio: 2 };
const measurement = (overrides: Partial<ImageResolutionMeasurement> = {}): ImageResolutionMeasurement => ({
  src: 'https://example.test/selected.png', label: 'img#photo', fit: 'cover',
  boxWidth: 300, boxHeight: 300, naturalWidth: 200, naturalHeight: 100,
  sourceWidth: 400, sourceHeight: 200, devicePixelRatio: 2,
  ...overrides,
});

describe('image resolution evaluation', () => {
  it.each([
    ['fill', 300, 300, 1 / 3],
    ['cover', 600, 300, 1 / 3],
    ['contain', 300, 150, 2 / 3],
    ['none', 200, 100, 1],
    ['scale-down', 200, 100, 1],
  ])('uses the painted object for %s, including the cropped part', (fit, width, height, ratio) => {
    const result = evaluateImageResolution([measurement({ fit })], config);
    expect(result.images[0]).toMatchObject({ paintedWidth: width, paintedHeight: height });
    expect(result.images[0]!.ratio).toBeCloseTo(ratio);
    expect(result.images[0]!.requiredWidth).toBe(width * 2);
    expect(result.images[0]!.status).toBe(ratio < 1 ? 'undersized' : 'sufficient');
  });

  it('uses contain for scale-down when the intrinsic size is larger than the box', () => {
    const result = evaluateImageResolution([measurement({ fit: 'scale-down', boxWidth: 100, boxHeight: 100 })], config);
    expect(result.images[0]).toMatchObject({ paintedWidth: 100, paintedHeight: 50, ratio: 2, status: 'sufficient' });
  });

  it.each([1, 1.25, 3])('uses the current pixel density %s without rounding or capping it', devicePixelRatio => {
    const result = evaluateImageResolution([measurement({ fit: 'none', devicePixelRatio })], config);
    expect(result.images[0]!.ratio).toBeCloseTo(2 / devicePixelRatio);
    expect(result.images[0]!.requiredWidth).toBe(200 * devicePixelRatio);
  });

  it('honors exact configurable bounds and reports over- and undersizing separately', () => {
    const images = [0.79, 0.8, 1.5, 1.51].map(ratio => measurement({
      fit: 'fill', boxWidth: 100, boxHeight: 100, sourceWidth: ratio * 200, sourceHeight: ratio * 200,
    }));
    const result = evaluateImageResolution(images, { minRatio: 0.8, maxRatio: 1.5 });
    expect(result.images.map(image => image.status)).toEqual(['undersized', 'sufficient', 'sufficient', 'oversized']);
    expect(result).toStrictEqual({ images: expect.any(Array), undersized: 1, oversized: 1, unknown: 0 });
  });

  it('keeps unsupported and unavailable measurements unknown instead of passing', () => {
    const result = evaluateImageResolution([
      measurement({ sourceWidth: undefined, sourceHeight: undefined, reason: 'Image is not loaded.' }),
      measurement({ reason: 'CSS transforms are unsupported.' }),
      measurement({ fit: 'unsupported' }),
    ], config);
    expect(result).toMatchObject({ undersized: 0, oversized: 0, unknown: 3 });
    expect(result.images.every(image => image.status === 'unknown')).toBe(true);
  });
});

// Playwright sends source to the page. Include the same helper functions that Lighthouse sends.
function measurePageImages(page: Page): Promise<ImageResolutionMeasurement[]> {
  const helpers = imageMeasurementPageHelpers.map(helper => helper.toString()).join('\n');
  return page.evaluate(`(() => {
    ${helpers}
    return (${collectImageResolutionMeasurements})();
  })()`);
}

describe('current rendered image measurement in Chromium', () => {
  let browser: Browser;
  const png = PNG.sync.write(new PNG({ width: 400, height: 200 }));

  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it.each(['content-box', 'border-box'])('reads the selected 2x bitmap without loading alternatives, and keeps %s precision', async boxSizing => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
    const requests: string[] = [];
    await page.route('https://example.test/**', route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: png });
    });
    try {
      await page.setContent(`
        <picture>
          <source media="(min-width: 2000px)" srcset="https://example.test/wide.png">
          <img id="photo" src="https://example.test/fallback.png"
            srcset="https://example.test/one.png 1x, https://example.test/two.png#display 2x"
            style="width:${300.5 + (boxSizing === 'border-box' ? 40 : 0)}px;height:${300.25 + (boxSizing === 'border-box' ? 40 : 0)}px;box-sizing:${boxSizing};padding:8px;border:12px solid;object-fit:cover">
        </picture>
      `);
      const before = [...requests];
      const measurements = await measurePageImages(page);
      expect(measurements).toHaveLength(1);
      expect(measurements[0]).toMatchObject({
        src: 'https://example.test/two.png#display', sourceWidth: 400, sourceHeight: 200,
        naturalWidth: 200, naturalHeight: 100, boxWidth: 300.5, boxHeight: 300.25, devicePixelRatio: 2,
      });
      const classified = classifyImageSources(measurements, new Set(requests));
      expect(evaluateImageResolution(classified, config).undersized).toBe(1);
      expect(requests).toEqual(before);
      expect(requests).toEqual(['https://example.test/two.png']);
    } finally { await page.close(); }
  });

  it('uses the dimensions of a successfully read bitmap even above 40 megapixels', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" width="100" height="50">`);
      await page.evaluate(() => {
        // Return large dimensions without allocating a 200 MB bitmap in the test.
        window.createImageBitmap = async () => ({ width: 10_000, height: 5_000, close() {} });
      });
      const measurements = await measurePageImages(page);
      expect(evaluateImageResolution(measurements, config).images[0]).toMatchObject({
        sourceWidth: 10_000, sourceHeight: 5_000, status: 'oversized',
      });
    } finally { await page.close(); }
  });

  it('measures the current scale of a paused animation', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          @keyframes grow { from { transform:scale(0.5) } to { transform:scale(1.5) } }
          img { animation:grow 2s linear -1s paused }
        </style>
        <img width="400" height="200" src="data:image/png;base64,${png.toString('base64')}">
      `);
      const { images } = evaluateImageResolution(await measurePageImages(page), config);
      // A negative delay of one second freezes the two-second animation at scale(1).
      expect(images[0]).toMatchObject({
        sourceWidth: 400, sourceHeight: 200, requiredWidth: 400, requiredHeight: 200, status: 'sufficient',
      });
    } finally { await page.close(); }
  });

  it('applies the image and ancestor scales after object-fit and before screen pixel density', async () => {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    try {
      await page.setContent(`
        <div style="transform:scale(2); transform-origin:top left">
          <img width="120" height="120" src="data:image/png;base64,${png.toString('base64')}"
            style="box-sizing:border-box; padding:6px; border:4px solid; object-fit:cover;
              scale:2 0.5; transform:scale(0.75,2); transform-origin:top left">
        </div>
      `);
      const { images } = evaluateImageResolution(await measurePageImages(page), config);
      // Cover paints 200 × 100. The combined CSS scale is 3 × 2, then DPR doubles both dimensions.
      expect(images[0]).toMatchObject({
        requiredWidth: 1200, requiredHeight: 400, status: 'undersized',
      });
    } finally { await page.close(); }
  });

  it('excludes invisible images and retains unsupported, vector and unloaded images as unknown', async () => {
    const page = await browser.newPage();
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>img { width:40px;height:20px }</style>
        <img id="hidden" src="${source}" style="display:none">
        <img id="hidden-by-visibility" src="${source}" style="visibility:hidden">
        <div style="visibility:hidden">
          <img id="inherits-hidden" src="${source}">
          <img id="explicitly-visible" src="${source}" style="visibility:visible">
        </div>
        <img id="offscreen" src="${source}" style="position:absolute;top:3000px">
        <div style="opacity:0"><img id="transparent" src="${source}"></div>
        <div style="transform:scale(2);transform-origin:left top"><img id="transform" src="${source}"></div>
        <img id="rotated" src="${source}" style="transform:rotate(20deg)">
        <div style="zoom:2"><img id="zoom" src="${source}"></div>
        <img id="vector" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'/%3E">
        <img id="unloaded">
        <div id="host"></div>
        <div id="slotted-host"><img id="slotted" src="${source}"></div>
      `);
      await page.evaluate(src => {
        document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML =
          `<img id="shadow" src="${src}" style="width:40px;height:20px">`;
        document.querySelector('#slotted-host')!.attachShadow({ mode: 'open' }).innerHTML =
          '<div style="transform:scale(2);transform-origin:left top"><slot></slot></div>';
      }, source);
      await page.waitForFunction(() => document.querySelector('#host')!.shadowRoot!.querySelector('img')!.complete);
      const measurements = await measurePageImages(page);
      const classified = classifyImageSources(measurements, new Set());
      const result = evaluateImageResolution(classified, config);
      expect(measurements.map(image => image.label).sort()).toEqual([
        'img#explicitly-visible', 'img#rotated', 'img#shadow', 'img#slotted', 'img#transform',
        'img#unloaded', 'img#vector', 'img#zoom',
      ]);
      expect(result).toMatchObject({ unknown: 4, oversized: 4, undersized: 0 });
      for (const label of ['img#transform', 'img#slotted']) {
        expect(result.images.find(image => image.label === label)).toMatchObject({
          requiredWidth: 80, requiredHeight: 40, status: 'oversized',
        });
      }
      for (const label of ['img#rotated', 'img#zoom']) {
        expect(result.images.find(image => image.label === label)?.status).toBe('unknown');
      }
      expect(result.images.find(image => image.label === 'img#shadow')).toMatchObject({ sourceWidth: 400, sourceHeight: 200 });
    } finally { await page.close(); }
  });

  it('uses one snapshot of image positions and sizes before reading any bitmaps', async () => {
    const page = await browser.newPage();
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>img { width:100px; height:50px }</style>
        <img id="first" src="${source}"><img id="second" src="${source}">
      `);
      await page.evaluate(() => {
        const readBitmap = window.createImageBitmap;
        window.createImageBitmap = (async (image: HTMLImageElement) => {
          if (image.id === 'first') {
            document.getElementById('second')!.style.width = '200px';
            document.body.append(image.cloneNode());
          }
          return readBitmap(image);
        }) as typeof createImageBitmap;
      });
      const measurements = await measurePageImages(page);
      expect(measurements.map(image => image.label)).toEqual(['img#first', 'img#second']);
      expect(measurements[1]).toMatchObject({ boxWidth: 100, sourceWidth: 400, sourceHeight: 200 });
    } finally { await page.close(); }
  });

  it('reports an unfinished download as unknown while measuring the ready image', async () => {
    const page = await browser.newPage();
    const pendingUrl = 'https://example.test/pending.png';
    await page.route(pendingUrl, () => {}); // Keep the image request pending throughout collection.
    try {
      await page.setContent(`
        <style>img { width:100px; height:50px }</style>
        <img id="pending" src="${pendingUrl}">
        <img id="ready" src="data:image/png;base64,${png.toString('base64')}">
      `, { waitUntil: 'domcontentloaded' });
      await page.locator('#ready').evaluate(img => (img as HTMLImageElement).decode());
      const measurements = await measurePageImages(page);
      const classified = classifyImageSources(measurements, new Set());
      const { images } = evaluateImageResolution(classified, config);
      expect(images[0]).toMatchObject({ label: 'img#pending', status: 'unknown' });
      expect(images[1]).toMatchObject({ label: 'img#ready', sourceWidth: 400, sourceHeight: 200, status: 'oversized' });
    } finally { await page.close(); }
  });

  it('keeps non-empty image boxes that overlap the viewport, even when clipped or covered', async () => {
    const page = await browser.newPage({ viewport: { width: 300, height: 200 } });
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>body { margin:0 } img { position:absolute; width:100px; height:50px }</style>
        <img id="overlaps-top" src="${source}" style="top:-20px">
        <img id="overlaps-right" src="${source}" style="left:299px">
        <img id="above" src="${source}" style="top:-50px">
        <img id="below" src="${source}" style="top:200px">
        <img id="left" src="${source}" style="left:-100px">
        <img id="right" src="${source}" style="left:300px">
        <img id="empty" src="${source}" style="width:0">
        <div style="position:relative; height:0; overflow:hidden"><img id="clipped" src="${source}"></div>
        <div style="position:fixed; inset:0; background:white"></div>
      `);
      const measurements = await measurePageImages(page);
      expect(measurements.map(image => image.label)).toEqual(['img#overlaps-top', 'img#overlaps-right', 'img#clipped']);
      expect(measurements[0]).toMatchObject({ boxWidth: 100, boxHeight: 50 });
    } finally { await page.close(); }
  });
});

describe('image source classification', () => {
  it('discards bitmap dimensions for SVG and unconfirmed URLs, including URLs that look like a raster image', () => {
    const records = [
      measurement({ src: 'https://example.test/confirmed#fragment' }),
      measurement({ src: 'data:image/png;base64,AAAA' }),
      measurement({ src: 'data:image/svg+xml,<svg/>' }),
      measurement({ src: 'https://example.test/unconfirmed.png' }),
    ];
    const classified = classifyImageSources(records, new Set(['https://example.test/confirmed']));
    const { images } = evaluateImageResolution(classified, config);
    expect(images.map(image => image.status)).toEqual(['undersized', 'undersized', 'unknown', 'unknown']);
    for (const image of images.slice(2)) {
      expect(image.sourceWidth).toBeUndefined();
      expect(image.sourceHeight).toBeUndefined();
    }
  });
});
