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
  ] as const)('%s %s retains current-configuration status and sort controls despite archived errors', async (pipeline, mode) => {
    const data = fixture(pipeline, mode);
    const mixed = data.tests.find((test) => test.name === 'Mixed')!;
    mixed.chips = [{ tag: 'broken', text: 'broken', color: 'gray', sortingWeight: 0 }];
    mixed.currentConfig = {
      chips: [{ tag: 'regression', text: 'regression', color: 'red', sortingWeight: 1 }],
      sorts: [{ tag: 'score', label: 'Score', color: 'red', value: 7, higherIsWorse: true }],
      runId: LATEST, measuredAt: 0,
    };
    mixed.outcomes = mixed.outcomes.map((outcome) => ({
      ...outcome, ...(outcome.viewport.label === 'phone' ? { outsideCurrentConfig: true } : {}),
    }));
    const file = path.join(directory, `controls-${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(data));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      await page.getByRole('button', { name: 'regression · 1', exact: true }).click({ timeout: 2000 });
      const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Mixed', exact: true }) });
      expect(await card.getAttribute('data-dimmed')).not.toBe('true');
      const sort = page.getByRole('button', { name: /Score/ });
      await sort.click({ timeout: 2000 });
      const filters = await page.locator('.filterbar').first().innerHTML();
      expect(await sort.getAttribute('data-active')).toBe('true');
      const toggle = page.getByRole('checkbox', { name: 'Show full suite', exact: true });
      for (const checked of [true, false]) {
        await toggle.setChecked(checked);
        expect(await page.locator('.filterbar').first().innerHTML()).toBe(filters);
        expect(await sort.getAttribute('data-active')).toBe('true');
        expect(await card.getAttribute('data-dimmed')).not.toBe('true');
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    ['compare', 'full'], ['compare', 'self-contained'],
    ['audit', 'full'], ['audit', 'self-contained'],
  ] as const)('%s %s reveals config-excluded viewports only in full suite', async (pipeline, mode) => {
    const data = fixture(pipeline, mode);
    const mixed = data.tests.find((test) => test.name === 'Mixed')!;
    mixed.outcomes = mixed.outcomes.map((outcome) => ({
      ...outcome, ...(outcome.viewport.label === 'phone' ? { outsideCurrentConfig: true } : {}),
    }));
    const current = data.tests.find((test) => test.name === 'Current')!;
    current.outcomes = current.outcomes.map((outcome) => ({ ...outcome, outsideCurrentConfig: true }));
    current.currentConfig = { chips: [], sorts: [], runId: null, measuredAt: null };
    const file = path.join(directory, `config-${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(data));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Mixed', exact: true }) });
      const names = () => page.locator('.card__title').allTextContents();
      const toggle = page.getByRole('checkbox', { name: 'Show full suite', exact: true });
      expect(await names()).toEqual(['Mixed']);
      expect(await card.textContent()).not.toContain('Older phone result');
      await toggle.check();
      expect((await names()).sort()).toEqual(['Current', 'Mixed', 'Older']);
      expect(await card.textContent()).toContain('Older phone result');
      expect(await card.textContent()).toContain('phone · old run');
      await toggle.uncheck();
      expect(await names()).toEqual(['Mixed']);
      expect(await card.textContent()).not.toContain('Older phone result');

      await page.locator('input[type=search]').fill('Mixed');
      await page.getByRole('button', { name: 'passed · 2', exact: true }).click();
      const filters = await page.locator('.filterbar').first().innerHTML();
      const summary = page.locator('.stage-filter summary');
      await summary.click();
      await page.locator('.stage-filter').getByRole('button', { name: 'none', exact: true }).click();
      const sections = await summary.textContent();
      for (const checked of [true, false]) {
        await toggle.setChecked(checked);
        expect(await names()).toEqual([]);
        expect(await page.locator('input[type=search]').inputValue()).toBe('Mixed');
        expect(await page.locator('.filterbar').first().innerHTML()).toBe(filters);
        expect(await summary.textContent()).toBe(sections);
      }
    } finally {
      await page.close();
    }
  }, 30_000);

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
