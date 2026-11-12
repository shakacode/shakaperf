/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { chromium } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

it('restores open metadata after its performance viewport collapses and reopens', async () => {
  const data = runDetailsFixture('compare');
  data.tests = data.tests.slice(0, 1);
  data.tests[0]!.outcomes = data.tests[0]!.outcomes.slice(0, 1);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(renderReportHtml(data));
    const section = page.getByRole('region', { name: 'desktop performance', exact: true });
    const show = section.getByRole('button', { name: 'show metadata', exact: true });
    await show.click();
    const metadata = section.getByText('throttling', { exact: true });
    expect(await metadata.isVisible()).toBe(true);
    const heading = section.getByRole('button', { name: 'desktop performance visibility for all tests', exact: true });
    await heading.click();
    expect(await metadata.isVisible()).toBe(false);
    await heading.click();
    expect(await metadata.isVisible()).toBe(true);
    await section.getByRole('button', { name: 'hide metadata', exact: true }).click();
    expect(await metadata.isVisible()).toBe(false);
  } finally {
    await browser.close();
  }
});
