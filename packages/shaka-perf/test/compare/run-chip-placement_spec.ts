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
import { renderReportHtml, type ReportData, type ReportOutcome } from '../../src/pipeline/report';

const LATEST = '2026-10-02T00:00:00.000Z';
const OLD = '2026-10-01T00:00:00.000Z';
const IMAGE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTYwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjE2MCIgZmlsbD0iI2UyZTlmZiIvPjwvc3ZnPg==';

const violation = {
  ruleId: 'button-name', impact: 'serious', help: 'Name this button',
  helpUrl: 'https://example.test/button-name', tags: ['wcag2a'],
  nodes: [{ target: ['button'], html: '<button></button>', failureSummary: 'Name this button',
    bounds: { x: 10, y: 10, width: 40, height: 30 } }],
};
const config = { tags: ['wcag2a'], disableRules: [], includeRules: null };

type Example = { stage: ReportOutcome['stage']; measurement: unknown; heading: string };
const compare: Example[] = [
  { stage: 'visreg', measurement: [{ selector: 'viewport', controlImage: IMAGE, experimentImage: IMAGE,
    diffImage: null, misMatchPercentage: 0, diffPixels: 0, threshold: 0.1, diffBbox: null,
    savedByRetries: false }], heading: '.artifact-card__title' },
  ...(['perf', 'perf-low-noise'] as const).map((stage) => ({
    stage, measurement: { metrics: [] }, heading: '.report-section--nested > .report-section__head .report-section__title',
  })),
  { stage: 'accessibility', measurement: {
    control: { side: 'control', url: 'http://control.test', violations: [], blocked: true },
    experiment: { side: 'experiment', url: 'http://experiment.test', violations: [] },
    effectiveConfig: config, failOnViolation: true, findings: [],
    summary: { new: 0, fixed: 0, changed: 0, unchanged: 0, blocked: 1,
      newByImpact: {}, fixedByImpact: {}, changedByImpact: {} },
  }, heading: '.stage-section__head' },
];
const audit: Example[] = [
  { stage: 'audit', measurement: { metrics: [{ label: 'LCP', group: 'vitals', display: '1 s' }] },
    heading: '.report-section--nested > .report-section__head .report-section__title' },
  { stage: 'accessibility', measurement: { totalViolations: 1, failOnViolation: true,
    effectiveConfig: config, scans: [{ viewportLabel: 'desktop', viewport: DESKTOP_VIEWPORT,
      url: 'http://control.test', screenshot: { width: 240, height: 160, imageHref: IMAGE },
      violations: [violation] }] }, heading: '.stage-section__head' },
  { stage: 'code_coverage', measurement: { totalStatements: 10, coveredStatements: 8, files: 1 },
    heading: '.stage-section__head' },
  { stage: 'build_annotated_timeline', measurement: {
    frames: [{ timeMs: 0, imageHref: IMAGE, imgW: 240, imgH: 160, annotation: 'Page load' }],
  }, heading: '.stage-section__head' },
  { stage: 'agent-readiness', measurement: { raw: { ok: false, signals: null }, rendered: {
    textWords: 10, structuredData: { types: [] }, headings: { h1Count: 1 }, landmarks: {},
    images: { withAlt: 0, total: 0 }, links: { total: 1, nondescriptive: 0 },
  } }, heading: '.stage-section__head' },
  { stage: 'ai_summary', measurement: { summary: 'Saved summary' }, heading: '.report-section__head .report-section__title' },
];

function fixture(pipelineName: string, reportMode: 'full' | 'self-contained', examples: Example[]): ReportData {
  return {
    meta: { title: 'Run chip placement', pipelineName, pipelineConfig: {}, reportMode,
      generatedAt: LATEST, controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test',
      cwd: '/tmp/chip-placement', errors: [], durationMs: 0, reportOnly: true },
    tests: [{ id: 'Mixed', name: 'Mixed', filePath: 'suite.abtest.ts', startingPath: '/',
      controlUrl: 'http://control.test', experimentUrl: 'http://experiment.test', code: null,
      durationMs: 0, measuredAt: 0, runId: LATEST, chips: [], sorts: [], viewportArtifactPaths: [],
      outcomes: examples.flatMap(({ stage, measurement }) => [
        { kind: 'ok' as const, stage, measurement, viewport: DESKTOP_VIEWPORT, runId: OLD },
        { kind: 'ok' as const, stage, measurement, viewport: PHONE_VIEWPORT, runId: LATEST },
      ]),
    }],
  };
}

