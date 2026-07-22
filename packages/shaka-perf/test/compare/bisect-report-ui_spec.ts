/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { createComparePipeline } from '../../src/compare/compare-pipeline';
import { writeBisectReport } from '../../src/compare/bisect/report';
import type {
  BisectReportData,
  BisectReportTarget,
} from '../../src/compare/bisect/report-model';
import type { TestResult } from '../../src/pipeline/report';

jest.setTimeout(60_000);

const GOOD_SHA = '1111111111111111111111111111111111111111';
const PRE_VISUAL_SHA = '1212121212121212121212121212121212121212';
const VISUAL_SHA = '2222222222222222222222222222222222222222';
const CLEAN_SHA = '3333333333333333333333333333333333333333';
const BAD_SHA = '4444444444444444444444444444444444444444';
const SOURCE_BASE_SHA = '5555555555555555555555555555555555555555';
const SOURCE_CLEAN_SHA = '6666666666666666666666666666666666666666';
const SOURCE_BAD_SHA = '7777777777777777777777777777777777777777';

describe('compare bisect report browser acceptance', () => {
  let browser: Browser;
  let page: Page;
  let resultsDirectory: string;
  let reportUrl: string;

  beforeAll(async () => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-report-ui-'));
    const pipeline = createComparePipeline(comparePipelineConfig());
    reportUrl = pathToFileURL(writeBisectReport({
      resultsDirectory,
      data: reportData(),
      stages: pipeline.stages,
    })).href;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(reportUrl);
    await page.locator('.bisect-navigator').waitFor();
  });

  afterEach(async () => {
    await page.close();
  });

  it('filters saved bad-ref cards and renders every selection state', async () => {
    const nodes = page.locator('.bisect-node');
    await expectCount(nodes, 2);
    await expectCount(page.locator('[data-bisect-clean-run]'), 2);
    await expectText(
      page.locator('[data-bisect-clean-run="0"]'),
      '[2 commits]',
    );
    await expectText(page.locator('[data-bisect-clean-run="1"]'), '[1 commit]');
    expect(await page.locator('.bisect-tree__list').evaluate((element) => (
      Array.from(element.children).map((child) => {
        const cleanRun = child.querySelector('[data-bisect-clean-run]');
        const commit = child.querySelector('[data-bisect-sha]');
        return cleanRun
          ? `clean:${cleanRun.getAttribute('data-bisect-clean-run')}`
          : commit?.getAttribute('data-bisect-sha');
      })
    ))).toEqual(['clean:0', VISUAL_SHA, 'clean:1', BAD_SHA]);

    await page.locator('[data-bisect-clean-run="0"]').click();
    const cleanRunDialog = page.locator('.ui-dialog--compact[open]');
    await expectCount(cleanRunDialog, 1);
    await expectCount(cleanRunDialog.locator('.bisect-clean-run-dialog__commit'), 2);
    await expectText(cleanRunDialog, 'baseline');
    await expectText(cleanRunDialog, 'prepare hero');
    expect(await cleanRunDialog.evaluate((element) => element.getBoundingClientRect().width))
      .toBeLessThanOrEqual(720);
    await cleanRunDialog.locator('.ui-dialog__close').click();
    await expectCount(page.locator('.ui-dialog--compact[open]'), 0);

    await expectCount(page.locator('.card:not(.card--missing-artifacts)'), 3);
    await expectCount(page.locator('.card--missing-artifacts'), 0);

    const visualNode = page.locator(`[data-bisect-sha="${VISUAL_SHA}"]`);
    expect(await visualNode.getAttribute('aria-haspopup')).toBe('dialog');
    await expectText(
      visualNode.locator('[data-merge-investigation-status="complete"]'),
      'investigation: complete',
    );
    await expectText(
      visualNode.locator('.bisect-counter[data-category="visreg"] strong'),
      '1',
    );
    await expectText(
      visualNode.locator('.bisect-counter[data-category="perf"] strong'),
      '0',
    );
    await visualNode.click();

    const mergeDialog = page.locator('.ui-dialog[open]').filter({
      has: page.locator(`[data-bisect-merge-dialog="${VISUAL_SHA}"]`),
    });
    await expectCount(mergeDialog, 1);
    await expectCount(page.getByRole('dialog', { name: /merge investigation/i }), 1);
    expect(await mergeDialog.locator('.ui-dialog__surface').evaluate(
      (element) => element.getBoundingClientRect().height,
    )).toBeLessThan(700);
    expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
    await expectText(mergeDialog, 'prepare source branch');
    await expectText(mergeDialog, 'introduce hero regression');
    await expectText(
      mergeDialog.locator('[data-merge-source-result="responsible"]'),
      'hero diff',
    );
    await expectCount(mergeDialog.locator('[data-merge-source-result="clear"]'), 1);
    await page.keyboard.press('Escape');
    await expectCount(page.locator('.ui-dialog[open]'), 0);
    expect(await visualNode.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
    await expectCount(page.locator('.card:not(.card--missing-artifacts):not([data-dimmed="true"])'), 1);
    await expectCount(page.locator('.card:not(.card--missing-artifacts)[data-dimmed="true"]'), 2);
    const focusedCard = page.locator('.card:not(.card--missing-artifacts):not([data-dimmed="true"])');
    await expectText(focusedCard.locator('.card__title'), 'Homepage');
    await expectCount(focusedCard.locator('.outcome-slot[data-stage="visreg"]'), 1);
    await expectCount(focusedCard.locator('.artifact-card--compare'), 1);
    await expectCount(focusedCard.locator('.artifact-card__image img'), 3);
    expect(await focusedCard.locator('.artifact-card__image img').first().getAttribute('src'))
      .toMatch(/^data:image\/svg\+xml;base64,/);
    await expectCount(page.locator('.outcome-slot[data-stage="perf"]'), 0);
    await expectCount(page.locator('.outcome-slot[data-stage="accessibility"]'), 0);

    await page.locator('[data-bisect-selection="unresolved"]').click();
    await expectText(page.locator('#bisect-selection-title'), 'Unresolved targets');
    await expectCount(page.locator('[data-target-id="unresolved-target"]'), 1);
    await expectText(
      page.locator('[data-target-id="unresolved-target"] .bisect-perf-table__metric strong'),
      'CLS',
    );
    await expectText(
      page.locator('[data-bisect-test-group="product-card"] .bisect-test-group__header h3'),
      'Product',
    );
    await expectCount(page.locator('.card:not([data-dimmed="true"])'), 1);
    await expectText(page.locator('.card:not([data-dimmed="true"]) .card__title'), 'Product');
    await expectCount(
      page.locator('.card:not([data-dimmed="true"]) .outcome-slot[data-stage="perf"]'),
      1,
    );
    await expectCount(
      page.locator('.card:not([data-dimmed="true"]) .outcome-slot[data-stage="accessibility"]'),
      0,
    );

    await page.locator('[data-bisect-selection="invalid"]').click();
    await expectText(page.locator('#bisect-selection-title'), 'Invalid targets');
    await expectText(
      page.locator('[data-target-id="invalid-target"] .bisect-target__invalid-reason'),
      'target is already present at the good ref',
    );
  });

  it('uses keyboard-visible focus and switches the commit tree to phone flow', async () => {
    const tree = page.locator('.bisect-tree__list');
    expect(await tree.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('row');

    const desktopBoxes = await nodeBoxes(page);
    expect(desktopBoxes[1].x).toBeGreaterThan(desktopBoxes[0].x);
    expect(Math.abs(desktopBoxes[1].y - desktopBoxes[0].y)).toBeLessThan(8);

    const visualNode = page.locator(`[data-bisect-sha="${VISUAL_SHA}"]`);
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await visualNode.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    expect(await visualNode.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await visualNode.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await visualNode.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
    expect(await contrastAgainstWhite(page.locator('.bisect-navigator__stats dt').first()))
      .toBeGreaterThanOrEqual(4.5);
    expect(await contrastAgainstWhite(
      visualNode.locator('.bisect-counter[data-category="visreg"]'),
    )).toBeGreaterThanOrEqual(4.5);
    expect(await page.locator('[data-bisect-clean-run="0"]').evaluate(
      (element) => getComputedStyle(element).opacity,
    )).toBe('1');
    await page.keyboard.press('Enter');
    expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
    await expectCount(page.locator('.ui-dialog[open]'), 1);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 430, height: 900 });
    expect(await tree.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column');

    const phoneBoxes = await nodeBoxes(page);
    expect(phoneBoxes[1].y).toBeGreaterThan(phoneBoxes[0].y);
    expect(Math.abs(phoneBoxes[1].x - phoneBoxes[0].x)).toBeLessThan(8);
    await visualNode.click();
    const phoneDialog = page.locator('.ui-dialog[open]');
    expect(await phoneDialog.locator('.ui-dialog__surface').evaluate(
      (element) => element.getBoundingClientRect().width,
    )).toBeLessThanOrEqual(430);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  });
});

async function expectCount(locator: ReturnType<Page['locator']>, count: number): Promise<void> {
  expect(await locator.count()).toBe(count);
}

async function expectText(locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  expect((await locator.textContent())?.trim()).toContain(text);
}

async function nodeBoxes(page: Page): Promise<Array<{ x: number; y: number }>> {
  return page.locator('.bisect-node').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y };
  }));
}

