import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { ReportData as PipelineReportData, TestResult } from '../../../pipeline/report';
import type { BisectReportModel, BisectReportTarget } from '../report-model';

type AppReportData = PipelineReportData & { bisect?: BisectReportModel };
type InitialBisectSelection = { kind: 'commit'; sha: string };

const { App } = require('../../../../report-shell/src/App') as {
  App: ComponentType<{
    data: AppReportData;
    initialBisectSelection?: InitialBisectSelection;
  }>;
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

    expect(html).toContain('<div class="app">');
    expect(html).not.toContain('app--bisect');
    expect(html).not.toContain('class="bisect-navigator"');
    expect(html).not.toContain('aria-label="Bisect report views"');
  });

  it('keeps skipped-only ordinary tests in the missing-artifacts summary', () => {
    const data = ordinaryReport();
    data.tests = [{
      ...reportTest(),
      measuredAt: null,
      outcomes: [{
        kind: 'skipped',
        stage: 'visreg',
        reason: 'fixture skip',
        viewport: DESKTOP_VIEWPORT,
      }],
    }];

    const html = renderApp(data);

    expect(html).toContain('card--missing-artifacts');
    expect(html).not.toContain('<h3 class="card__title">Product page</h3>');
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

  it('renders a selected mixed-category commit with matching cards focused and owned stages visible', () => {
    const html = renderApp(bisectReport(), { kind: 'commit', sha: 'mixed-commit' });

    expect(html).toMatch(/data-bisect-sha="mixed-commit"[^>]+aria-pressed="true"/);
    expect(cardMarkup(html, 'Homepage')).not.toContain('data-dimmed="true"');
    expect(cardMarkup(html, 'Product page')).not.toContain('data-dimmed="true"');
    expect(cardMarkup(html, 'Unrelated page')).toContain('data-dimmed="true"');
    expect(cardMarkup(html, 'Homepage')).toContain('data-stage="visreg"');
    expect(cardMarkup(html, 'Product page')).toContain('data-stage="perf"');
    expect(cardMarkup(html, 'Product page')).toContain('data-stage="perf-low-noise"');
  });

  it('renders the empty summary and dims every card for a clean selected commit', () => {
    const html = renderApp(bisectReport(), { kind: 'commit', sha: 'clean-commit' });

    expect(html).toContain('No regressions begin at this commit.');
    expect(cardMarkup(html, 'Homepage')).toContain('data-dimmed="true"');
    expect(cardMarkup(html, 'Product page')).toContain('data-dimmed="true"');
    expect(cardMarkup(html, 'Unrelated page')).toContain('data-dimmed="true"');
  });

  it('renders persisted outcomes as cards when their measurement time is unknown', () => {
    const data = bisectReport();
    data.tests = data.tests.map((test) => ({ ...test, measuredAt: null }));

    const html = renderApp(data);

    expect(html).toContain('<h3 class="card__title">Homepage</h3>');
    expect(html).toContain('<h3 class="card__title">Product page</h3>');
    expect(html).toContain('<h3 class="card__title">Unrelated page</h3>');
    expect(html).not.toContain('card--missing-artifacts');
  });

  it('preserves skipped-only persisted cards in bisect reports', () => {
    const data = bisectReport();
    data.tests = [{
      ...reportTest(),
      measuredAt: null,
      outcomes: [{
        kind: 'skipped',
        stage: 'visreg',
        reason: 'fixture skip',
        viewport: DESKTOP_VIEWPORT,
      }],
    }];

    const html = renderApp(data);

    expect(html).toContain('<h3 class="card__title">Product page</h3>');
    expect(html).not.toContain('card--missing-artifacts');
    expect(html).toContain('1 skipped: fixture skip');
  });

  it('announces only the concise selection status', () => {
    const html = renderApp(bisectReport());

    expect(html).not.toMatch(/class="bisect-selection-summary"[^>]+aria-live/);
    expect(html).toContain(
      'class="bisect-selection-summary__status" aria-live="polite" aria-atomic="true"',
    );
  });

  it('marks bisect reports for isolated responsive styling', () => {
    const html = renderApp(bisectReport());

    expect(html).toContain('<div class="app app--bisect">');
  });
});

