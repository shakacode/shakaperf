import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { ReportData as PipelineReportData, TestResult } from '../../../pipeline/report';
import type { BisectReportModel, BisectReportTarget } from '../report-model';

type AppReportData = PipelineReportData & { bisect?: BisectReportModel };

const { App } = require('../../../../report-shell/src/App') as {
  App: ComponentType<{ data: AppReportData }>;
};

describe('bisect report App rendering', () => {
  it('renders the bisect navigator with semantic initial pressed state', () => {
    const html = renderApp({ ...ordinaryReport(), bisect: bisectModel() });

    expect(html).toContain('aria-label="Bisect report views"');
    expect(html).toContain('data-bisect-selection="all" aria-pressed="true"');
    expect(html).toMatch(/data-bisect-selection="commit"[^>]+aria-pressed="false"/);
  });

  it('omits the bisect navigator from an ordinary report', () => {
    const html = renderApp(ordinaryReport());

    expect(html).not.toContain('class="bisect-navigator"');
    expect(html).not.toContain('aria-label="Bisect report views"');
  });

  it('composes the initial card with both performance report stages', () => {
    const html = renderApp(ordinaryReport());
    const perfIndex = html.indexOf('data-stage="perf"');
    const lowNoiseIndex = html.indexOf('data-stage="perf-low-noise"');

    expect(html).toContain('<article class="card"');
    expect(html).toContain('<h3 class="card__title">Product page</h3>');
    expect(perfIndex).toBeGreaterThan(-1);
    expect(lowNoiseIndex).toBeGreaterThan(perfIndex);
  });
});

function renderApp(data: AppReportData): string {
  return renderToStaticMarkup(createElement(App, { data }));
}

function ordinaryReport(): AppReportData {
  return {
    meta: {
      title: 'Compare report',
      pipelineName: 'compare',
      generatedAt: '2026-07-13T00:00:00.000Z',
      controlUrl: 'http://control.test',
      experimentUrl: 'http://experiment.test',
      durationMs: 1_000,
      cwd: '/tmp/shaka-perf',
      errors: [],
      reportOnly: false,
      pipelineConfig: comparePipelineConfig(),
      reportMode: 'lightweight',
    },
    tests: [reportTest()],
  };
}

function reportTest(): TestResult {
  return {
    id: 'product-card',
    name: 'Product page',
    filePath: 'ab-tests/product.abtest.ts',
    startingPath: '/products/1',
    controlUrl: 'http://control.test/products/1',
    experimentUrl: 'http://experiment.test/products/1',
    code: null,
    chips: [],
    sorts: [],
    durationMs: 1_000,
    measuredAt: Date.UTC(2026, 6, 13),
    runId: null,
    outcomes: [
      {
        kind: 'error',
        stage: 'perf',
        error: { message: 'perf failed' },
        viewport: DESKTOP_VIEWPORT,
      },
      {
        kind: 'error',
        stage: 'perf-low-noise',
        error: { message: 'low-noise perf failed' },
        viewport: DESKTOP_VIEWPORT,
      },
    ],
    viewportArtifactPaths: [],
  };
}

function bisectModel(): BisectReportModel {
  const target: BisectReportTarget = {
    id: 'perf-target',
    category: 'perf',
    testId: 'product-card',
    testFile: 'ab-tests/product.abtest.ts',
    testName: 'Product page',
    viewport: 'desktop',
    subject: 'LCP regression',
    status: 'found',
  };
  return {
    status: 'complete',
    goodSha: '1111111111111111111111111111111111111111',
    badSha: '2222222222222222222222222222222222222222',
    generatedAt: '2026-07-13T00:00:00.000Z',
    commits: [
      {
        sha: '1111111111111111111111111111111111111111',
        subject: 'good baseline',
        position: 0,
        measured: false,
        counts: { visreg: 0, perf: 0, accessibility: 0 },
        targetIds: [],
      },
      {
        sha: '2222222222222222222222222222222222222222',
        subject: 'slow product page',
        position: 1,
        measured: true,
        counts: { visreg: 0, perf: 1, accessibility: 0 },
        targetIds: [target.id],
      },
    ],
    targets: [target],
    targetsById: { [target.id]: target },
    views: {
      unresolved: { targetIds: [] },
      invalid: { targetIds: [] },
    },
  };
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
