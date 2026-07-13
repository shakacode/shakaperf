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

jest.setTimeout(30_000);

const GOOD_SHA = '1111111111111111111111111111111111111111';
const VISUAL_SHA = '2222222222222222222222222222222222222222';
const CLEAN_SHA = '3333333333333333333333333333333333333333';
const BAD_SHA = '4444444444444444444444444444444444444444';

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
    await expectCount(nodes, 4);
    await expectCount(page.locator('.card:not(.card--missing-artifacts)'), 3);
    await expectCount(page.locator('.card--missing-artifacts'), 0);

    const visualNode = page.locator(`[data-bisect-sha="${VISUAL_SHA}"]`);
    await expectText(
      visualNode.locator('.bisect-counter[data-category="visreg"] strong'),
      '1',
    );
    await expectText(
      visualNode.locator('.bisect-counter[data-category="perf"] strong'),
      '0',
    );
    await visualNode.click();

    expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
    await expectCount(page.locator('.card:not(.card--missing-artifacts):not([data-dimmed="true"])'), 1);
    await expectCount(page.locator('.card:not(.card--missing-artifacts)[data-dimmed="true"]'), 2);
    const focusedCard = page.locator('.card:not(.card--missing-artifacts):not([data-dimmed="true"])');
    await expectText(focusedCard.locator('.card__title'), 'Homepage');
    await expectCount(focusedCard.locator('.outcome-slot[data-stage="visreg"]'), 1);
    await expectCount(page.locator('.outcome-slot[data-stage="perf"]'), 0);
    await expectCount(page.locator('.outcome-slot[data-stage="accessibility"]'), 0);

    await page.locator(`[data-bisect-sha="${CLEAN_SHA}"]`).click();
    await expectText(
      page.locator('.bisect-selection-summary__empty'),
      'No regressions begin at this commit.',
    );
    await expectCount(page.locator('.card:not(.card--missing-artifacts)[data-dimmed="true"]'), 3);

    await page.locator('[data-bisect-selection="unresolved"]').click();
    await expectText(page.locator('#bisect-selection-title'), 'Unresolved targets');
    await expectCount(page.locator('[data-target-id="unresolved-target"]'), 1);

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
    await visualNode.focus();
    expect(await visualNode.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await visualNode.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);

    await page.setViewportSize({ width: 430, height: 900 });
    expect(await tree.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column');

    const phoneBoxes = await nodeBoxes(page);
    expect(phoneBoxes[1].y).toBeGreaterThan(phoneBoxes[0].y);
    expect(Math.abs(phoneBoxes[1].x - phoneBoxes[0].x)).toBeLessThan(8);
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
        commit(VISUAL_SHA, 'change hero', true, [visualTarget.id], { visreg: 1, perf: 0, accessibility: 0 }),
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
    outcomes: stages.map((stage) => ({
      kind: 'error' as const,
      stage,
      error: { message: `${stage} fixture outcome` },
      viewport: DESKTOP_VIEWPORT,
    })),
    viewportArtifactPaths: [],
  };
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
) {
  return { sha, subject, measured, targetIds, counts, position: 0 };
}

function comparePipelineConfig() {
  return {
    parallelism: 1,
    visregDefaultMisMatchThreshold: 0.1,
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