function renderApp(data: AppReportData, initialBisectSelection?: InitialBisectSelection): string {
  return renderToStaticMarkup(createElement(App, { data, initialBisectSelection }));
}

function cardMarkup(html: string, title: string): string {
  const titleIndex = html.indexOf(`<h3 class="card__title">${title}</h3>`);
  const start = html.lastIndexOf('<article', titleIndex);
  const end = html.indexOf('</article>', titleIndex);
  return html.slice(start, end + '</article>'.length);
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
  return testResult({
    id: 'product-card',
    name: 'Product page',
    startingPath: '/products/1',
    stages: ['perf', 'perf-low-noise'],
  });
}

function testResult({
  id,
  name,
  startingPath,
  stages,
}: {
  id: string;
  name: string;
  startingPath: string;
  stages: string[];
}): TestResult {
  return {
    id,
    name,
    filePath: `ab-tests/${id}.abtest.ts`,
    startingPath,
    controlUrl: `http://control.test${startingPath}`,
    experimentUrl: `http://experiment.test${startingPath}`,
    code: null,
    chips: [],
    sorts: [],
    durationMs: 1_000,
    measuredAt: Date.UTC(2026, 6, 13),
    runId: null,
    outcomes: stages.map((stage) => ({
      kind: 'error' as const,
      stage,
      error: { message: `${stage} failed` },
      viewport: DESKTOP_VIEWPORT,
    })),
    viewportArtifactPaths: [],
  };
}

function bisectReport(): AppReportData {
  const visualTarget = bisectTarget('visual-target', 'visreg', 'homepage-card', 'Visual regression');
  const perfTarget = bisectTarget('perf-target', 'perf', 'product-card', 'LCP regression');
  return {
    ...ordinaryReport(),
    tests: [
      testResult({ id: 'homepage-card', name: 'Homepage', startingPath: '/', stages: ['visreg'] }),
      reportTest(),
      testResult({
        id: 'unrelated-card',
        name: 'Unrelated page',
        startingPath: '/unrelated',
        stages: ['visreg', 'perf', 'perf-low-noise'],
      }),
    ],
    bisect: {
      status: 'complete',
      goodSha: 'good-commit',
      badSha: 'mixed-commit',
      generatedAt: '2026-07-13T00:00:00.000Z',
      commits: [
        {
          sha: 'good-commit',
          subject: 'good baseline',
          position: 0,
          measured: false,
          counts: { visreg: 0, perf: 0, accessibility: 0 },
          targetIds: [],
        },
        {
          sha: 'clean-commit',
          subject: 'refactor styles',
          position: 1,
          measured: false,
          counts: { visreg: 0, perf: 0, accessibility: 0 },
          targetIds: [],
        },
        {
          sha: 'mixed-commit',
          subject: 'ship regressions',
          position: 2,
          measured: true,
          counts: { visreg: 1, perf: 1, accessibility: 0 },
          targetIds: [visualTarget.id, perfTarget.id],
        },
      ],
      targets: [visualTarget, perfTarget],
      targetsById: {
        [visualTarget.id]: visualTarget,
        [perfTarget.id]: perfTarget,
      },
      views: {
        unresolved: { targetIds: [] },
        invalid: { targetIds: [] },
      },
    },
  };
}

function bisectTarget(
  id: string,
  category: BisectReportTarget['category'],
  testId: string,
  subject: string,
): BisectReportTarget {
  return {
    id,
    category,
    testId,
    testFile: `ab-tests/${testId}.abtest.ts`,
    testName: subject,
    viewport: 'desktop',
    subject,
    status: 'found',
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
