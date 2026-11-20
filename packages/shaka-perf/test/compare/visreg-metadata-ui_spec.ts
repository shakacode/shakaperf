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
import { renderSideBySideFramesScript } from '../../src/bench/core/side-by-side-frames';
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
      visualComparisonCount: 2, visualComparisonLimit: 3,
    }],
  }, {
    ...saved,
    stage: 'perf',
    executionDetails: { ...saved.executionDetails, runId: '2026-10-21T20:54:53.891Z', command: 'shaka-perf compare --categories perf --filter Homepage', measurementMetadata: {
      ...saved.executionDetails.measurementMetadata!,
      measuredAt: '2026-10-21T20:54:53.891Z',
      targets: saved.executionDetails.measurementMetadata!.targets.map((target) => ({
        ...target,
        commit: { sha: 'abcdef1234567890', message: 'Unrelated newer perf commit', source: 'fixture' },
      })),
    } },
    measurement: { metrics: [] },
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
        const phoneRunId = '2026-10-22T00:00:00Z';
        const phoneSource = 'newer phone source <script>window.sourceExecuted=true</script>';
        const phone = {
          ...desktop,
          executionDetails: {
            ...desktop.executionDetails, measurementMetadata: { ...desktop.executionDetails.measurementMetadata!, measuredAt: '2026-01-01T00:00:00Z' }, runId: phoneRunId, command: 'shaka-perf compare --viewport phone', viewport: PHONE_VIEWPORT,
            testSourceHref: params.has('missing') ? null : 'data:text/plain;charset=utf-8,' + encodeURIComponent(phoneSource),
            recoveredAfterRetries: false, taskRetries: 0, taskRetryLimit: 8,
          },
          measurement: [{ ...measurement[0], visualComparisonCount: 1, savedByRetries: false }],
        };
        test.outcomes = [desktop, phone, {
          kind: 'skipped', stage: 'perf', reason: 'Not selected',
          executionDetails: { ...desktop.executionDetails, measurementMetadata: undefined, command: 'skipped invocation', runId: '2026-10-23T00:00:00Z', testSourceHref: null },
        }];
      }
      if (params.has('perf')) {
        responseData.tests[0]!.outcomes[0]!.stage = 'perf-low-noise';
        responseData.tests[0]!.outcomes[0]!.measurement = {
          controlLighthouseHref: 'data:text/html,<p>saved Lighthouse report</p>',
          framesHref: 'data:text/javascript,' + encodeURIComponent(renderSideBySideFramesScript({
            control: [{ timeMs: 0, src: image }], experiment: [{ timeMs: 0, src: image }],
            interactions: { control: [], experiment: [] },
          })),
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
        expect(Math.abs(label.y - source.y)).toBeLessThan(3);
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
      expect(await dialog.getByRole('button', { name: 'logs', exact: true }).count()).toBe(0);
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      await page.getByRole('button', { name: 'logs', exact: true }).click();
      const logs = page.getByRole('dialog', { name: 'measurement logs' });
      await logs.waitFor();
      expect(await logs.getByRole('button', { name: 'logs', exact: true }).count()).toBe(0);
      expect(await logs.locator('.card-logs').textContent()).toContain('Measurement completed');

    } finally {
      await page.close();
    }
  });
  it.each(['full', 'self-contained'])('shows the latest measured card source and each preview’s own source in %s reports', async mode => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}?mixed=1&mode=${mode}`);
      const cardMetadata = page.locator('.card__metadata-row > .card__metadata');
      await cardMetadata.locator('summary').click();
      await cardMetadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await cardMetadata.getByLabel('Latest command').inputValue()).toBe('shaka-perf compare --viewport phone');
      await cardMetadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await cardMetadata.getByRole('combobox').count()).toBe(0);
      await cardMetadata.locator('.card__code').filter({ hasText: 'newer phone source' }).waitFor();
      await page.locator('.artifact-card--single').nth(0).getByRole('button').click();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      await dialog.locator('.card__code').filter({ hasText: "abTest('Homepage'" }).waitFor();
      expect(await dialog.getByRole('combobox').count()).toBe(0);
      expect(await dialog.getByRole('button', { name: 'logs', exact: true }).count()).toBe(0);
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      await page.getByRole('button', { name: 'logs', exact: true }).click();
      const logs = page.getByRole('dialog', { name: 'measurement logs' });
      await logs.getByRole('button', { name: 'command', exact: true }).click();
      expect(await logs.getByLabel('Latest command').inputValue()).toBe('shaka-perf compare --viewport phone');
      await logs.getByRole('button', { name: 'test source', exact: true }).click();
      await logs.locator('.card__code').filter({ hasText: 'newer phone source' }).waitFor();
      await logs.getByRole('button', { name: 'close', exact: true }).click();
      await page.locator('.artifact-card--single').nth(1).getByRole('button').click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      await dialog.locator('.card__code').filter({ hasText: 'newer phone source <script>' }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { sourceExecuted?: boolean }).sourceExecuted)).toBeUndefined();
      await page.goto(`${url}?mixed=1&missing=1&mode=${mode}`);
      await cardMetadata.locator('summary').click();
      await cardMetadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await cardMetadata.textContent()).toContain('No source snapshot was captured.');
      await page.locator('.artifact-card--single').nth(1).getByRole('button').click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await dialog.textContent()).toContain('No source snapshot was captured.');
      expect(await dialog.locator('.card__code').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('uses the clicked card and selector for metadata and restores focus on Escape', async () => {
    const second = structuredClone(data.tests[0]!);
    second.id = 'checkout';
    second.name = 'Checkout';
    second.filePath = 'ab-tests/checkout.abtest.ts';
    second.controlUrl = 'https://checkout.example/control';
    second.experimentUrl = 'https://checkout.example/experiment';
    second.viewportArtifactPaths = [{ viewport: 'desktop', path: 'results/checkout/desktop' }];
    second.outcomes.forEach(outcome => { delete outcome.logs; });
    const outcome = second.outcomes[0]!;
    const [image] = outcome.measurement as Record<string, unknown>[];
    outcome.measurement = ['#header', '#footer'].map(selector => ({ ...image, selector }));
    data.tests.push(second);

    const page = await browser.newPage();
    try {
      await page.goto(url);
      const card = page.locator('[data-report-test-id="checkout"]');
      expect(await card.getByRole('button', { name: 'logs', exact: true }).count()).toBe(0);
      for (const selector of ['#header', '#footer']) {
        const trigger = card.locator('.artifact-card--single').filter({ hasText: selector }).getByRole('button');
        await trigger.click();
        const dialog = page.getByRole('dialog');
        expect(await dialog.locator('.ui-dialog__title').textContent()).toContain(selector + ' · Checkout');
        expect(await dialog.locator('.card__path').textContent()).toBe(second.filePath);
        expect(await dialog.locator('.card__targets a').allTextContents()).toEqual([second.controlUrl, second.experimentUrl]);
        expect(await dialog.locator('dt').filter({ hasText: /^selector$/ }).locator('..').locator('dd').textContent()).toBe(selector);
        await dialog.getByRole('button', { name: 'artifact paths' }).click();
        expect(await dialog.locator('.card__code').textContent()).toContain('results/checkout/desktop');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        expect(await trigger.evaluate(button => button === document.activeElement)).toBe(true);
      }
    } finally {
      await page.close();
    }
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

  it('uses the frame recording’s execution when opening the custom player', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}?perf=1`);
      await page.getByRole('button', { name: 'play frames' }).click();
      const dialog = page.getByRole('dialog', { name: 'frames side by side · Homepage' });
      await dialog.getByRole('slider', { name: 'time' }).waitFor();
      expect(await dialog.getByRole('button', { name: 'logs', exact: true }).count()).toBe(0);
      await dialog.getByRole('button', { name: 'command', exact: true }).click();
      expect(await dialog.getByLabel('Latest command').inputValue()).toContain('--categories perf,accessibility');
      expect(await dialog.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the older phone run’s metadata after a newer desktop run', async () => {
    const phone = data.tests[0]!.outcomes[0]!;
    phone.executionDetails = {
      ...phone.executionDetails, viewport: PHONE_VIEWPORT, command: 'shaka-perf compare --viewport phone',
      testSourceHref: 'data:text/plain,older%20phone%20source',
    };
    const page = await browser.newPage();
    try {
      await page.clock.setFixedTime(new Date('2026-10-22T20:54:53.891Z'));
      await page.goto(url);
      await page.locator('.artifact-card--single').getByRole('button').click();
      const panel = page.getByRole('dialog').locator('.card__metadata');
      expect(await panel.locator('.card__measured-at').textContent()).toContain('2 days ago');
      expect(await panel.locator('.ui-dialog__meta').first().textContent()).toContain('1/2 · recovered');
      expect(await panel.locator('.card__target-commits').allTextContents()).toEqual([
        expect.stringContaining('1e04e038'), expect.stringContaining('1e04e038'),
      ]);
      expect(await panel.textContent()).not.toContain('Unrelated newer perf commit');
      await panel.getByRole('button', { name: 'troubleshoot' }).click();
      expect(await panel.locator('.card__code').textContent()).toContain('phone');
      expect(await panel.locator('.card__code').textContent()).not.toContain('desktop');
      await panel.getByRole('button', { name: 'command', exact: true }).click();
      expect(await panel.getByRole('textbox').inputValue()).toBe(phone.executionDetails.command);
      await panel.getByRole('button', { name: 'test source' }).click();
      await panel.locator('.card__code').filter({ hasText: 'older phone source' }).waitFor();
    } finally {
      await page.close();
    }
  });

  it('does not borrow a newer sibling result for a legacy visual artifact', async () => {
    const outcome = data.tests[0]!.outcomes[0]!;
    outcome.executionDetails = { ...outcome.executionDetails, measurementMetadata: undefined, testSourceHref: null };
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.artifact-card--single').getByRole('button').click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      expect(await metadata.getByRole('button', { name: 'command', exact: true }).count()).toBe(0);
      expect(await metadata.locator('.card__measured-at').textContent()).toContain('never measured');
      expect(await metadata.locator('.card__target-commits').count()).toBe(0);
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
      await metadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await metadata.textContent()).toContain('No source snapshot was captured.');
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
      expect(await metadata.getByText('1e04e038', { exact: true }).count()).toBe(0);
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toBe('shaka-perf compare --categories perf --filter Homepage');
    } finally {
      await page.close();
    }
  });

});
