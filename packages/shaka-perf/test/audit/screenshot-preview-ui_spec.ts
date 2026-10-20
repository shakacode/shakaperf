/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { renderReportHtml, type ReportData, type ReportOutcome } from '../../src/pipeline/report';

jest.setTimeout(60_000);

// Content at both ends exposes the cropped-away page bottom in captures.
const TALL_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="4096"><rect width="960" height="4096" fill="white"/><rect width="960" height="200" fill="navy"/><rect y="3896" width="960" height="200" fill="green"/></svg>')}`;
const BROKEN_IMAGE = 'data:image/png;base64,broken';

function fixture(): ReportData {
  const ok = (stage: 'audit' | 'code_coverage', measurement: unknown): ReportOutcome => ({
    kind: 'ok', stage, viewport: DESKTOP_VIEWPORT, measurement,
  } as ReportOutcome);
  const error = (stage: 'audit' | 'code_coverage'): ReportOutcome => ({
    kind: 'error', stage, viewport: DESKTOP_VIEWPORT,
    error: { message: 'Navigation timed out' }, failure: { media: TALL_IMAGE },
  } as ReportOutcome);
  return {
    meta: {
      title: 'Screenshot previews', pipelineName: 'audit', pipelineConfig: {},
      generatedAt: new Date(0).toISOString(), controlUrl: 'http://localhost:3090',
      experimentUrl: 'http://localhost:3090', cwd: '/tmp/report-preview',
      errors: [], durationMs: 1000, reportOnly: true, reportMode: 'full',
    },
    tests: [
      [ok('code_coverage', { files: 1, coveredStatements: 2, totalStatements: 3, screenshotHref: TALL_IMAGE }), error('audit')],
      [ok('audit', { metrics: [], lighthouseHref: 'data:text/html,Lighthouse', lighthouseThumbHref: TALL_IMAGE }), error('code_coverage')],
      [ok('code_coverage', { files: 1, coveredStatements: 2, totalStatements: 3, screenshotHref: BROKEN_IMAGE })],
    ].map((outcomes, index) => ({
      id: `preview-${index}`, name: `Preview ${index}`, filePath: 'previews.abtest.ts',
      startingPath: '/', controlUrl: 'http://localhost:3090/', experimentUrl: 'http://localhost:3090/',
      code: null, chips: [], sorts: [], durationMs: 1000, measuredAt: 0,
      runId: 'preview', viewportArtifactPaths: [], outcomes,
    })),
  };
}

describe('audit and coverage screenshot previews', () => {
  let browser: Browser;
  let directory: string;
  let page: Page;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-preview-ui-'));
    fs.writeFileSync(path.join(directory, 'report.html'), renderReportHtml(fixture()));
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  afterEach(async () => { await page?.close(); });

  it.each([1440, 390])('fits tall normal and failure screenshots at %ipx without cropping or overflow', async (width) => {
    page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    await page.locator('.card').first().waitFor();
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
    const images = await page.locator('.stage-artifact img, .slot-error img').evaluateAll((nodes) => nodes
      .filter((node) => (node as HTMLImageElement).naturalWidth > 0)
      .map((node) => ({
        height: node.getBoundingClientRect().height,
        fit: getComputedStyle(node).objectFit,
      })));
    expect(images).toHaveLength(4);
    for (const image of images) {
      expect(image.height).toBeGreaterThan(0);
      expect(image.height).toBeLessThanOrEqual(240);
      expect(image.fit).toBe('contain');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  it('opens full-size coverage, Lighthouse, and failure artifacts in dialogs', async () => {
    page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    const coverage = page.locator('[data-stage="code_coverage"] button').first();
    await coverage.click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe(TALL_IMAGE);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Lighthouse report/ }).click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe('data:text/html,Lighthouse');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'failure screenshot', exact: true }).first().click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe(TALL_IMAGE);
  });

  it('shows an explicit bounded fallback when the screenshot cannot load', async () => {
    page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    const fallback = page.getByText('Screenshot unavailable', { exact: true });
    await fallback.waitFor();
    const box = await fallback.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(240);
    expect(box?.height).toBeGreaterThan(0);
    expect(await page.locator('.card').last().innerText()).toContain('Statements executed: 2/3');
  });
});
