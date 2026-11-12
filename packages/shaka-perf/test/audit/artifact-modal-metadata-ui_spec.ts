/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
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
    ...outcome, executionDetails: { ...outcome.executionDetails, runId: 'unrelated-run' }, kind: 'error', stage: 'accessibility', measurement: undefined,
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
        // Preserve the measured URL independently of framework target URLs.
        expect(await metadata.locator('.ui-dialog__meta dt').allTextContents()).toContain('url');
      }
    } finally { await page.close(); }
  });
});
