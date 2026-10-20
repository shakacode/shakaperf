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
import { renderReportHtml, type ReportData, type TestResult } from '../../src/pipeline/report';

const OLD = '2026-10-01T00:00:00.000Z';
const LATEST = '2026-10-02T00:00:00.000Z';

function fixture(pipelineName: string, reportMode: 'full' | 'self-contained'): ReportData {
  const card = (id: string, runId: string, mixed = false): TestResult => ({
    id, name: id, filePath: 'suite.abtest.ts', startingPath: '/',
    controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test',
    code: null, durationMs: 0, measuredAt: 0, runId,
    chips: [{ tag: id === 'Older' ? 'broken' : 'passed', text: id === 'Older' ? 'broken' : 'passed', color: 'gray', sortingWeight: 0 }],
    sorts: [], viewportArtifactPaths: [],
    outcomes: [
      { kind: 'error', stage: 'accessibility', viewport: DESKTOP_VIEWPORT, runId,
        error: { message: 'Saved result' } },
      ...(mixed ? [{ kind: 'error' as const, stage: 'accessibility' as const, viewport: PHONE_VIEWPORT,
        runId: OLD, error: { message: 'Older phone result' } },
        { kind: 'error' as const, stage: pipelineName === 'audit' ? 'audit' as const : 'visreg' as const,
          viewport: DESKTOP_VIEWPORT, runId: OLD, error: { message: 'Older stage result' } }] : []),
    ],
  });
  return {
    meta: { title: 'Visibility', pipelineName, pipelineConfig: {}, reportMode,
      generatedAt: LATEST, controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test',
      cwd: '/tmp/visibility', errors: [], durationMs: 0, reportOnly: true },
    tests: [card('Current', LATEST), card('Older', OLD), card('Mixed', LATEST, true)],
  };
}

describe('latest measurement run visibility', () => {
  let browser: Browser;
  let directory: string;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-run-visibility-'));
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['compare', 'full'], ['compare', 'self-contained'],
    ['audit', 'full'], ['audit', 'self-contained'],
  ] as const)('%s %s intersects suite visibility with existing controls', async (pipeline, mode) => {
    const file = path.join(directory, `${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(fixture(pipeline, mode)));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      const names = () => page.locator('.card__title').allTextContents();
      expect((await names()).sort()).toEqual(['Current', 'Mixed']);
      const mixed = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Mixed', exact: true }) });
      expect((await mixed.locator('.outcome-slot__runs').allTextContents()).join(' ')).toContain('phone · old run');
      expect((await mixed.locator('.outcome-slot__runs').allTextContents()).join(' ')).toContain('desktop · latest run');
      const toggle = page.getByRole('checkbox', { name: 'Show full suite', exact: true });
      await toggle.check();
      expect((await names()).sort()).toEqual(['Current', 'Mixed', 'Older']);
      expect(await page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Older', exact: true }) }).textContent()).toContain('old run');
      await toggle.uncheck();
      expect((await names()).sort()).toEqual(['Current', 'Mixed']);

      await page.locator('input[type=search]').fill('Older');
      await page.getByRole('button', { name: 'broken · 1', exact: true }).click();
      const active = await page.locator('.filterbar').first().innerHTML();
      const section = page.locator('.stage-filter summary');
      const sectionText = await section.textContent();
      expect(await names()).toEqual([]);
      await toggle.check();
      expect(await names()).toEqual(['Older']);
      expect(await page.locator('input[type=search]').inputValue()).toBe('Older');
      expect(await page.locator('.filterbar').first().innerHTML()).toBe(active);
      expect(await section.textContent()).toBe(sectionText);
      await toggle.uncheck();
      expect(await names()).toEqual([]);
      expect(await page.locator('input[type=search]').inputValue()).toBe('Older');
      expect(await page.locator('.filterbar').first().innerHTML()).toBe(active);
      expect(await section.textContent()).toBe(sectionText);
      await section.click();
      await page.locator('.stage-filter').getByRole('button', { name: 'none', exact: true }).click();
      const deselected = await section.textContent();
      await toggle.check();
      expect(await names()).toEqual([]);
      expect(await section.textContent()).toBe(deselected);
      await toggle.uncheck();
      expect(await section.textContent()).toBe(deselected);
    } finally {
      await page.close();
    }
  }, 30_000);
});
