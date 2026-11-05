/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import { renderReportHtml, type ReportData } from '../../src/pipeline/report';

jest.setTimeout(60_000);

// A clean accessibility React element renders null, while another viewport of
// the same category has an error. Its restore control must outlive both bodies.
function reportData(mode: 'full' | 'self-contained'): ReportData {
  const cleanAccessibility = {
    control: { side: 'control', url: 'http://control.test', violations: [] },
    experiment: { side: 'experiment', url: 'http://experiment.test', violations: [] },
    effectiveConfig: { tags: ['wcag2a'], disableRules: [], includeRules: null },
    failOnViolation: false, findings: [],
    summary: { new: 0, fixed: 0, changed: 0, unchanged: 0, blocked: 0, newByImpact: {}, fixedByImpact: {}, changedByImpact: {} },
  };
  return {
    meta: {
      title: 'Compare', pipelineName: 'compare', generatedAt: '2026-11-03T10:00:00Z',
      controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test',
      durationMs: 1000, cwd: '/example', errors: [], reportOnly: false,
      reportMode: mode, pipelineConfig: {},
    },
    tests: ['Homepage', 'Product'].map((name) => ({
      id: name, name, filePath: 'example.abtest.ts', startingPath: '/',
      controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test',
      code: null, chips: [], sorts: [], durationMs: 1000, measuredAt: 1, runId: 'run-1',
      viewportArtifactPaths: [],
      outcomes: [
        { kind: 'ok', stage: 'visreg', viewport: DESKTOP_VIEWPORT, measurement: [] },
        ...[DESKTOP_VIEWPORT, PHONE_VIEWPORT].map((viewport) => ({
          kind: 'ok' as const, stage: 'perf', viewport, measurement: { metrics: [] },
        })),
        { kind: 'ok', stage: 'accessibility', viewport: DESKTOP_VIEWPORT, measurement: cleanAccessibility },
        { kind: 'error', stage: 'accessibility', viewport: PHONE_VIEWPORT, error: { message: 'Intentional phone failure' } },
      ],
    })),
  };
}

describe.each(['full', 'self-contained'] as const)('%s section disclosures', (mode) => {
  let server: Server;
  let browser: Browser;
  let url: string;
  let page: Page;
  let data: ReportData;

  beforeAll(async () => {
    server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(renderReportHtml(data)); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  beforeEach(() => { data = reportData(mode); });
  afterEach(async () => page.close());

  it.each([1280, 390])('hides globally, stays compact, and restores after search at %i px', async (width) => {
    page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url);
    expect(await page.locator('.header__controls select, .header__controls .a11y-filter').count()).toBe(0);
    expect(await page.getByRole('switch').count()).toBe(0);
    expect(await page.locator('.report-section select').count()).toBe(0);
    const visual = page.getByRole('button', { name: 'Visual Diff visibility for all tests' });
    expect(await visual.count()).toBe(2);
    expect(await visual.first().getAttribute('aria-haspopup')).toBeNull();
    await visual.first().focus();
    await visual.first().press('Space');
    expect(await visual.last().getAttribute('aria-expanded')).toBe('false');
    await visual.first().press('Enter');
    expect(await visual.last().getAttribute('aria-expanded')).toBe('true');
    for (const key of ['visreg', 'perf:viewport:desktop', 'perf:viewport:phone', 'accessibility']) {
      const sections = page.locator(`[data-report-section="${key}"]`);
      expect(await sections.count()).toBe(2);
      await sections.first().locator(':scope > .report-section__head button').click();
      expect(await sections.locator(':scope > .report-section__body').evaluateAll((bodies) => bodies.every((body) => (body as HTMLElement).hidden))).toBe(true);
      expect(await sections.last().locator(':scope > .report-section__head button').getAttribute('aria-expanded')).toBe('false');
    }
    const hiddenRows = page.locator('[data-report-section][data-hidden="true"] > .report-section__head');
    const dimensions = await hiddenRows.evaluateAll((rows) => rows.map((row) => ({ height: (row as HTMLElement).offsetHeight, font: getComputedStyle(row.querySelector('button')!).fontSize })));
    expect(dimensions.every((row) => row.height <= 32 && row.font === dimensions[0].font)).toBe(true);
    await page.getByRole('searchbox').fill('Product');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    expect(await page.locator('.card').count()).toBe(1);
    const a11y = page.getByRole('button', { name: /Accessibility visibility for all tests/i });
    expect(await a11y.getAttribute('aria-expanded')).toBe('false');
    await a11y.click();
    expect(await page.getByRole('alert').isVisible()).toBe(true);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('alert').nth(1).waitFor();
    expect(await page.getByRole('alert').count()).toBe(2);
    expect(await page.getByRole('button', { name: /Accessibility visibility for all tests/i }).evaluateAll((controls) => controls.every((control) => control.getAttribute('aria-expanded') === 'true'))).toBe(true);
    for (const key of ['visreg', 'perf']) {
      await page.locator(`[data-report-section="${key}"]`).first().locator(':scope > .report-section__head button').click();
    }
    expect(await page.locator('.card').count()).toBe(2);
    expect(await page.getByRole('button', { name: /Visual Diff visibility/ }).count()).toBe(2);
    const metadata = page.locator('.card__metadata').first();
    expect(await metadata.getAttribute('open')).toBeNull();
    await metadata.locator('summary').first().click();
    expect(await metadata.getByLabel('URLs', { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

});
