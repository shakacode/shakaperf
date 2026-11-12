import { DESKTOP_VIEWPORT } from 'shaka-shared';
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHONE_VIEWPORT } from 'shaka-shared';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import type { ArtifactPath } from '../../src/pipeline/artifact-store';
import { renderReportHtml, writeReport } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

jest.setTimeout(60_000);

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="white"/></svg>');

function fixture() {
  const data = runDetailsFixture('compare');
  const test = data.tests[0]!;
  const saved = test.outcomes[0]!;
  test.filePath = `ab-tests/${'nested-long-test-directory/'.repeat(8)}carousel.abtest.ts`;
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
  }, {
    ...saved,
    stage: 'perf',
    executionDetails: { ...saved.executionDetails, runId: '2026-10-21T20:54:53.891Z' },
    measurement: { metrics: [] },
    runMetadata: {
      ...saved.runMetadata!,
      measuredAt: '2026-10-21T20:54:53.891Z',
      command: 'shaka-perf compare --categories perf --filter Homepage',
      targets: saved.runMetadata!.targets.map((target) => ({
        ...target,
        commit: { sha: 'abcdef1234567890', message: 'Unrelated newer perf commit', source: 'fixture' },
      })),
    },
  }];
  data.tests = [test];
  return data;
}

describe('visual preview metadata', () => {
  let server: Server;
  let browser: Browser;
  let url: string;
  let data = fixture();
  beforeEach(() => { data = fixture(); });

  beforeAll(async () => {
    server = createServer((request, response) => {
      const params = new URL(request.url!, 'http://localhost').searchParams;
      const responseData = structuredClone(data);
      responseData.meta.reportMode = params.get('mode') === 'self-contained' ? 'self-contained' : 'full';
      if (params.has('mixed')) {
        const test = responseData.tests[0]!;
        const desktop = test.outcomes[0]!;
        const measurement = desktop.measurement as Record<string, unknown>[];
        test.outcomes.push({
          ...desktop,
          executionDetails: { ...desktop.executionDetails, testSourceHref: params.has('missing') ? null : 'data:text/plain;charset=utf-8,' + encodeURIComponent('older phone source <script>window.sourceExecuted=true</script>'), viewport: PHONE_VIEWPORT, runId: '2026-01-01T00:00:00Z', recoveredAfterRetries: false, taskRetries: 0, taskRetryLimit: 8 },
          measurement: [{ ...measurement[0], compareAttempts: 1, savedByRetries: false }],
        });
      }
      if (params.has('perf')) {
        responseData.tests[0]!.outcomes[0]!.stage = 'perf-low-noise';
        responseData.tests[0]!.outcomes[0]!.measurement = {
          controlLighthouseHref: 'data:text/html,<p>saved Lighthouse report</p>',
        };
      }
      const html = renderReportHtml(responseData);
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
      expect(await preview.locator('.artifact-card__image-label').allTextContents()).toEqual(['no diff']);
      await preview.getByRole('button').click();
      const dialog = page.getByRole('dialog');
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const targets = metadata.locator('.card__targets > div');
      const control = (await targets.nth(0).boundingBox())!;
      const experiment = (await targets.nth(1).boundingBox())!;
      if (width >= 1050) {
        expect(Math.abs(control.y - experiment.y)).toBeLessThan(1);
        expect(experiment.x).toBeGreaterThan(control.x + control.width);
      } else {
        expect(experiment.y).toBeGreaterThan(control.y);
      }
      const targetsBox = (await metadata.locator('.card__targets').boundingBox())!;
      const firstFieldsBox = (await metadata.locator('.ui-dialog__meta').first().boundingBox())!;
      const overridesBox = (await metadata.locator('.ui-dialog__meta').last().boundingBox())!;
      const controlsBox = (await metadata.locator('.card__metadata-controls').boundingBox())!;
      expect(firstFieldsBox.y).toBeGreaterThanOrEqual(targetsBox.y + targetsBox.height);
      expect(controlsBox.y).toBeGreaterThanOrEqual(overridesBox.y + overridesBox.height);
      if (width >= 1050) {
        const summary = metadata.locator('summary').first();
        const label = (await summary.locator(':scope > span').first().boundingBox())!;
        const source = (await summary.locator('.card__path').boundingBox())!;
        const logs = (await dialog.locator('.card__actions').getByRole('button', { name: 'logs', exact: true }).boundingBox())!;
        expect(Math.abs(label.y - source.y)).toBeLessThan(3);
        expect(Math.abs(label.y - logs.y)).toBeLessThan(3);
      }
      // Test-level URLs remain shared; source is scoped to this execution.
      expect(await metadata.locator('.card__targets a').allTextContents()).toEqual([
        'http://new-control.example/', 'http://new-experiment.example/',
      ]);
      if (process.env.SHAKA_SCREENSHOT_DIR) {
        mkdirSync(process.env.SHAKA_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.SHAKA_SCREENSHOT_DIR}/metadata-${width}.png` });
      }
      await metadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await metadata.locator('.card__code').textContent()).toContain("abTest('Homepage'");
      await dialog.locator('.card__actions').getByRole('button', { name: 'logs', exact: true }).click();
      const logs = page.getByRole('dialog', { name: 'measurement logs' });
      await logs.waitFor();
      expect(await logs.locator('.card-logs').textContent()).toContain('Measurement completed');

    } finally {
      await page.close();
    }
  });
  it.each(['full', 'self-contained'])('selects card snapshots and scopes dialog source in %s reports', async mode => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}?mixed=1&mode=${mode}`);
      const cardMetadata = page.locator('.card__metadata-row > .card__metadata');
      await cardMetadata.locator('summary').click();
      await cardMetadata.getByRole('button', { name: 'test source', exact: true }).click();
      const selector = cardMetadata.getByRole('combobox', { name: 'Source snapshot' });
      expect(await selector.locator('option').count()).toBe(2);
      await selector.selectOption({ index: 1 });
      await cardMetadata.locator('.card__code').filter({ hasText: 'older phone source' }).waitFor();
      await page.locator('.artifact-card--single').nth(0).getByRole('button').click();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      await dialog.locator('.card__code').filter({ hasText: "abTest('Homepage'" }).waitFor();
      expect(await dialog.getByRole('combobox').count()).toBe(0);
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      await page.locator('.artifact-card--single').nth(1).getByRole('button').click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      await dialog.locator('.card__code').filter({ hasText: 'older phone source <script>' }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { sourceExecuted?: boolean }).sourceExecuted)).toBeUndefined();
      await page.goto(`${url}?mixed=1&missing=1&mode=${mode}`);
      await page.locator('.artifact-card--single').nth(1).getByRole('button').click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await dialog.textContent()).toContain('No source snapshot was captured.');
      expect(await dialog.locator('.card__code').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('opens execution source directly from disk in both report modes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shaka-source-browser-'));
    const page = await browser.newPage();
    try {
      const source = 'saved source — مرحبا <script>window.sourceExecuted=true</script>';
      writeFileSync(join(directory, 'snapshot.ts'), source);
      const data = fixture();
      const outcome = data.tests[0]!.outcomes[0]!;
      outcome.executionDetails = { ...outcome.executionDetails, testSourceHref: 'snapshot.ts' };
      const reports = await writeReport(data, directory);
      for (const report of [reports.fullPath, reports.selfContainedPath]) {
        await page.goto(pathToFileURL(report).href);
        await page.locator('.artifact-card--single').getByRole('button').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'test source', exact: true }).click();
        expect(await dialog.locator('.card__code').textContent()).toBe(source);
        expect(await page.evaluate(() => (window as unknown as { sourceExecuted?: boolean }).sourceExecuted)).toBeUndefined();
      }
    } finally {
      await page.close();
      rmSync(directory, { recursive: true, force: true });
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

  it('does not borrow a newer sibling result for a legacy visual artifact', async () => {
    delete data.tests[0]!.outcomes[0]!.runMetadata;
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.artifact-card--single').getByRole('button').click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      expect(await metadata.getByRole('button', { name: 'command', exact: true }).count()).toBe(0);
      expect(await metadata.locator('.card__measured-at').textContent()).toContain('never measured');
      expect(await metadata.locator('.card__target-commits').allTextContents()).toEqual(['', '']);
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
      expect(await metadata.getByRole('button', { name: 'test source', exact: true }).isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('uses shared scoped metadata and a test-name title for a failure screenshot', async () => {
    const outcome = data.tests[0]!.outcomes[0]!;
    outcome.kind = 'error';
    outcome.error = { message: 'Visual capture failed' };
    outcome.failure = { media: image as ArtifactPath };
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.slot-error__screenshot').click();
      const dialog = page.getByRole('dialog');
      expect(await dialog.locator('.ui-dialog__title').innerText()).toBe('desktop visreg failure screenshot · Homepage');
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toContain('--categories perf,accessibility');
    } finally {
      await page.close();
    }
  });

  it('opens measurement logs with the same shared metadata and test-name title', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.getByRole('button', { name: 'logs', exact: true }).click();
      const dialog = page.getByRole('dialog');
      expect(await dialog.locator('.ui-dialog__title').innerText()).toBe('measurement logs · Homepage');
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(2);
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toBe('shaka-perf compare --categories perf --filter Homepage');
    } finally {
      await page.close();
    }
  });

});