async function contrastAgainstWhite(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluate((element) => {
    const components = getComputedStyle(element).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!components || components.length !== 3) return 0;
    const luminance = components
      .map((component) => component / 255)
      .map((component) => component <= 0.04045
        ? component / 12.92
        : ((component + 0.055) / 1.055) ** 2.4)
      .reduce((sum, component, index) => sum + component * [0.2126, 0.7152, 0.0722][index], 0);
    return 1.05 / (luminance + 0.05);
  });
}

function reportData(): BisectReportData {
  const visualTarget = target({
    id: 'visual-target',
    category: 'visreg',
    testId: 'homepage-card',
    testFile: 'ab-tests/homepage.abtest.ts',
    testName: 'Homepage',
    subject: 'hero diff',
    status: 'found',
    firstBadSha: VISUAL_SHA,
    mainlineFirstBadSha: VISUAL_SHA,
    mainlineIsMerge: true,
    mergeInvestigationStatus: 'complete',
    mergeResult: 'source-found',
    mergeSourceSha: SOURCE_BAD_SHA,
  });
  const perfTarget = target({
    id: 'perf-target',
    category: 'perf',
    testId: 'product-card',
    testFile: 'ab-tests/product.abtest.ts',
    testName: 'Product',
    subject: 'LCP',
    status: 'found',
    firstBadSha: BAD_SHA,
  });
  const accessibilityTarget = target({
    id: 'accessibility-target',
    category: 'accessibility',
    testId: 'checkout-card',
    testFile: 'ab-tests/checkout.abtest.ts',
    testName: 'Checkout',
    subject: 'button-name',
    status: 'found',
    firstBadSha: BAD_SHA,
  });
  const unresolvedTarget = target({
    id: 'unresolved-target',
    category: 'perf',
    testId: 'product-card',
    testFile: 'ab-tests/product.abtest.ts',
    testName: 'Product',
    subject: 'CLS',
    status: 'active',
  });
  const invalidTarget = target({
    id: 'invalid-target',
    category: 'accessibility',
    testId: 'checkout-card',
    testFile: 'ab-tests/checkout.abtest.ts',
    testName: 'Checkout',
    subject: 'link-name',
    status: 'invalid',
    invalidReason: 'target is already present at the good ref',
  });
  const targets = [
    visualTarget,
    perfTarget,
    accessibilityTarget,
    unresolvedTarget,
    invalidTarget,
  ];

  return {
    meta: {
      title: 'Synthetic compare bisect',
      pipelineName: 'compare',
      generatedAt: '2026-07-13T00:00:00.000Z',
      controlUrl: 'http://control.test',
      experimentUrl: 'http://experiment.test',
      durationMs: 1_000,
      cwd: '/tmp/shaka-perf',
      errors: [],
      reportOnly: false,
      pipelineConfig: comparePipelineConfig(),
      reportMode: 'full',
    },
    tests: [
      reportTest('homepage-card', 'Homepage', 'homepage', ['visreg', 'perf', 'accessibility']),
      reportTest('product-card', 'Product', 'product', ['perf', 'accessibility']),
      reportTest('checkout-card', 'Checkout', 'checkout', ['accessibility']),
    ],
    bisect: {
      status: 'complete',
      goodSha: GOOD_SHA,
      badSha: BAD_SHA,
      generatedAt: '2026-07-13T00:00:00.000Z',
      commits: [
        commit(GOOD_SHA, 'baseline', false, [], { visreg: 0, perf: 0, accessibility: 0 }),
        commit(PRE_VISUAL_SHA, 'prepare hero', true, [], { visreg: 0, perf: 0, accessibility: 0 }),
        commit(
          VISUAL_SHA,
          'change hero',
          true,
          [visualTarget.id],
          { visreg: 1, perf: 0, accessibility: 0 },
          {
            isMerge: true,
            mergeInvestigationStatus: 'complete',
            mergeInvestigation: {
              status: 'complete',
              mergeBase: SOURCE_BASE_SHA,
              secondParent: SOURCE_BAD_SHA,
              sourceCommits: [
                {
                  sha: SOURCE_CLEAN_SHA,
                  subject: 'prepare source branch',
                  measured: false,
                  isMerge: false,
                  targetIds: [],
                  counts: { visreg: 0, perf: 0, accessibility: 0 },
                },
                {
                  sha: SOURCE_BAD_SHA,
                  subject: 'introduce hero regression',
                  measured: true,
                  isMerge: false,
                  targetIds: [visualTarget.id],
                  counts: { visreg: 1, perf: 0, accessibility: 0 },
                },
              ],
              mergeIntroducedTargetIds: [],
            },
          },
        ),
        commit(CLEAN_SHA, 'refactor copy', false, [], { visreg: 0, perf: 0, accessibility: 0 }),
        commit(BAD_SHA, 'ship regressions', true, [perfTarget.id, accessibilityTarget.id], {
          visreg: 0,
          perf: 1,
          accessibility: 1,
        }),
      ],
      targets,
      targetsById: Object.fromEntries(targets.map((candidate) => [candidate.id, candidate])),
      views: {
        unresolved: { targetIds: [unresolvedTarget.id] },
        invalid: { targetIds: [invalidTarget.id] },
      },
    },
  };
}

