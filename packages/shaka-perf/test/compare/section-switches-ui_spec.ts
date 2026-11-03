/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';

// Run compare/audit against the same two-page suite first. The audit suite must
// include a "Mixed accessibility" test with a clean desktop result and a phone
// error. These checks consume the CLI output unchanged; they never assemble HTML.
const compareDirectory = process.env.SHAKA_REPORT_COMPARE_DIR;
const auditDirectory = process.env.SHAKA_REPORT_AUDIT_DIR;
if (Boolean(compareDirectory) !== Boolean(auditDirectory)) {
  throw new Error('Set both SHAKA_REPORT_COMPARE_DIR and SHAKA_REPORT_AUDIT_DIR to real CLI output directories.');
}
const generatedReports = compareDirectory && auditDirectory ? describe : describe.skip;

generatedReports('CLI-generated report section switches', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => browser?.close());

  it.each([
    [1280, 'full-report.html'], [390, 'full-report.html'],
    [1280, 'self-contained-performance-report.html'], [390, 'self-contained-performance-report.html'],
  ] as const)('synchronizes and restores sections at %spx in %s', async (width, filename) => {
    const report = path.join(compareDirectory!, filename);
    expect(fs.existsSync(report)).toBe(true);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(pathToFileURL(report).href);
      const cards = page.locator('[data-report-test-id]');
      await cards.first().waitFor();
      expect(await cards.count()).toBe(2);
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-compare-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      expect(await page.locator('.header__controls .stage-filter, .header__controls .a11y-filter').count()).toBe(0);
      const visual = page.getByRole('switch', { name: 'Visual Diff in all test cards', exact: true });
      expect(await visual.count()).toBe(2);
      await visual.first().click();
      for (const toggle of await visual.all()) expect(await toggle.getAttribute('aria-checked')).toBe('false');
      for (const artifacts of await page.locator('.artifact-stack').all()) expect(await artifacts.isVisible()).toBe(false);
      expect(await cards.count()).toBe(2);
      await visual.last().focus();
      await page.keyboard.press('Space');
      for (const artifacts of await page.locator('.artifact-stack').all()) expect(await artifacts.isVisible()).toBe(true);

      const phone = page.getByRole('switch', { name: 'phone performance in all test cards', exact: true });
      expect(await phone.count()).toBe(2);
      await phone.first().click();
      for (const toggle of await phone.all()) expect(await toggle.getAttribute('aria-checked')).toBe('false');
      for (const body of await page.getByRole('region', { name: 'phone performance', exact: true }).locator('[hidden]').all()) {
        expect(await body.isVisible()).toBe(false);
      }
      for (const body of await page.getByRole('region', { name: 'desktop performance', exact: true }).locator('.stage-note').all()) {
        expect(await body.isVisible()).toBe(true);
      }
      await page.getByRole('searchbox').fill('Product');
      await phone.last().click();
      await page.getByRole('searchbox').fill('');
      for (const toggle of await phone.all()) expect(await toggle.getAttribute('aria-checked')).toBe('true');

      for (const name of ['Visual Diff', 'Performance']) {
        await page.getByRole('switch', { name: `${name} in all test cards`, exact: true }).first().click();
      }
      expect(await cards.count()).toBe(2);
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-collapsed-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      await visual.last().click();
      expect(await page.locator('.artifact-stack').last().isVisible()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    [1280, 'full-report.html'], [390, 'full-report.html'],
    [1280, 'self-contained-performance-report.html'], [390, 'self-contained-performance-report.html'],
  ] as const)('keeps modal filters and mixed outcomes restorable at %spx in %s', async (width, filename) => {
    const report = path.join(auditDirectory!, filename);
    expect(fs.existsSync(report)).toBe(true);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(pathToFileURL(report).href);
      const cards = page.locator('[data-report-test-id]');
      await cards.first().waitFor();
      expect(await cards.count()).toBe(3);
      expect(await page.getByRole('button', { name: /accessibility filters/ }).count()).toBe(0);
      const switches = page.getByRole('switch', { name: /accessibility in all test cards/i });
      expect(await switches.count()).toBe(3);
      await switches.first().click();
      await page.getByRole('searchbox').fill('Mixed accessibility');
      expect(await switches.count()).toBe(1);
      expect(await page.locator('.slot-error').count()).toBe(0);
      await switches.click();
      expect(await page.locator('.slot-error').textContent()).toContain('Intentional phone failure');
      await page.getByRole('searchbox').fill('');

      await page.locator('.a11y-thumb-button').first().click();
      const dialog = page.locator('dialog[open]');
      await dialog.getByRole('button', { name: 'test filters · 2/2', exact: true }).click();
      await dialog.getByRole('button', { name: 'none', exact: true }).click();
      await dialog.getByRole('button', { name: 'apply globally', exact: true }).click();
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-audit-modal-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      await dialog.getByRole('button', { name: 'close', exact: true }).click();
      for (const summary of await page.locator('.a11y-thumb__count').all()) {
        expect(await summary.textContent()).toContain('0 of 1');
      }
      expect(await page.getByRole('button', { name: /accessibility filters/ }).count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);
});
