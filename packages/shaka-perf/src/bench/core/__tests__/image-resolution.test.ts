/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { RunnerResult } from 'lighthouse';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import { checkImageResolution, collectImageSizes, type ImageSize } from '../image-resolution';

const limits = { minRatio: 0.9, maxRatio: 2 };
const image = (overrides: Partial<ImageSize> = {}): ImageSize => ({
  url: 'https://example.test/photo.png',
  sourceWidth: 600, sourceHeight: 600, paintedWidth: 300, paintedHeight: 300, devicePixelRatio: 2,
  box: [0.1, 0.2, 0.3, 0.4],
  ...overrides,
});
const check = (sizes: ImageSize[], devtoolsLog: unknown[] = [], audits = {}) =>
  checkImageResolution(sizes, { artifacts: { DevtoolsLog: devtoolsLog }, lhr: { audits } } as unknown as RunnerResult, 'https://example.test/', limits);
const counts = (sizes: ImageSize[], devtoolsLog?: unknown[]) =>
  Object.fromEntries(check(sizes, devtoolsLog).phases.map(({ phase, duration }) => [phase, duration]));

describe('checkImageResolution', () => {
  it('counts images with too few or too many pixels for the screen', () => {
    // 300 CSS pixels at density 2 need 600 file pixels.
    const sizes = [400, 540, 600, 1200, 2000].map((pixels) => image({ sourceWidth: pixels, sourceHeight: pixels }));
    expect(counts(sizes)).toEqual({ 'undersized-images': 1, 'oversized-images': 1, 'scaled-small-images': 0 });
    expect(check(sizes).phases[0]).toEqual({ phase: 'undersized-images', duration: 1, start: 0, sign: 1, unit: '' });
  });

  it('uses the worse of the two axes', () => {
    expect(counts([image({ sourceWidth: 600, sourceHeight: 300 })])['undersized-images']).toBe(1);
  });

  it('requires a small image to be a whole multiple of its on-screen pixels', () => {
    const small = (source: number, painted: number, devicePixelRatio = 1) => image({
      sourceWidth: source, sourceHeight: source, paintedWidth: painted, paintedHeight: painted, devicePixelRatio,
    });
    expect(counts([small(32, 31)])['scaled-small-images']).toBe(1);
    expect(counts([small(30, 32)])['scaled-small-images']).toBe(1);
    // The same 3% scaling on a large image is not a finding.
    expect(counts([small(320, 310)])).toEqual({ 'undersized-images': 0, 'oversized-images': 0, 'scaled-small-images': 0 });
    expect(counts([small(32, 32), small(64, 32), small(64, 32, 2)])['scaled-small-images']).toBe(0);
  });

  it('skips SVG images, found by response type even behind a redirect', () => {
    const devtoolsLog = [
      { method: 'Network.requestWillBeSent', params: { requestId: '1', request: { url: 'https://example.test/logo' } } },
      { method: 'Network.requestWillBeSent', params: { requestId: '1', request: { url: 'https://cdn.test/logo.svg' } } },
      { method: 'Network.responseReceived', params: { requestId: '1', response: { mimeType: 'image/svg+xml' } } },
    ];
    const tiny = { sourceWidth: 10, sourceHeight: 10 };
    const sizes = [image({ url: 'https://example.test/logo#mark', ...tiny }), image({ url: 'data:image/svg+xml', ...tiny })];
    expect(counts(sizes, devtoolsLog)['undersized-images']).toBe(0);
    expect(counts(sizes)['undersized-images']).toBe(1);
  });

  it('reports one line per image, without the page origin', () => {
    expect(check([image({ sourceWidth: 400, sourceHeight: 400 }), image()]).report).toBe(
      'undersized   400x400 file, 600x600 needed  /photo.png\n' +
      'ok           600x600 file, 600x600 needed  /photo.png\n',
    );
  });

  it('boxes each image that is not ok on the last frame, numbered like the list', () => {
    const sizes = [image(), image({ sourceWidth: 400, sourceHeight: 400, url: 'https://example.test/<b>.png' })];
    const { html } = check(sizes, [], { 'final-screenshot': { details: { type: 'screenshot', data: 'data:image/jpeg;base64,AA' } } });
    expect(html).toContain(
      '<img src="data:image/jpeg;base64,AA" alt="">' +
      '<div class="undersized" style="left:10.00%;top:20.00%;width:30.00%;height:40.00%"><b>2</b></div></div>',
    );
    expect(html).toContain('<li class="undersized">undersized   400x400 file, 600x600 needed  /&lt;b&gt;.png</li>');
    // Without a frame the page is the list alone.
    expect(check(sizes).html).not.toContain('class="screen"');
  });
});

describe('collectImageSizes', () => {
  const png = PNG.sync.write(new PNG({ width: 400, height: 200 }));
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  const sizesOf = async (html: string) => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
    try {
      await page.route('https://example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
      await page.setContent(html);
      const sizes = await collectImageSizes(page);
      const marks = await page.evaluate(() => performance.getEntriesByType('mark').map((mark) => mark.name));
      return { sizes, marks };
    } finally {
      await page.close();
    }
  };

  it('measures what each visible image covers after object-fit, between two marks', async () => {
    const src = `data:image/png;base64,${png.toString('base64')}`;
    const { sizes, marks } = await sizesOf(`
      <img src="${src}" style="width:300px;height:300px">
      <img src="${src}" style="width:300px;height:300px;object-fit:cover;padding:8px;border:2px solid">
      <img src="${src}" style="width:300px;height:300px;object-fit:contain;transform:scale(0.5)">
      <img src="${src}" style="width:300px;height:300px;visibility:hidden">
      <img src="${src}" style="position:absolute;top:5000px;width:300px;height:300px">
    `);
    expect(sizes.map(({ box, ...size }) => size)).toEqual([
      { url: 'data:image/png', sourceWidth: 400, sourceHeight: 200, paintedWidth: 300, paintedHeight: 300, devicePixelRatio: 2 },
      { url: 'data:image/png', sourceWidth: 400, sourceHeight: 200, paintedWidth: 600, paintedHeight: 300, devicePixelRatio: 2 },
      { url: 'data:image/png', sourceWidth: 400, sourceHeight: 200, paintedWidth: 150, paintedHeight: 75, devicePixelRatio: 2 },
    ]);
    expect(marks).toEqual(['shaka-perf-image-sizes-start', 'shaka-perf-image-sizes-end']);
  });

  it('reads the file size of the srcset candidate the browser chose', async () => {
    const { sizes } = await sizesOf(`
      <img src="https://example.test/one.png" style="width:200px;height:100px"
        srcset="https://example.test/one.png 1x, https://example.test/two.png 2x">
      <picture>
        <source srcset="https://example.test/wide.png 400w" sizes="100px">
        <img src="https://example.test/fallback.png" style="width:100px;height:50px">
      </picture>
    `);
    expect(sizes.map(({ url, sourceWidth, sourceHeight }) => ({ url, sourceWidth, sourceHeight }))).toEqual([
      { url: 'https://example.test/two.png', sourceWidth: 400, sourceHeight: 200 },
      { url: 'https://example.test/wide.png', sourceWidth: 400, sourceHeight: 200 },
    ]);
  });

  it('reports where each image is on screen, as fractions of the window', async () => {
    const { sizes } = await sizesOf(
      '<img src="https://example.test/one.png" style="position:absolute;left:200px;top:150px;width:400px;height:300px">',
    );
    expect(sizes[0].box).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  it('returns nothing, without throwing, when the page is gone', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await browser.newPage();
    await page.close();
    expect(await collectImageSizes(page)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
