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
import { chromium, type Browser } from 'playwright';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import { renderReportHtml, type ReportData } from '../../src/pipeline/report';

describe('report section switches', () => {
  let browser: Browser;
  let directory: string;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-section-switches-'));
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    [1280, 'full'], [390, 'full'], [1280, 'self-contained'], [390, 'self-contained'],
  ] as const)('synchronizes and restores sections at %spx in %s reports', async (width, mode) => {
    const file = path.join(directory, `${width}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(fixture(mode)));
    if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
      fs.copyFileSync(file, path.join(process.env.SHAKA_REPORT_UI_CAPTURE_DIR, `sections-${width}-${mode}.html`));
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/sections-${width}-${mode}.png`, fullPage: true, animations: 'disabled' });
      }
      expect(await page.locator('.header__controls .stage-filter, .header__controls .a11y-filter').count()).toBe(0);
      const visual = page.getByRole('switch', { name: 'Visual Diff in all test cards', exact: true });
      expect(await visual.count()).toBe(2);
      await visual.first().click();
      for (const toggle of await visual.all()) expect(await toggle.getAttribute('aria-checked')).toBe('false');
      for (const note of await page.locator('.artifact-stack').all()) expect(await note.isVisible()).toBe(false);
      expect(await page.locator('.card').count()).toBe(2);
      await visual.last().focus();
      await page.keyboard.press('Space');
      for (const note of await page.locator('.artifact-stack').all()) expect(await note.isVisible()).toBe(true);

      const phone = page.getByRole('switch', { name: 'phone performance in all test cards', exact: true });
      await phone.first().click();
      for (const toggle of await phone.all()) expect(await toggle.getAttribute('aria-checked')).toBe('false');
      for (const metric of await page.getByRole('region', { name: 'phone performance', exact: true }).locator('.stage-note').all()) {
        expect(await metric.isVisible()).toBe(false);
      }
      for (const metric of await page.getByRole('region', { name: 'desktop performance', exact: true }).locator('.stage-note').all()) {
        expect(await metric.isVisible()).toBe(true);
      }
      await page.getByRole('searchbox').fill('Product');
      await phone.last().click();
      await page.getByRole('searchbox').fill('');
      for (const toggle of await phone.all()) expect(await toggle.getAttribute('aria-checked')).toBe('true');

      // Even with every category hidden, the headers remain available to restore it.
      for (const name of ['Visual Diff', 'Performance']) {
        await page.getByRole('switch', { name: `${name} in all test cards`, exact: true }).first().click();
      }
      expect(await page.locator('.card').count()).toBe(2);
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/sections-collapsed-${width}-${mode}.png`, fullPage: true, animations: 'disabled' });
      }
      await visual.last().click();
      expect(await page.locator('.artifact-stack').last().isVisible()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([1280, 390])('keeps accessibility filters in the modal at %spx', async (width) => {
    const data = fixture('self-contained');
    data.meta.pipelineName = 'audit';
    for (const test of data.tests) {
      test.outcomes = [{
        kind: 'ok', stage: 'accessibility', viewport: DESKTOP_VIEWPORT,
        measurement: {
          effectiveConfig: { tags: ['wcag2a'], includeRules: ['button-name'], disableRules: [] },
          totalViolations: 1, failOnViolation: true,
          scans: [{
            viewportLabel: 'desktop', viewport: DESKTOP_VIEWPORT, url: test.controlUrl,
            screenshot: { width: 40, height: 20, imageHref: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>' },
            violations: [{
              ruleId: 'button-name', impact: 'serious', help: 'Buttons need accessible names',
              helpUrl: 'https://example.test/button-name', tags: ['wcag2a'],
              nodes: [{ target: ['button'], html: '<button></button>', failureSummary: 'Add a name' }],
            }],
          }],
        },
      }];
    }
    const file = path.join(directory, `audit-${width}.html`);
    fs.writeFileSync(file, renderReportHtml(data));
    if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
      fs.copyFileSync(file, path.join(process.env.SHAKA_REPORT_UI_CAPTURE_DIR, `audit-${width}.html`));
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      expect(await page.locator('.header__controls .a11y-filter').count()).toBe(0);
      expect(await page.getByRole('button', { name: /accessibility filters/ }).count()).toBe(0);
      await page.locator('.a11y-thumb-button').first().click();
      let dialog = page.locator('dialog[open]');
      await dialog.getByRole('button', { name: 'test filters · 2/2', exact: true }).click();
      await dialog.getByRole('button', { name: 'none', exact: true }).click();
      await dialog.getByRole('button', { name: 'apply globally', exact: true }).click();
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/audit-modal-${width}.png`, fullPage: true, animations: 'disabled' });
      }
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      for (const summary of await page.locator('.a11y-thumb__count').all()) {
        expect(await summary.textContent()).toContain('0 of 1');
      }
      const toggles = page.getByRole('switch', { name: 'accessibility in all test cards', exact: true });
      await toggles.first().click();
      for (const preview of await page.locator('.a11y-preview-card').all()) expect(await preview.isVisible()).toBe(false);
      expect(await page.locator('.card').count()).toBe(2);
      await toggles.last().click();
      for (const preview of await page.locator('.a11y-preview-card').all()) expect(await preview.isVisible()).toBe(true);
      await page.locator('.a11y-thumb-button').last().click();
      dialog = page.locator('dialog[open]');
      await dialog.getByRole('button', { name: 'test filters · 0/2', exact: true }).click();
      await dialog.getByRole('button', { name: 'all', exact: true }).click();
      await dialog.getByRole('button', { name: 'apply globally', exact: true }).click();
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      expect(await page.getByRole('button', { name: /accessibility filters/ }).count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);
});

function fixture(reportMode: 'full' | 'self-contained'): ReportData {
  return {
    meta: {
      title: 'Compare', pipelineName: 'compare', pipelineConfig: {}, reportMode,
      generatedAt: '2026-11-03T12:00:00Z', controlUrl: 'http://control.test',
      experimentUrl: 'http://experiment.test', cwd: '/sample-project', errors: [],
      durationMs: 1000, reportOnly: false,
    },
    tests: ['Homepage', 'Product'].map((name) => ({
      id: name, name, filePath: 'suite.abtest.ts', startingPath: '/',
      controlUrl: 'http://control.test/', experimentUrl: 'http://experiment.test/',
      code: null, chips: [], sorts: [], durationMs: 1000, measuredAt: Date.parse('2026-11-03T12:00:00Z'),
      runId: 'run-1', viewportArtifactPaths: [],
      outcomes: [
        { kind: 'ok', stage: 'visreg', viewport: DESKTOP_VIEWPORT, measurement: [{
          selector: 'body', controlImage: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="lightblue"/></svg>',
          experimentImage: '', diffImage: null, misMatchPercentage: 0,
        }], runId: 'run-1' },
        ...[PHONE_VIEWPORT, DESKTOP_VIEWPORT].map((viewport) => ({
          kind: 'ok' as const, stage: 'perf', viewport, runId: 'run-1',
          measurement: { metrics: [{
            label: 'LCP', group: 'vitals', controlValue: 100, experimentValue: 100,
            deltaValue: 0, controlDisplay: '100ms', experimentDisplay: '100ms',
            deltaDisplay: '0ms', percentDisplay: '0%', deltaPercent: 0,
            pValue: 1, direction: 'none',
          }] },
        })),
      ],
    })),
  };
}
