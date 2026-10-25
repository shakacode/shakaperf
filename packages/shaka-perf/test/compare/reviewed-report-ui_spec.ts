/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { renderReportHtml, type ReportData, type TestResult } from '../../src/pipeline/report';
import { reviewedKey } from '../../report-shell/src/components/TestCard';

jest.setTimeout(60_000);

describe.each([
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
])('reviewed report cards at $width px', (viewport) => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let url: string;
  let data: ReportData;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(renderReportHtml(data));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}/report.html`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    data = reportData();
    page = await browser.newPage({ viewport });
    await page.goto(url);
  });

  afterEach(async () => page.close());

  const reviewed = () => page.locator('[data-report-test-id="home"]').getByRole('checkbox', { name: 'reviewed' });

  async function regenerate(): Promise<void> {
    data.meta.generatedAt = new Date(Date.parse(data.meta.generatedAt) + 60_000).toISOString();
    await page.reload();
  }

  it('keeps an old result reviewed in Show full suite after a partial run, and saves unchecking', async () => {
    await reviewed().check();
    data.tests[1] = testResult('product', 'run-2');
    await regenerate();
    expect(await page.locator('[data-report-test-id="home"]').count()).toBe(0);
    await page.getByRole('checkbox', { name: 'Show full suite' }).check();
    if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
      await page.screenshot({
        path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/partial-run-${viewport.width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    expect(await reviewed().isChecked()).toBe(true);
    expect(await page.locator('[data-report-test-id="home"] .card__body').count()).toBe(0);
    await reviewed().uncheck();
    await page.reload();
    await page.getByRole('checkbox', { name: 'Show full suite' }).check();
    expect(await reviewed().isChecked()).toBe(false);
    expect(await page.locator('[data-report-test-id="home"] .card__body').count()).toBe(1);
  });

  it('starts a fresh measurement unreviewed, retaining review of the original result', async () => {
    await reviewed().check();
    data.tests[0] = testResult('home', 'run-2');
    await regenerate();
    expect(await reviewed().isChecked()).toBe(false);
    data.tests[0] = testResult('home', 'run-1');
    await regenerate();
    expect(await reviewed().isChecked()).toBe(true);
  });

  it('reloads review state when full suite reveals another viewport from an older run', async () => {
    data.tests[0].outcomes.push({
      ...data.tests[0].outcomes[0],
      viewport: { ...DESKTOP_VIEWPORT, label: 'mobile', width: 390, height: 844 },
      runId: 'run-0',
      outsideCurrentConfig: true,
    });
    await regenerate();
    await reviewed().check();
    await page.getByRole('checkbox', { name: 'Show full suite' }).check();
    expect(await reviewed().isChecked()).toBe(false);
    await reviewed().check();
    await page.getByRole('checkbox', { name: 'Show full suite' }).uncheck();
    expect(await reviewed().isChecked()).toBe(true);
    await page.getByRole('checkbox', { name: 'Show full suite' }).check();
    expect(await reviewed().isChecked()).toBe(true);
    await reviewed().uncheck();
    await page.getByRole('checkbox', { name: 'Show full suite' }).uncheck();
    expect(await reviewed().isChecked()).toBe(true);
  });

  it('keeps projects separate even when the same test and run ids are reused', async () => {
    await reviewed().check();
    data.meta.cwd = '/another-project';
    await regenerate();
    expect(await reviewed().isChecked()).toBe(false);
  });

  it('resets review when an older outcome changes even if the newest run stays the same', async () => {
    data.tests[0] = testResult('home', 'run-3');
    data.tests[0].outcomes.push({ ...data.tests[0].outcomes[0], stage: 'perf', runId: 'run-1' });
    await regenerate();
    await reviewed().check();
    data.tests[0].outcomes.reverse();
    await regenerate();
    expect(await reviewed().isChecked()).toBe(true);
    data.tests[0].outcomes[0].runId = 'run-2';
    await regenerate();
    expect(await reviewed().isChecked()).toBe(false);
  });
});

describe('reviewed result identity for legacy reports', () => {
  it('uses saved measurement time when run ids are absent', () => {
    const { meta, tests: [test] } = reportData();
    test.runId = null;
    delete test.outcomes[0].runId;
    const key = reviewedKey(meta, test);
    expect(reviewedKey({ ...meta, generatedAt: 'later report' }, test)).toBe(key);
    expect(reviewedKey(meta, { ...test, measuredAt: test.measuredAt! + 1 })).not.toBe(key);
    expect(reviewedKey({ ...meta, pipelineName: 'audit' }, test)).not.toBe(key);
  });

  it('limits undated results to their report', () => {
    const { meta, tests: [test] } = reportData();
    test.runId = null;
    test.measuredAt = null;
    delete test.outcomes[0].runId;
    expect(reviewedKey({ ...meta, generatedAt: 'later report' }, test)).not.toBe(reviewedKey(meta, test));
  });
});

function testResult(id: string, runId: string): TestResult {
  return {
    id, name: id === 'home' ? 'Homepage' : 'Product',
    filePath: `ab-tests/${id}.abtest.ts`, startingPath: '/',
    controlUrl: 'http://localhost:3000/', experimentUrl: 'http://localhost:3001/',
    code: null, chips: [], sorts: [], durationMs: 1000,
    measuredAt: 1_790_000_000_000, runId, viewportArtifactPaths: [],
    outcomes: [{
      kind: 'error', stage: 'visreg', viewport: DESKTOP_VIEWPORT,
      error: { message: 'Screenshot capture failed' }, runId,
    }],
  };
}

function reportData(): ReportData {
  return {
    meta: {
      title: 'Compare', pipelineName: 'compare', generatedAt: '2026-10-25T10:00:00Z',
      controlUrl: 'http://localhost:3000', experimentUrl: 'http://localhost:3001',
      durationMs: 1000, cwd: '/sample-project', errors: [], reportOnly: false,
      reportMode: 'full', pipelineConfig: {},
    },
    tests: [testResult('home', 'run-1'), testResult('product', 'run-1')],
  };
}
