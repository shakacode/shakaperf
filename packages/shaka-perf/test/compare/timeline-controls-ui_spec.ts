/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { generateTimelineComparison } from '../../src/bench/core/timeline-comparison';

jest.setTimeout(60_000);

it('opens and dismisses timeline help without toggling its checkbox', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-controls-'));
  const browser = await chromium.launch();
  try {
    const profile = join(dir, 'profile.json');
    const output = join(dir, 'timeline.html');
    writeFileSync(profile, JSON.stringify({ traceEvents: [] }));
    generateTimelineComparison({ controlProfilePath: profile, experimentProfilePath: profile, outputPath: output });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(readFileSync(output, 'utf8'));
    const align = page.getByRole('button', { name: 'align test annotations: explanation' });
    const highlight = page.getByRole('button', { name: 'highlight progress: explanation' });
    expect(await page.getByLabel('align test annotations', { exact: true }).isDisabled()).toBe(true);
    await align.focus();
    expect(await page.getByRole('tooltip').innerText()).toBe('no test annotation is shared by both sides');
    await align.press('Escape');
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await highlight.click();
    expect(await page.getByRole('tooltip').innerText()).toBe('paint the pixels that changed since the previous frame red');
    expect(await page.getByLabel('highlight progress', { exact: true }).isChecked()).toBe(false);
    await page.getByLabel('highlight progress', { exact: true }).check();
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await page.getByLabel('highlight progress', { exact: true }).isChecked()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
