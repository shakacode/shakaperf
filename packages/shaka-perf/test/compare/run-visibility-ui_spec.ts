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
      { executionDetails: { viewport: DESKTOP_VIEWPORT, testSourcePath: null, runId: runId, recoveredAfterRetries: false }, kind: 'error', stage: 'accessibility',
        error: { message: 'Saved result' } },
      ...(id === 'Older' ? [{ executionDetails: { viewport: PHONE_VIEWPORT, testSourcePath: null, runId: '2026-09-30T00:00:00.000Z', recoveredAfterRetries: false }, kind: 'error' as const, stage: 'accessibility' as const,

        error: { message: 'Another old run' } }] : []),
      ...(mixed ? [{ executionDetails: { viewport: PHONE_VIEWPORT, testSourcePath: null, runId: OLD, recoveredAfterRetries: false }, kind: 'error' as const, stage: 'accessibility' as const,
         error: { message: 'Older phone result' } },
        { executionDetails: { viewport: DESKTOP_VIEWPORT, testSourcePath: null, runId: OLD, recoveredAfterRetries: false }, kind: 'error' as const, stage: pipelineName === 'audit' ? 'audit' as const : 'visreg' as const,
            error: { message: 'Older stage result' } }] : []),
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

  it('passes per-measurement provenance and run freshness to stage renderers', () => {
    const render = jest.spyOn(pipelineArtifacts, 'renderPersistedStageArtifacts').mockReturnValue('artifact');
    const data = fixture('compare', 'full');
    const outcomes = [LATEST, OLD].map((runId) => ({ executionDetails: { viewport: DESKTOP_VIEWPORT, testSourcePath: null, runId: runId, recoveredAfterRetries: false },
      kind: 'ok' as const, stage: 'accessibility' as const,
       measurement: { runId },
    }));
    try {
      stageSection(data.meta, outcomes, LATEST);
      expect(render).toHaveBeenLastCalledWith('compare', {}, 'accessibility', [
        { measurement: { runId: LATEST }, executionDetails: outcomes[0]!.executionDetails, latestRun: true },
        { measurement: { runId: OLD }, executionDetails: outcomes[1]!.executionDetails, latestRun: false },
      ]);
      const entries = render.mock.calls.at(-1)![3];
      entries.forEach((entry, index) => expect(entry.executionDetails).toBe(outcomes[index]!.executionDetails));
      stageSection(data.meta, outcomes, null);
      expect(render.mock.calls.at(-1)?.[3].map((entry) => entry.latestRun)).toEqual([true, true]);
    } finally {
      render.mockRestore();
    }
  });

  it.each([
    ['compare', 'full'], ['compare', 'self-contained'],
    ['audit', 'full'], ['audit', 'self-contained'],
  ] as const)('%s %s counts and selects status chips within the chosen run scope', async (pipeline, mode) => {
    const data = fixture(pipeline, mode);
    const older = data.tests.find((test) => test.name === 'Older')!;
    older.chips.push({ tag: 'flaky', text: 'flaky', color: 'yellow', sortingWeight: 1 });
    const file = path.join(directory, `chip-scope-${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(data));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').first().waitFor();
      const filters = page.locator('.filterbar').first();
      const toggle = page.getByRole('checkbox', { name: 'Show old runs', exact: true });
      expect(await filters.getByRole('button').allTextContents()).toEqual(['all · 2', 'passed · 2']);
      await toggle.check();
      expect(await filters.getByRole('button').allTextContents()).toEqual(['all · 3', 'broken · 1', 'passed · 2', 'flaky · 1']);
      await filters.getByRole('button', { name: 'flaky · 1', exact: true }).click();
      const undimmedNames = () => page.locator('.card:not([data-dimmed="true"]) .card__title').allTextContents();
      expect(await undimmedNames()).toEqual(['Older']);
      await toggle.uncheck();
      expect(await filters.getByRole('button').allTextContents()).toEqual(['all · 2', 'passed · 2']);
      expect(await undimmedNames()).toEqual([]);
      await filters.getByRole('button', { name: 'all · 2', exact: true }).click();
      expect((await undimmedNames()).sort()).toEqual(['Current', 'Mixed']);
      await toggle.check();
      expect((await undimmedNames()).sort()).toEqual(['Current', 'Mixed']);
      expect(await filters.getByRole('button', { name: 'flaky · 1', exact: true }).getAttribute('data-active')).not.toBe('true');
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    ['compare', 'full'], ['compare', 'self-contained'],
    ['audit', 'full'], ['audit', 'self-contained'],
  ] as const)('%s %s switches status summaries while retaining sort controls despite archived errors', async (pipeline, mode) => {
    const data = fixture(pipeline, mode);
    const mixed = data.tests.find((test) => test.name === 'Mixed')!;
    mixed.chips = [{ tag: 'broken', text: 'broken', color: 'gray', sortingWeight: 0 }];
    mixed.currentConfig = {
      chips: [{ tag: 'regression', text: 'regression', color: 'red', sortingWeight: 1 }],
      sorts: [{ tag: 'score', label: 'Score', color: 'red', value: 7, higherIsWorse: true }],
      runId: LATEST, measuredAt: 0,
    };
    mixed.outcomes = mixed.outcomes.map((outcome) => ({
      ...outcome, ...(outcome.executionDetails.viewport.label === 'phone' ? { outsideCurrentConfig: true } : {}),
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
      const filters = page.locator('.filterbar').first().getByRole('button');
      expect(await filters.allTextContents()).toEqual(['all · 2', 'passed · 1', 'regression · 1']);
      expect(await sort.getAttribute('data-active')).toBe('true');
      const toggle = page.getByRole('checkbox', { name: 'Show old runs', exact: true });
      for (const checked of [true, false]) {
        await toggle.setChecked(checked);
        expect(await filters.allTextContents()).toEqual(checked
          ? ['all · 3', 'broken · 2', 'passed · 1']
          : ['all · 2', 'passed · 1', 'regression · 1']);
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
  ] as const)('%s %s reveals config-excluded viewports only with old runs', async (pipeline, mode) => {
    const data = fixture(pipeline, mode);
    const mixed = data.tests.find((test) => test.name === 'Mixed')!;
    mixed.outcomes = mixed.outcomes.map((outcome) => ({
      ...outcome, ...(outcome.executionDetails.viewport.label === 'phone' ? { outsideCurrentConfig: true } : {}),
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
      const toggle = page.getByRole('checkbox', { name: 'Show old runs', exact: true });
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
      await page.getByRole('button', { name: 'passed · 1', exact: true }).click();
      const section = () => card.getByRole('button', { name: 'Accessibility visibility for all tests' });
      await section().click();
      for (const checked of [true, false]) {
        await toggle.setChecked(checked);
        expect(await names()).toEqual(['Mixed']);
        expect(await page.locator('input[type=search]').inputValue()).toBe('Mixed');
        expect(await page.getByRole('button', { name: checked ? 'passed · 2' : 'passed · 1', exact: true }).getAttribute('data-active')).toBe(checked ? 'false' : 'true');
        expect(await section().getAttribute('aria-expanded')).toBe('false');
        expect(await card.locator('[data-report-section="accessibility"] > .report-section__body').isHidden()).toBe(true);
      }
      await section().click();
      expect(await card.locator('[data-report-section="accessibility"]').getByRole('alert').isVisible()).toBe(true);
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
      const toggle = page.getByRole('checkbox', { name: 'Show old runs', exact: true });
      await toggle.check();
      expect((await names()).sort()).toEqual(['Current', 'Mixed', 'Older']);
      const older = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Older', exact: true }) });
      expect(await older.locator('.card__tags').textContent()).toContain('old run');
      expect(await older.locator('.old-run-chip').count()).toBe(0);
      await toggle.uncheck();
      expect((await names()).sort()).toEqual(['Current', 'Mixed']);

      await page.getByRole('button', { name: 'Accessibility visibility for all tests' }).first().click();
      await page.locator('input[type=search]').fill('Older');
      await toggle.check();
      await page.getByRole('button', { name: 'broken · 1', exact: true }).click();
      await toggle.uncheck();
      expect(await names()).toEqual([]);
      await toggle.check();
      expect(await names()).toEqual(['Older']);
      expect(await page.locator('input[type=search]').inputValue()).toBe('Older');
      expect(await page.getByRole('button', { name: 'broken · 1', exact: true }).getAttribute('data-active')).toBe('true');
      const section = page.getByRole('button', { name: 'Accessibility visibility for all tests' });
      expect(await section.getAttribute('aria-expanded')).toBe('false');
      expect(await older.getByRole('alert').count()).toBe(0);
      await toggle.uncheck();
      expect(await names()).toEqual([]);
      expect(await page.locator('input[type=search]').inputValue()).toBe('Older');
      expect(await page.getByRole('button', { name: 'broken · 1', exact: true }).count()).toBe(0);
      await toggle.check();
      expect(await names()).toEqual(['Older']);
      expect(await section.getAttribute('aria-expanded')).toBe('false');
      await section.click();
      expect(await older.getByRole('alert').count()).toBe(2);
    } finally {
      await page.close();
    }
  }, 30_000);
});
