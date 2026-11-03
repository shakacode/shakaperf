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

import { stageSection } from '../../report-shell/src/components/OutcomeSlot';
import * as pipelineArtifacts from '../../src/pipeline/pipeline-artifacts';

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
      ...(id === 'Older' ? [{ kind: 'error' as const, stage: 'accessibility' as const,
        viewport: PHONE_VIEWPORT, runId: '2026-09-30T00:00:00.000Z',
        error: { message: 'Another old run' } }] : []),
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

  it('passes per-measurement run freshness to stage renderers', () => {
    const render = jest.spyOn(pipelineArtifacts, 'renderPersistedStageArtifacts').mockReturnValue('artifact');
    const data = fixture('compare', 'full');
    const outcomes = [LATEST, OLD].map((runId) => ({
      kind: 'ok' as const, stage: 'accessibility' as const, viewport: DESKTOP_VIEWPORT,
      runId, measurement: { runId },
    }));
    try {
      stageSection(data.meta, outcomes, LATEST);
      expect(render).toHaveBeenLastCalledWith('compare', {}, 'accessibility', [
        { measurement: { runId: LATEST }, viewport: DESKTOP_VIEWPORT, latestRun: true },
        { measurement: { runId: OLD }, viewport: DESKTOP_VIEWPORT, latestRun: false },
      ]);
      stageSection(data.meta, outcomes, null);
      expect(render.mock.calls.at(-1)?.[3].map((entry) => entry.latestRun)).toEqual([true, true]);
    } finally {
      render.mockRestore();
    }
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
      expect(await card.locator('.slot-error__label').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('phone:old run')]));
      await toggle.uncheck();
      expect(await names()).toEqual(['Mixed']);
      expect(await card.textContent()).not.toContain('Older phone result');

      await page.locator('input[type=search]').fill('Mixed');
      await page.getByRole('button', { name: 'passed · 2', exact: true }).click();
      const filters = await page.locator('.filterbar').first().innerHTML();
      await page.getByRole('switch', { name: /accessibility in all test cards/i }).first().click();
      for (const checked of [true, false]) {
        await toggle.setChecked(checked);
        expect(await names()).toEqual(['Mixed']);
        expect(await page.locator('input[type=search]').inputValue()).toBe('Mixed');
        expect(await page.locator('.filterbar').first().innerHTML()).toBe(filters);
        const section = page.getByRole('switch', { name: /accessibility in all test cards/i });
        expect(await section.getAttribute('aria-checked')).toBe('false');
        expect(await page.locator('[data-stage="accessibility"] .slot-error').count()).toBe(0);
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
      const current = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Current', exact: true }) });
      expect(await current.locator('.outcome-slot__runs').count()).toBe(0);
      expect(await current.locator('.card__pills').textContent()).not.toContain('latest run');
      const mixed = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Mixed', exact: true }) });
      expect(await mixed.locator('.outcome-slot__runs').count()).toBe(0);
      expect(await page.locator('.pill').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining('latest run')]));
      expect(await mixed.locator('.slot-error__label .old-run-chip').allTextContents()).toEqual(['old run', 'old run']);
      expect(await mixed.locator('.slot-error__label').allTextContents()).toEqual([
        'Error during \"accessibility\" · desktop:',
        'Error during \"accessibility\" · phone:old run',
        `Error during \"${pipeline === 'audit' ? 'audit' : 'visreg'}\" · desktop:old run`,
      ]);
      const toggle = page.getByRole('checkbox', { name: 'Show full suite', exact: true });
      await toggle.check();
      expect((await names()).sort()).toEqual(['Current', 'Mixed', 'Older']);
      const older = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Older', exact: true }) });
      expect(await older.locator('.card__pills').textContent()).toContain('old run');
      expect(await older.locator('.old-run-chip').count()).toBe(0);
      await toggle.uncheck();
      expect((await names()).sort()).toEqual(['Current', 'Mixed']);

      await current.getByRole('switch', { name: /accessibility in all test cards/i }).click();
      await page.locator('input[type=search]').fill('Older');
      await page.getByRole('button', { name: 'broken · 1', exact: true }).click();
      const active = await page.locator('.filterbar').first().innerHTML();
      expect(await names()).toEqual([]);
      await toggle.check();
      expect(await names()).toEqual(['Older']);
      expect(await page.locator('input[type=search]').inputValue()).toBe('Older');
      expect(await page.locator('.filterbar').first().innerHTML()).toBe(active);
      const section = page.getByRole('switch', { name: /accessibility in all test cards/i });
      expect(await section.getAttribute('aria-checked')).toBe('false');
      expect(await older.locator('.slot-error').count()).toBe(0);
      await toggle.uncheck();
      expect(await names()).toEqual([]);
      await toggle.check();
      expect(await section.getAttribute('aria-checked')).toBe('false');
      await section.click();
      expect(await older.locator('.slot-error').count()).toBe(2);
    } finally {
      await page.close();
    }
  }, 30_000);
});
