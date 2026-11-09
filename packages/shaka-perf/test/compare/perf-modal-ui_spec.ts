/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { PHONE_VIEWPORT } from 'shaka-shared';
import { renderReportHtml, type ReportOutcome } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';
import { renderSideBySideFramesScript } from '../../src/bench/core/side-by-side-frames';

jest.setTimeout(60_000);

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="white"/></svg>');

function fixture(staleStatistical = false) {
  const data = runDetailsFixture('compare');
  const test = data.tests[0]!;
  const saved = test.outcomes[0]!;
  const statistical: ReportOutcome = {
    ...saved,
    measurement: { ...saved.measurement as object, benchReportHref: '/bench-report.html' },
    runMetadata: { ...saved.runMetadata!, numberOfMeasurements: 7 },
  };
  const lowNoise: ReportOutcome = {
    ...saved,
    stage: 'perf-low-noise',
    measurement: { metrics: [], timelineHref: '/timeline.html', timelinePreviewHref: image, framesHref: '/frames.js',
      controlLighthouseHref: '/lh.html', diffHrefs: [{ label: 'profile diff', href: '/profile.html' }] },
    runMetadata: { ...saved.runMetadata!, numberOfMeasurements: 1,
      throttling: [{ engine: 'Lighthouse', method: 'devtools', cpuSlowdownMultiplier: 2,
        network: { requestLatencyMs: 90 } }] },
  };
  const phone: ReportOutcome = {
    ...statistical,
    viewport: PHONE_VIEWPORT,
    runMetadata: { ...statistical.runMetadata!, viewport: PHONE_VIEWPORT, numberOfMeasurements: 13 },
  };
  if (staleStatistical) statistical.runMetadata!.runId = '2026-10-19T00:00:00Z';
  test.outcomes = [statistical, lowNoise, phone];
  data.tests = [test];
  return data;
}

describe('performance modal metadata', () => {
  let server: Server;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    const html = renderReportHtml(fixture());
    const stale = renderReportHtml(fixture(true));
    const frames = renderSideBySideFramesScript({
      control: [{ timeMs: 0, src: image }], experiment: [{ timeMs: 0, src: image }],
      interactions: { control: [], experiment: [] },
    });
    server = createServer((request, response) => {
      if (request.url === '/frames.js') {
        response.setHeader('Content-Type', 'application/javascript');
        response.end(frames);
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(request.url === '/' ? html : request.url === '/stale' ? stale : '<p>Saved performance artifact</p>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([1440, 390])('keeps selected measurement settings in statistical, timeline and frame modals at %i px', async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      await page.goto(url);
      expect(await page.locator('.card__metadata--card .measurement-settings').count()).toBe(0);
      const statistical = page.locator('[data-stage="perf"] [aria-label="desktop performance"]');
      const lowNoise = page.locator('[data-stage="perf-low-noise"] [aria-label="desktop performance"]');
      const cases = [
        { opener: statistical.getByRole('button', { name: 'bench report', exact: true }), title: 'desktop bench report · Homepage', cpu: '4× CPU', sample: false },
        { opener: lowNoise.getByRole('button', { name: 'timeline', exact: true }), title: 'desktop timeline · Homepage', cpu: '2× CPU', sample: true },
        { opener: lowNoise.getByRole('button', { name: 'play frames', exact: true }), title: 'desktop frames side by side · Homepage', cpu: '2× CPU', sample: true },
        { opener: lowNoise.getByRole('button', { name: 'control lh', exact: true }), title: 'desktop control lh · Homepage', cpu: '2× CPU', sample: true },
        { opener: lowNoise.getByRole('button', { name: 'profile diff', exact: true }), title: 'desktop profile diff · Homepage', cpu: '2× CPU', sample: true },
      ];
      for (const example of cases) {
        await example.opener.click();
        const dialog = page.getByRole('dialog');
        expect(await dialog.locator('.ui-dialog__title').innerText()).toBe(example.title);
        const metadata = dialog.locator('.card__metadata');
        const settings = metadata.locator('.measurement-settings');
        expect(await settings.locator('dt').allTextContents()).toEqual(['number of measurements', 'throttling']);
        expect(await settings.locator('dd').first().innerText()).toBe(example.sample ? '7 per side (1 sample below)' : '7 per side');
        const sample = metadata.locator('.measurement-settings__sample');
        expect(await sample.count()).toBe(example.sample ? 1 : 0);
        if (example.sample) expect(await sample.evaluate(el => el.parentElement?.tagName)).toBe('DD');
        expect(await settings.innerText()).toContain(example.cpu);
        expect(await settings.innerText()).not.toContain('13 per side');
        const targetsBox = (await metadata.locator('.card__targets').boundingBox())!;
        const settingsBox = (await settings.boundingBox())!;
        const controlsBox = (await metadata.locator('.card__metadata-controls').boundingBox())!;
        expect(settingsBox.y).toBeGreaterThanOrEqual(targetsBox.y + targetsBox.height);
        expect(controlsBox.y).toBeGreaterThanOrEqual(settingsBox.y + settingsBox.height);
        expect(await metadata.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await metadata.locator('.card__targets a').first().evaluate((el) => ({
          border: getComputedStyle(el).borderTopWidth,
          transform: getComputedStyle(el).textTransform,
        }))).toEqual({ border: '0px', transform: 'none' });
        expect(await metadata.getByRole('button', { name: 'command', exact: true }).evaluate((el) =>
          getComputedStyle(el).borderTopWidth)).toBe('0px');
        if (example.title.includes('frames side by side')) {
          await dialog.locator('.frame-player').waitFor();
        }
        await dialog.getByRole('button', { name: 'close', exact: true }).click();
      }
      await page.getByRole('button', { name: 'logs', exact: true }).click();
      expect(await page.getByRole('dialog').locator('.measurement-settings').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('does not substitute an unrelated run or the artifact count for missing statistical metadata', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}/stale`);
      const lowNoise = page.locator('[data-stage="perf-low-noise"] [aria-label="desktop performance"]');
      await lowNoise.getByRole('button', { name: 'control lh', exact: true }).click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      expect(await metadata.innerText()).toContain('1 sample below');
      expect(await metadata.innerText()).not.toContain('7 per side');
      expect(await metadata.innerText()).not.toContain('1 per side');
    } finally {
      await page.close();
    }
  });
});
