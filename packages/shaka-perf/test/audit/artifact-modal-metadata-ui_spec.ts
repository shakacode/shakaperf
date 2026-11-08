/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessibilityDialogMeta } from '../../src/audit/stages/accessibility/report-dialog';
import type { AccessibilityResult } from '../../src/audit/stages/accessibility/types';
import { renderReportHtml, type ReportData, type ReportOutcome } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';
import { imageModalFixture, TALL_IMAGE } from './image-modal-fixture';

jest.setTimeout(60_000);

const artifactHtml = 'data:text/html,<p>Saved artifact</p>';
const cases = [
  { pipeline: 'compare', index: 2, opener: '.a11y-compare-card__inspect', title: 'desktop accessibility comparison' },
  { pipeline: 'audit', index: 2, opener: '.a11y-thumb-button', title: 'mobile-tall accessibility issues' },
  { pipeline: 'audit', index: 0, opener: '.coverage-preview__button', title: 'desktop code coverage screenshot' },
  { pipeline: 'audit', index: 0, stage: 'audit', measurement: { lighthouseHref: artifactHtml }, opener: '[data-stage="audit"] button:has-text("Lighthouse report")', title: 'desktop Lighthouse report' },
  { pipeline: 'audit', index: 0, stage: 'build_annotated_timeline', missingMetadata: true, measurement: { frames: [{ timeMs: 0, imgW: 390, imgH: 4096, imageHref: TALL_IMAGE }] }, opener: '[data-stage="build_annotated_timeline"] button:has(img)', title: 'desktop annotated timeline' },
] as const;

function fixture(example: typeof cases[number]): ReportData {
  const data = imageModalFixture(example.pipeline);
  const test = data.tests[example.index]!;
  const outcome = test.outcomes[0]!;
  if ('stage' in example) {
    outcome.stage = example.stage;
    outcome.measurement = example.measurement;
  }
  const metadata = runDetailsFixture(example.pipeline).tests[0]!.outcomes[0]!.runMetadata!;
  outcome.runMetadata = { ...metadata, command: 'shaka-perf selected-artifact', targets: metadata.targets.map(target => ({ ...target, commit: { ...target.commit!, message: 'Selected artifact commit' } })) };
  const sibling: ReportOutcome = {
    ...outcome, kind: 'error', stage: 'accessibility', measurement: undefined,
    error: { message: 'Unrelated saved result' },
    runMetadata: { ...metadata, command: 'shaka-perf unrelated-artifact', targets: metadata.targets.map(target => ({ ...target, commit: { ...target.commit!, message: 'Unrelated artifact commit' } })) },
  };
  if ('missingMetadata' in example) delete outcome.runMetadata;
  test.outcomes = [outcome, sibling];
  data.tests = [test];
  return data;
}

describe('artifact modal measurement context', () => {
  let browser: Browser;
  let server: Server;
  let url: string;
  let data: ReportData;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(renderReportHtml(data));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it.each([
    { scannedUrl: 'https://example.test', distinct: false },
    { scannedUrl: 'https://example.test/after-checkout', distinct: true },
  ])('preserves scanned URL after navigation: $distinct', async ({ scannedUrl, distinct }) => {
    data = fixture(cases[1]);
    const scan = (data.tests[0]!.outcomes[0]!.measurement as AccessibilityResult).scans[0]!;
    scan.url = scannedUrl;
    const page = await browser.newPage({ viewport: { width: 560, height: 620 } });
    try {
      await page.goto(url);
      await page.locator('.a11y-thumb-button').click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      expect(await metadata.locator('.card__targets a').allTextContents()).toEqual(['https://example.test']);
      const scannedRow = metadata.locator('.ui-dialog__meta > div').filter({ has: page.getByText('scanned URL', { exact: true }) });
      expect(await scannedRow.count()).toBe(distinct ? 1 : 0);
      if (distinct) {
        await scannedRow.scrollIntoViewIfNeeded();
        expect(await scannedRow.locator('dd').textContent()).toBe(scannedUrl);
        expect(await scannedRow.isVisible()).toBe(true);
      }
      // Additional provenance must leave room for the screenshot at this shorter height.
      expect(await page.getByRole('dialog').locator('.image-viewport').first().evaluate(el => el.clientHeight)).toBeGreaterThan(0);
    } finally { await page.close(); }
  });

  it('preserves scanned URL when metadata is rendered without a test context', () => {
    const scan = (fixture(cases[1]).tests[0]!.outcomes[0]!.measurement as AccessibilityResult).scans[0]!;
    const html = renderToStaticMarkup(createElement(AccessibilityDialogMeta, { scan, hotspotCount: 1 }));
    expect(html).toContain('<dt>scanned URL</dt>');
    expect(html).toContain(scan.url);
  });

  it.each(cases)('shows selected $pipeline $title context', async example => {
    data = fixture(example);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    try {
      await page.goto(url);
      await page.locator(example.opener).first().click();
      const dialog = page.getByRole('dialog');
      expect(await dialog.locator('.ui-dialog__title').textContent()).toBe(`${example.title} · ${data.tests[0]!.name}`);
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.getAttribute('open')).not.toBeNull();
      expect(await metadata.textContent()).not.toContain('Unrelated artifact commit');
      const command = metadata.getByRole('button', { name: 'command', exact: true });
      if ('missingMetadata' in example) {
        // Derived artifacts without saved provenance must not borrow a sibling's command.
        expect(await command.count()).toBe(0);
      } else {
        expect(await metadata.textContent()).toContain('Selected artifact commit');
        await command.click();
        expect(await metadata.getByLabel('Latest command').inputValue()).toBe('shaka-perf selected-artifact');
      }
      if (example.opener === '.a11y-thumb-button') {
        // The shared target block owns URL provenance; stage fields do not repeat it.
        expect(await metadata.locator('.ui-dialog__meta dt').allTextContents()).not.toContain('scanned URL');
      }
    } finally { await page.close(); }
  });
});