describe('contextual old-run chips', () => {
  let browser: Browser;
  let directory: string;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-chip-placement-'));
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['compare', compare], ['audit', audit],
  ] as const)('%s attributes freshness to its saved results', async (pipeline, examples) => {
    const mode = 'full';
    const file = path.join(directory, `${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(fixture(pipeline, mode, examples)));
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').waitFor();
      expect(await page.locator('.report-section__disclosure').count()).toBeGreaterThan(0);
      for (const { stage, heading } of examples) {
        const slot = page.locator(`.outcome-slot[data-stage="${stage}"]`);
        expect({ stage, chips: await slot.locator('.old-run-chip').allTextContents(), slots: await slot.count() }).toEqual({ stage, chips: ['old run'], slots: 1 });
        const headings = slot.locator(heading);
        // Summary renders only the first non-empty measurement. Every other
        // renderer must attribute the warning to desktop and leave phone clear.
        expect(await headings.first().locator('.old-run-chip').textContent()).toBe('old run');
        if (stage === 'ai_summary') {
          await slot.getByRole('button', { name: 'Summary visibility for all tests' }).click();
          expect(await headings.first().isVisible()).toBe(true);
          expect(await headings.first().locator('.old-run-chip').isVisible()).toBe(true);
        } else {
          expect(await headings.first().textContent()).toContain('desktop');
          expect(await headings.nth(1).textContent()).toContain('phone');
          expect(await headings.nth(1).locator('.old-run-chip').count()).toBe(0);
          if (stage === 'perf' || stage === 'perf-low-noise' || stage === 'audit') {
            await headings.first().getByRole('button').click();
            expect(await headings.first().isVisible()).toBe(true);
            expect(await headings.first().locator('.old-run-chip').isVisible()).toBe(true);
          }
        }
      }
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    ['', OLD, 'Selected phone summary', LATEST, false],
    ['  ', LATEST, 'Selected phone summary', OLD, true],
    ['Selected desktop summary', LATEST, 'Unused old summary', OLD, false],
    ['Selected desktop summary', OLD, 'Unused current summary', LATEST, true],
  ] as const)('attributes Summary freshness to the displayed measurement (%s / %s)', async (desktop, desktopRun, phone, phoneRun, stale) => {
    const data = fixture('audit', 'full', audit);
    for (const outcome of data.tests[0].outcomes.filter((item) => item.stage === 'ai_summary')) {
      outcome.measurement = { summary: outcome.viewport.label === 'desktop' ? desktop : phone };
      outcome.runId = outcome.viewport.label === 'desktop' ? desktopRun : phoneRun;
    }
    const file = path.join(directory, `summary-${stale}-${desktop.length}.html`);
    fs.writeFileSync(file, renderReportHtml(data));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      const slot = page.locator('.outcome-slot[data-stage="ai_summary"]');
      const heading = slot.getByRole('heading');
      expect(await heading.count()).toBe(1);
      expect(await heading.textContent()).toContain('Summary');
      expect(await heading.locator('.old-run-chip').count()).toBe(stale ? 1 : 0);
      expect(await slot.locator('.stage-artifact__content').textContent()).toBe(desktop.trim() ? desktop : phone);
      await heading.getByRole('button').click();
      expect(await heading.isVisible()).toBe(true);
      expect(await heading.locator('.old-run-chip').count()).toBe(stale ? 1 : 0);
      expect(await slot.locator('.report-section__body').isHidden()).toBe(true);
    } finally {
      await page.close();
    }
  });
});
