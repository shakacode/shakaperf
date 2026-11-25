/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { chromium } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

it.each(['compare', 'audit'] as const)('shows saved settings and restores the open viewport in %s', async pipeline => {
  const data = runDetailsFixture(pipeline);
  data.tests = data.tests.slice(0, 1);
  const outcome = data.tests[0]!.outcomes[0]!;
  outcome.executionDetails = {
    ...outcome.executionDetails,
    stageMetadata: {
      throttling: 'Lighthouse · simulate · 4× CPU',
      'number of measurements': pipeline === 'audit' ? '1' : '10 per side',
    },
  };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(renderReportHtml(data));
    const section = page.getByRole('region', { name: 'desktop performance', exact: true });
    const show = section.getByRole('button', { name: 'show metadata', exact: true });
    expect(await page.getByRole('region', { name: 'phone performance', exact: true }).getByRole('button', { name: 'show metadata' }).count()).toBe(0);
    await show.click();
    const { width, height } = outcome.executionDetails.viewport;
    expect(await section.getByText(`${width} × ${height}`, { exact: true }).isVisible()).toBe(true);
    const settings = section.locator('.perf-run-settings');
    expect(await settings.locator('dd').first().innerText()).toContain('4× CPU');
    expect(await settings.locator('dd').last().innerText()).toBe(pipeline === 'audit' ? '1' : '10 per side');
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
