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
    stage, measurement: { metrics: [] }, heading: '.perf-viewport__label',
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
    heading: '.stage-section__head' },
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
  { stage: 'ai_summary', measurement: { summary: 'Saved summary' }, heading: '.stage-artifact__title' },
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
    ['compare', 'full', compare], ['compare', 'self-contained', compare],
    ['audit', 'full', audit], ['audit', 'self-contained', audit],
  ] as const)('%s %s labels stale result headings only', async (pipeline, mode, examples) => {
    const file = path.join(directory, `${pipeline}-${mode}.html`);
    fs.writeFileSync(file, renderReportHtml(fixture(pipeline, mode, examples)));
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(pathToFileURL(file).href);
      await page.locator('.card').waitFor();
      expect(await page.locator('.stage-filter').count()).toBe(0);
      expect(await page.locator('.outcome-slot__runs').count()).toBe(0);
      expect(await page.locator('.pill').allTextContents()).not.toEqual(expect.arrayContaining([
        expect.stringContaining('latest run'), expect.stringContaining('desktop · old run'),
      ]));
      for (const { stage, heading } of examples) {
        const slot = page.locator(`.outcome-slot[data-stage="${stage}"]`);
        expect({ stage, chips: await slot.locator('.old-run-chip').allTextContents(), slots: await slot.count() }).toEqual({ stage, chips: ['old run'], slots: 1 });
        const headings = slot.locator(heading);
        // Summary renders only the first non-empty measurement. Every other
        // renderer must attribute the warning to desktop and leave phone clear.
        expect(await headings.first().locator('.old-run-chip').textContent()).toBe('old run');
        if (stage !== 'ai_summary') {
          expect(await headings.first().textContent()).toContain('desktop');
          expect(await headings.nth(1).textContent()).toContain('phone');
          expect(await headings.nth(1).locator('.old-run-chip').count()).toBe(0);
        }
      }
    } finally {
      await page.close();
    }
  }, 30_000);
});
