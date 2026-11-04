/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator } from 'playwright';

// Run compare/audit against the same two-page suite first. The audit suite must
// include a "Mixed accessibility" test with a clean desktop result and a phone
// error. These checks consume the CLI output unchanged; they never assemble HTML.
const compareDirectory = process.env.SHAKA_REPORT_COMPARE_DIR;
const auditDirectory = process.env.SHAKA_REPORT_AUDIT_DIR;
if (Boolean(compareDirectory) !== Boolean(auditDirectory)) {
  throw new Error('Set both SHAKA_REPORT_COMPARE_DIR and SHAKA_REPORT_AUDIT_DIR to real CLI output directories.');
}
const generatedReports = compareDirectory && auditDirectory ? describe : describe.skip;

async function checkMetadata(card: Locator) {
  const metadata = card.locator('.card__metadata');
  expect(await metadata.getAttribute('open')).toBeNull();
  const urls = metadata.getByLabel('URLs', { exact: true });
  expect(await urls.isVisible()).toBe(false);
  await metadata.locator('summary').first().click();
  expect(await urls.isVisible()).toBe(true);
  expect(await urls.locator('a').count()).toBeGreaterThan(0);
  expect(await metadata.getByLabel('Latest command').inputValue()).toContain('shaka-perf');
  expect(await urls.locator('dd').evaluateAll((elements) => elements.every((element) => {
    const row = element.parentElement!.getBoundingClientRect();
    const value = element.getBoundingClientRect();
    return value.left >= row.left && value.right <= row.right;
  }))).toBe(true);
  await metadata.locator('summary').first().click();
  expect(await metadata.getAttribute('open')).toBeNull();
}

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

      for (const name of ['Visual Diff', 'desktop performance', 'phone performance']) {
        await page.getByRole('switch', { name: `${name} in all test cards`, exact: true }).first().click();
      }
      const headings = cards.first().locator('.stage-artifact__title:visible, .perf-viewport__label:visible');
      expect(await headings.count()).toBe(4);
      const firstHeading = (await headings.first().boundingBox())!;
      const lastHeading = (await headings.last().boundingBox())!;
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-compact-rows-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      expect(lastHeading.y + lastHeading.height - firstHeading.y).toBeLessThanOrEqual(128);
      const typography = await headings.evaluateAll((elements) => elements.map((element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing, style.lineHeight].join('|');
      }));
      expect(new Set(typography).size).toBe(1);
      await page.getByRole('switch', { name: 'Performance in all test cards', exact: true }).first().click();
      expect(await cards.count()).toBe(2);
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-collapsed-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      await visual.last().click();
      expect(await page.locator('.artifact-stack').last().isVisible()).toBe(true);
      await checkMetadata(cards.first());
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
      await page.getByRole('checkbox', { name: 'Show full suite', exact: true }).check();
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

  it.each([
    [1280, 'full-report.html'], [390, 'full-report.html'],
    [1280, 'self-contained-performance-report.html'], [390, 'self-contained-performance-report.html'],
  ] as const)('keeps four collapsed categories compact at %spx in %s', async (width, filename) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(pathToFileURL(path.join(auditDirectory!, filename)).href);
      const card = page.locator('[data-report-test-id]').filter({
        has: page.getByRole('heading', { name: 'Product', exact: true }),
      });
      await card.waitFor();
      const sections = card.locator('.card__body > .outcome-slot');
      expect(await sections.count()).toBeGreaterThanOrEqual(4);
      for (const section of await sections.all()) {
        await section.getByRole('switch').click();
      }
      const headings = sections.locator('.stage-artifact__title:visible');
      const first = (await headings.nth(0).boundingBox())!;
      const fourth = (await headings.nth(3).boundingBox())!;
      if (process.env.SHAKA_REPORT_UI_CAPTURE_DIR) {
        await page.screenshot({ path: `${process.env.SHAKA_REPORT_UI_CAPTURE_DIR}/real-four-collapsed-${width}-${filename}.png`, fullPage: true, animations: 'disabled' });
      }
      expect(fourth.y + fourth.height - first.y).toBeLessThanOrEqual(128);
      const typography = await headings.evaluateAll((elements) => elements.map((element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing, style.lineHeight].join('|');
      }));
      expect(new Set(typography).size).toBe(1);
      const restore = sections.nth(0).getByRole('switch');
      expect(await restore.getAttribute('aria-checked')).toBe('false');
      await restore.click();
      expect(await restore.getAttribute('aria-checked')).toBe('true');
      await checkMetadata(card);
    } finally {
      await page.close();
    }
  }, 30_000);
});
