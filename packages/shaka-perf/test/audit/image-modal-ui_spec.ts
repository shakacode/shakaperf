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
import { renderReportHtml } from '../../src/pipeline/report';
import { imageModalFixture } from './image-modal-fixture';

jest.setTimeout(60_000);

async function expectFitted(page: Page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.image-viewport')).every(el => {
    const plane = el.querySelector('.image-viewport__plane')!;
    return plane.clientWidth > 0 && plane.clientHeight > 0 && plane.clientWidth <= el.clientWidth + 1 && plane.clientHeight <= el.clientHeight + 1;
  }));
  // ResizeObserver runs after layout; allow the next paint to settle as well.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const boxes = await page.locator('dialog[open] .image-viewport').evaluateAll(elements => elements.map(el => {
    const plane = el.querySelector('.image-viewport__plane')!;
    const img = el.querySelector('img')!;
    const rect = plane.getBoundingClientRect();
    const viewport = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, ratio: img.naturalWidth / img.naturalHeight, scrollX: (el.scrollLeft = 100, el.scrollLeft), scrollY: (el.scrollTop = 100, el.scrollTop), centered: Math.abs((rect.x + rect.width / 2) - (viewport.x + viewport.width / 2)) };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.width / box.height).toBeCloseTo(box.ratio, 2);
    expect(box.scrollX).toBeLessThanOrEqual(1);
    expect(box.scrollY).toBeLessThanOrEqual(1);
    expect(box.centered).toBeLessThanOrEqual(1);
  }
  expect(await page.locator('dialog[open]').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
}

describe('enlarged report image sizing', () => {
  let browser: Browser;
  let directory: string;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-image-modal-'));
    for (const pipeline of ['audit', 'compare'] as const) for (const mode of ['full', 'self-contained'] as const) {
      const data = imageModalFixture(pipeline);
      data.meta.reportMode = mode;
      fs.writeFileSync(path.join(directory, `${pipeline}-${mode}.html`), renderReportHtml(data));
    }
    browser = await chromium.launch();
  });
  afterAll(async () => { await browser?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  it.each(['audit', 'compare'] as const)('%s fits all image entry points on desktop/mobile in both report modes', async (pipeline) => {
    for (const mode of ['full', 'self-contained']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390 });
      try {
        await page.goto(pathToFileURL(path.join(directory, `${pipeline}-${mode}.html`)).href);
        const buttons = pipeline === 'audit'
          ? ['[data-stage="code_coverage"] button:has(img)', '[data-stage="code_coverage"] button:has(img)', '.a11y-thumb-button', '.slot-error__screenshot']
          : ['.artifact-card__media-button', '.artifact-card__media-button', '.a11y-compare-card__inspect', '.slot-error__screenshot'];
        for (let i = 0; i < buttons.length; i++) {
          // The first two entries deliberately cover tall and wide sources.
          const opener = page.locator(buttons[i]).nth(i === 1 ? 1 : 0);
          await opener.click();
          await expectFitted(page);
          if (i === 2) {
            const hotspot = page.locator('dialog[open] .a11y-hotspot').first();
            const offsets = await hotspot.evaluate(el => {
              const plane = el.closest('.image-viewport__plane')!.getBoundingClientRect();
              const rect = el.getBoundingClientRect();
              return { x: rect.x - plane.x - plane.width * 20 / 390, y: rect.y - plane.y - plane.height * 2000 / 4096 };
            });
            expect(Math.abs(offsets.x)).toBeLessThan(1);
            expect(Math.abs(offsets.y)).toBeLessThan(1);
            await hotspot.click();
            expect(await hotspot.getAttribute('data-active')).toBe('true');
            const tooltip = (await hotspot.locator('.a11y-tooltip').boundingBox())!;
            const pane = (await hotspot.locator('xpath=ancestor::*[contains(concat(" ",@class," ")," image-viewport ")][1]').boundingBox())!;
            expect(tooltip.x).toBeGreaterThanOrEqual(7);
            expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(width - 7);
            expect(tooltip.y).toBeGreaterThanOrEqual(pane.y + 7);
            expect(tooltip.y + tooltip.height).toBeLessThanOrEqual(pane.y + pane.height - 7);
            await expectFitted(page);
          }
          if (pipeline === 'compare' && i === 0) {
            const scrubber = page.locator('dialog[open] .scrubber');
            const box = (await scrubber.boundingBox())!;
            await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
            expect(await scrubber.evaluate(el => parseFloat((el as HTMLElement).style.getPropertyValue('--scrub-pos')))).toBeCloseTo(80, 0);
          }
          const fit = page.getByRole('button', { name: 'Fit to window', exact: true });
          expect(await fit.getAttribute('aria-pressed')).toBe('true');
          await page.getByRole('button', { name: 'Actual size', exact: true }).click();
          await page.waitForFunction(() => Array.from(document.querySelectorAll('.image-viewport')).some(el => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth));
          const actual = await page.locator('.image-viewport__plane').first().boundingBox();
          expect(actual!.width).toBe(i === 1 ? 2560 : 390);
          await fit.click();
          await expectFitted(page);
          await page.setViewportSize({ width: width === 390 ? 560 : 1000, height: 620 });
          await expectFitted(page);
          if (width === 390) {
            await page.setViewportSize({ width: 844, height: 390 });
            await expectFitted(page);
          }
          await page.setViewportSize({ width, height: 844 });
          await page.keyboard.press('Escape');
          expect(await page.locator('dialog[open]').count()).toBe(0);
        }
      } finally { await page.close(); }
    }
  });
});
