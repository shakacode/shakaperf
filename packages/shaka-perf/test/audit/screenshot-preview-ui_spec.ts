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
      [ok('code_coverage', { files: 1, coveredStatements: 2, totalStatements: 3, screenshotHref: TALL_IMAGE, coverageHref: 'data:application/json,{}', visibilityMapHref: 'data:text/plain,map', sourceAttribution: { located: 1, elements: 2, plugin: 'react19', warnings: [] } }), error('audit')],
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

  it.each([1440, 390])('places coverage metrics beside the screenshot or below it at %ipx', async (width) => {
    page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    await page.locator('.card').first().waitFor();
    const row = page.locator('[data-stage="code_coverage"] .stage-stack__viewport').first();
    expect(await row.locator('table').count()).toBe(1);
    const image = await row.locator('img').boundingBox();
    const table = await row.locator('table').boundingBox();
    expect(image).not.toBeNull();
    expect(table).not.toBeNull();
    if (width === 1440) {
      expect(table!.x).toBeGreaterThanOrEqual(image!.x + image!.width);
      expect(image!.width).toBeLessThanOrEqual(222);
    } else {
      expect(table!.y).toBeGreaterThanOrEqual(image!.y + image!.height);
    }
    expect(await row.getByRole('progressbar').getAttribute('value')).toBe('67');
    expect(await row.locator('img').evaluate((img) => getComputedStyle(img).objectPosition)).toBe('50% 50%');
    const background = await row.locator('img').evaluate((img) => getComputedStyle(img.parentElement!).backgroundColor);
    expect(background).not.toBe('rgb(255, 255, 255)');
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    const scope = row.locator('details');
    expect(await scope.getAttribute('open')).toBeNull();
    await scope.locator('summary').click();
    expect(await scope.innerText()).toContain('content outside them');
  });

  it('explains the actual counts on hover, keyboard focus, and touch without clipping', async () => {
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    const statement = page.getByRole('button', { name: 'Statements executed: explanation' }).first();
    await statement.hover();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor();
    expect(await tooltip.innerText()).toBe('Of the 3 tracked statements in the source files loaded during this test, 2 ran at least once.');
    const box = await tooltip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    const files = page.getByRole('button', { name: 'Instrumented files loaded: explanation' }).first();
    await files.focus();
    await tooltip.waitFor();
    expect(await tooltip.innerText()).toBe('During this test, 1 source file was loaded with counters that track which code instructions ran.');
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    await statement.tap();
    await tooltip.waitFor();
    await page.getByRole('heading', { name: 'Screenshot previews' }).click();
    await tooltip.waitFor({ state: 'hidden' });
  });

  it('opens full-size coverage, Lighthouse, and failure artifacts in dialogs', async () => {
    page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    const coverage = page.locator('[data-stage="code_coverage"] button').first();
    await coverage.click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] img').getAttribute('src')).toBe(TALL_IMAGE);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Lighthouse report/ }).click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe('data:text/html,Lighthouse');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'failure screenshot', exact: true }).first().click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] img').getAttribute('src')).toBe(TALL_IMAGE);
  });

  it('keeps full-report coverage artifacts reachable', async () => {
    page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    await page.getByRole('button', { name: 'visibility-map.txt', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe('data:text/plain,map');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'coverage.json', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    expect(await page.locator('dialog[open] iframe').getAttribute('src')).toBe('data:application/json,{}');
  });

  it('renders zero counts without a screenshot and omits raw links in the self-contained report', async () => {
    const data = fixture();
    data.meta.reportMode = 'self-contained';
    data.tests = [data.tests[0]];
    data.tests[0].outcomes = [{
      kind: 'ok', stage: 'code_coverage', viewport: DESKTOP_VIEWPORT,
      measurement: { files: 0, totalStatements: 0, coveredStatements: 0, coverageHref: 'data:application/json,{}', visibilityMapHref: 'data:text/plain,map' },
    } as ReportOutcome];
    const file = path.join(directory, 'no-screenshot.html');
    fs.writeFileSync(file, renderReportHtml(data));
    page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.getByRole('table').waitFor();
    expect(await page.getByRole('cell').first().innerText()).toContain('0/0');
    expect(await page.getByRole('progressbar').getAttribute('value')).toBe('0');
    expect(await page.locator('.coverage-preview__media').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'coverage.json', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'visibility-map.txt', exact: true }).count()).toBe(0);
  });

  it('shows an explicit bounded fallback when the screenshot cannot load', async () => {
    page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(directory, 'report.html')).href);
    const fallback = page.getByText('Screenshot unavailable', { exact: true });
    await fallback.waitFor();
    const box = await fallback.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(240);
    expect(box?.height).toBeGreaterThan(0);
    expect(await page.locator('.card').last().getByRole('cell').first().innerText()).toContain('2/3');
  });
});
