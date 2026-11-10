/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import {
  collectImageResolutionMeasurements,
  evaluateImageResolution,
  type ImageResolutionMeasurement,
} from '../image-resolution';

const config = { minRatio: 1, maxRatio: 2, failOnUndersized: true };
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
    expect(result.failOnUndersized).toBe(true);
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
    const result = evaluateImageResolution(images, { minRatio: 0.8, maxRatio: 1.5, failOnUndersized: false });
    expect(result.images.map(image => image.status)).toEqual(['undersized', 'sufficient', 'sufficient', 'oversized']);
    expect(result).toMatchObject({ undersized: 1, oversized: 1, unknown: 0, failOnUndersized: false });
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
      const measurements = await page.evaluate(collectImageResolutionMeasurements, ['https://example.test/two.png']);
      expect(measurements).toHaveLength(1);
      expect(measurements[0]).toMatchObject({
        src: 'https://example.test/two.png#display', sourceWidth: 400, sourceHeight: 200,
        naturalWidth: 200, naturalHeight: 100, boxWidth: 300.5, boxHeight: 300.25, devicePixelRatio: 2,
      });
      expect(evaluateImageResolution(measurements, config).undersized).toBe(1);
      expect(requests).toEqual(before);
      expect(requests).toEqual(['https://example.test/two.png']);
    } finally { await page.close(); }
  });

  it('excludes invisible images and retains unsupported, vector and unloaded images as unknown', async () => {
    const page = await browser.newPage();
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>img { width:40px;height:20px }</style>
        <img id="hidden" src="${source}" style="display:none">
        <img id="offscreen" src="${source}" style="position:absolute;top:3000px">
        <div style="opacity:0"><img id="transparent" src="${source}"></div>
        <div style="transform:scale(2);transform-origin:left top"><img id="transform" src="${source}"></div>
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
      const measurements = await page.evaluate(collectImageResolutionMeasurements, []);
      const result = evaluateImageResolution(measurements, config);
      expect(measurements.map(image => image.label)).toEqual([
        'img#transform', 'img#zoom', 'img#vector', 'img#unloaded', 'img#slotted', 'img#shadow',
      ]);
      expect(result).toMatchObject({ unknown: 5, oversized: 1, undersized: 0 });
      expect(result.images.find(image => image.label === 'img#shadow')).toMatchObject({ sourceWidth: 400, sourceHeight: 200 });
    } finally { await page.close(); }
  });

  it('does not silently evaluate an image whose layout changes while its bitmap is read', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" style="width:100px;height:50px">`);
      await page.evaluate(() => {
        const original = window.createImageBitmap;
        window.createImageBitmap = (async (image: HTMLImageElement) => {
          const bitmap = await original(image);
          image.style.width = '200px';
          return bitmap;
        }) as typeof createImageBitmap;
      });
      const measurements = await page.evaluate(collectImageResolutionMeasurements, []);
      expect(evaluateImageResolution(measurements, config)).toMatchObject({ unknown: 1, undersized: 0 });
      expect(measurements[0]!.reason).toContain('changed');
    } finally { await page.close(); }
  });

  it('excludes fully clipped images but evaluates partially clipped images at their full painted size', async () => {
    const page = await browser.newPage();
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>img { width:300px;height:300px;object-fit:cover } .box { position:absolute;left:30px;top:30px }</style>
        <div class="box" style="height:0;overflow:hidden;border:20px solid"><img id="fully-clipped" src="${source}"></div>
        <div class="box" style="width:0;overflow-x:clip"><img id="clipped-x" src="${source}"></div>
        <div class="box" style="height:25px;padding-top:15px;border:10px solid;overflow:hidden"><img id="partial" src="${source}"></div>
        <div class="box" id="clipped-host"><img id="slotted-clipped" src="${source}"></div>
      `);
      await page.evaluate(() => {
        document.querySelector('#clipped-host')!.attachShadow({ mode: 'open' }).innerHTML =
          '<div style="height:0;overflow:hidden"><slot></slot></div>';
      });
      const measurements = await page.evaluate(collectImageResolutionMeasurements, []);
      expect(measurements.map(image => image.label)).toEqual(['img#partial']);
      const result = evaluateImageResolution(measurements, config);
      expect(result).toMatchObject({ undersized: 1, unknown: 0 });
      expect(result.images[0]).toMatchObject({ paintedWidth: 600, paintedHeight: 300, requiredWidth: 600, requiredHeight: 300 });
    } finally { await page.close(); }
  });

  it('keeps visible images when body overflow applies to the viewport or fixed positioning escapes a clip', async () => {
    const page = await browser.newPage();
    const source = `data:image/png;base64,${png.toString('base64')}`;
    try {
      await page.setContent(`
        <style>body { height:0;overflow:hidden;margin:0 }</style>
        <img id="body-visible" src="${source}" style="position:absolute;left:20px;top:20px;width:300px;height:300px">
        <div style="height:0;width:0;overflow:hidden">
          <img id="fixed-visible" src="${source}" style="position:fixed;left:350px;top:20px;width:40px;height:20px">
        </div>
      `);
      expect(await page.evaluate(() => [
        document.elementFromPoint(30, 30)?.id, document.elementFromPoint(360, 30)?.id,
      ])).toEqual(['body-visible', 'fixed-visible']);
      const measurements = await page.evaluate(collectImageResolutionMeasurements, []);
      expect(measurements.map(image => image.label)).toEqual(['img#body-visible', 'img#fixed-visible']);
      expect(evaluateImageResolution(measurements, config).unknown).toBe(0);
    } finally { await page.close(); }
  });
});
