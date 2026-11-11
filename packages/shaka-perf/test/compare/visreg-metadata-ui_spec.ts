import { DESKTOP_VIEWPORT } from 'shaka-shared';
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdirSync } from 'node:fs';
import { PHONE_VIEWPORT } from 'shaka-shared';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

jest.setTimeout(60_000);

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="white"/></svg>');

function fixture() {
  const data = runDetailsFixture('compare');
  const test = data.tests[0]!;
  const saved = test.outcomes[0]!;
  test.controlUrl = 'http://new-control.example/';
  test.experimentUrl = 'http://new-experiment.example/';
  test.outcomes = [{
    ...saved,
    stage: 'visreg',
    executionDetails: { ...saved.executionDetails, recoveredAfterRetries: true, taskRetries: 1, taskRetryLimit: 2 },
    measurement: [{
      selector: 'document', controlImage: image, experimentImage: image,
      diffImage: null, misMatchPercentage: 0, savedByRetries: true,
      compareAttempts: 2, compareRetries: 2,
    }],
  }];
  data.tests = [test];
  return data;
}

describe('visual preview metadata', () => {
  let server: Server;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const params = new URL(request.url!, 'http://localhost').searchParams;
      const data = fixture();
      data.meta.reportMode = params.get('mode') === 'self-contained' ? 'self-contained' : 'full';
      if (params.has('mixed')) {
        const test = data.tests[0]!;
        const desktop = test.outcomes[0]!;
        const measurement = desktop.measurement as Record<string, unknown>[];
        test.outcomes.push({
          ...desktop,
          executionDetails: { ...desktop.executionDetails, viewport: PHONE_VIEWPORT, runId: '2026-01-01T00:00:00Z', recoveredAfterRetries: false, taskRetries: 0, taskRetryLimit: 8 },
          measurement: [{ ...measurement[0], compareAttempts: 1, savedByRetries: false }],
        });
      }
      if (params.has('perf')) {
        data.tests[0]!.outcomes[0]!.stage = 'perf-low-noise';
        data.tests[0]!.outcomes[0]!.measurement = {
          controlLighthouseHref: 'data:text/html,<p>saved Lighthouse report</p>',
        };
      }
      const html = renderReportHtml(data);
      response.setHeader('Content-Type', 'text/html');
      response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([1440, 1050, 390])('uses the modal width for target layout at %i px', async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    try {
      await page.goto(url);
      const preview = page.locator('.artifact-card--single');
      expect(await preview.locator('.artifact-card__image-labels').allTextContents()).toEqual(['no diffflakyunstable']);
      await preview.getByRole('button').click();
      const dialog = page.getByRole('dialog');
      const metadata = dialog.locator('.card__metadata');
      const targets = metadata.locator('.card__targets > div');
      const control = (await targets.nth(0).boundingBox())!;
      const experiment = (await targets.nth(1).boundingBox())!;
      if (width >= 1050) {
        expect(Math.abs(control.y - experiment.y)).toBeLessThan(1);
        expect(experiment.x).toBeGreaterThan(control.x + control.width);
      } else {
        expect(experiment.y).toBeGreaterThan(control.y);
      }
      // The modal reuses the latest test metadata and source shown on the card.
      expect(await metadata.locator('.card__targets a').allTextContents()).toEqual([
        'http://new-control.example/', 'http://new-experiment.example/',
      ]);
      if (process.env.SHAKA_SCREENSHOT_DIR) {
        mkdirSync(process.env.SHAKA_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.SHAKA_SCREENSHOT_DIR}/metadata-${width}.png` });
      }
      await metadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await metadata.locator('.card__code').textContent()).toContain("abTest('Homepage'");
      expect(await metadata.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'visual comparisons' }) }).locator('dd').textContent()).toBe('2/3 · matched on retry');
      expect(await metadata.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'error retries' }) }).locator('dd').textContent()).toBe('1/2 · recovered');
      await metadata.getByRole('button', { name: 'logs', exact: true }).click();
      const logs = page.getByRole('dialog', { name: 'measurement logs' });
      await logs.waitFor();
      expect(await logs.locator('.card-logs').textContent()).toContain('Measurement completed');

    } finally {
      await page.close();
    }
  });
  it.each(['full', 'self-contained'])('keeps viewport recovery isolated in %s reports', async (mode) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}?mixed=1&mode=${mode}`);
      const cards = page.locator('.artifact-card--single');
      expect(await cards.count()).toBe(2);
      await cards.nth(0).getByRole('button').click();
      let dialog = page.getByRole('dialog');
      expect(await dialog.textContent()).toContain('1/2 · recovered');
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      await cards.nth(1).getByRole('button').click();
      dialog = page.getByRole('dialog');
      expect(await dialog.locator('dt').allTextContents()).not.toContain('error retries');
      expect(await dialog.locator('dt').allTextContents()).not.toContain('visual comparisons');
      expect(await cards.nth(1).locator('.artifact-card__image-labels').textContent()).toBe('no diff');
    } finally {
      await page.close();
    }
  });

  it('uses shared metadata and execution facts in performance dialogs', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}?perf=1`);
      await page.getByRole('button', { name: 'control lh', exact: true }).click();
      const dialog = page.getByRole('dialog');
      expect(await dialog.locator('.card__metadata').textContent()).toContain('1/2 · recovered');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await dialog.locator('.card__code').textContent()).toContain("abTest('Homepage'");
    } finally {
      await page.close();
    }
  });

});