function reportTest(
  id: string,
  name: string,
  fileStem: string,
  stages: string[],
): TestResult {
  return {
    id,
    name,
    filePath: `ab-tests/${fileStem}.abtest.ts`,
    startingPath: `/${fileStem}`,
    controlUrl: `http://control.test/${fileStem}`,
    experimentUrl: `http://experiment.test/${fileStem}`,
    code: null,
    chips: [],
    sorts: [],
    durationMs: 1_000,
    measuredAt: null,
    runId: null,
    outcomes: stages.map((stage) => stage === 'visreg' && id === 'homepage-card'
      ? ({
        kind: 'ok' as const,
        stage,
        measurement: [{
          selector: '#hero',
          controlImage: inlineImage('#111111'),
          experimentImage: inlineImage('#eeeeee'),
          diffImage: inlineImage('#ff0000'),
          misMatchPercentage: 12.5,
          diffPixels: 8,
          threshold: 0.1,
          diffBbox: null,
          savedByRetries: false,
        }],
        viewport: DESKTOP_VIEWPORT,
      })
      : ({
        kind: 'error' as const,
        stage,
        error: { message: `${stage} fixture outcome` },
        viewport: DESKTOP_VIEWPORT,
      })),
    viewportArtifactPaths: [],
  };
}

function inlineImage(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${color}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function target(input: Omit<BisectReportTarget, 'viewport'>): BisectReportTarget {
  return { ...input, viewport: DESKTOP_VIEWPORT.label };
}

function commit(
  sha: string,
  subject: string,
  measured: boolean,
  targetIds: string[],
  counts: { visreg: number; perf: number; accessibility: number },
  merge: Pick<
    BisectReportData['bisect']['commits'][number],
    'isMerge' | 'mergeInvestigationStatus' | 'mergeInvestigation'
  > = {},
) {
  return { sha, subject, measured, targetIds, counts, position: 0, ...merge };
}

function comparePipelineConfig() {
  return {
    parallelism: 1,
    visregMismatchThreshold: 0.1,
    visregMaxNumDiffPixels: 50,
    visregComparePixelmatchThreshold: 0.1,
    visregEngineOptions: {},
    visregCompareRetries: 0,
    visregCompareRetryDelay: 0,
    perfNumberOfMeasurements: 1,
    perfRegressionThreshold: 0.1,
    perfPValueThreshold: 0.05,
    perfRegressionThresholdStat: 'estimator' as const,
    perfSamplingMode: 'simultaneous' as const,
  };
}
