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

  it('keeps consecutive clean commit bundles between regression cards', () => {
    const html = renderApp(bisectReport());
    const firstBundle = html.indexOf('data-bisect-clean-run="0"');
    const firstRegression = html.indexOf('data-bisect-sha="mixed-commit"');
    const secondBundle = html.indexOf('data-bisect-clean-run="1"');
    const secondRegression = html.indexOf('data-bisect-sha="later-commit"');

    expect(html.match(/aria-label="2 commits with no first-bad regressions"/g)).toHaveLength(2);
    expect(html.match(/\[2 commits\]/g)).toHaveLength(2);
    expect(html).toContain('good baseline');
    expect(html).toContain('refactor styles');
    expect(html).toContain('update copy');
    expect(html).toContain('tune spacing');
    expect(html).not.toContain('data-bisect-sha="good-commit"');
    expect(html).not.toContain('data-bisect-sha="clean-commit"');
    expect(firstBundle).toBeGreaterThan(-1);
    expect(firstRegression).toBeGreaterThan(firstBundle);
    expect(secondBundle).toBeGreaterThan(firstRegression);
    expect(secondRegression).toBeGreaterThan(secondBundle);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(html.match(/data-bisect-clean-run-dialog=/g)).toHaveLength(2);
    expect(html.match(/data-bisect-selection="commit"/g)).toHaveLength(2);
  });

  it('groups regression targets into test cards with readable comparisons', () => {
    const html = renderApp(bisectReport());
    const homepageGroup = testGroupMarkup(html, 'homepage-card');

    expect(html.match(/data-bisect-test-group="homepage-card"/g)).toHaveLength(1);
    expect(homepageGroup).toContain('Homepage');
    expect(homepageGroup.match(/ab-tests\/homepage-card\.abtest\.ts/g)).toHaveLength(1);
    expect(homepageGroup).toContain('2 regression targets');
    expect(homepageGroup).toContain('visual');
    expect(homepageGroup).toContain('performance');
    expect(homepageGroup).toContain('class="bisect-perf-table"');
    expect(homepageGroup).toContain('<th>Metric</th>');
    expect(homepageGroup).toContain('<th>Control</th>');
    expect(homepageGroup).toContain('<th>Experiment</th>');
    expect(homepageGroup).toContain('<th>Delta</th>');
    expect(homepageGroup).toContain('<th>%Delta</th>');
    expect(homepageGroup).toContain('<th>p</th>');
    expect(homepageGroup).toContain('<dt>Control</dt>');
    expect(homepageGroup).toContain('<dt>Experiment</dt>');
    expect(homepageGroup).toContain('<dt>Change</dt>');
    expect(homepageGroup).toContain('1.8s');
    expect(homepageGroup).toContain('2.1s');
    expect(homepageGroup).toContain('+300ms');
    expect(homepageGroup).toContain('<td>0.007813</td>');
    expect(homepageGroup).not.toContain('controlDisplay');
    expect(homepageGroup).not.toContain('misMatchPercentage');
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

function testGroupMarkup(html: string, testId: string): string {
  const marker = `data-bisect-test-group="${testId}"`;
  const markerIndex = html.indexOf(marker);
  const start = html.indexOf('<article', markerIndex);
  const end = html.indexOf('</article>', markerIndex);
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
  const visualTarget = bisectTarget({
    id: 'visual-target',
    category: 'visreg',
    testId: 'homepage-card',
    testName: 'Homepage',
    subject: 'Hero section',
    values: { misMatchPercentage: 12.5, diffPixels: 4_200, threshold: 0.1 },
  });
  const homepagePerfTarget = bisectTarget({
    id: 'homepage-perf-target',
    category: 'perf',
    testId: 'homepage-card',
    testName: 'Homepage',
    subject: 'LCP',
    values: {
      controlDisplay: '1.8s',
      experimentDisplay: '2.1s',
      deltaDisplay: '+300ms',
      percentDisplay: '+16.7%',
      pValue: 0.007813,
    },
  });
  const perfTarget = bisectTarget({
    id: 'perf-target',
    category: 'perf',
    testId: 'product-card',
    testName: 'Product page',
    subject: 'LCP regression',
  });
  const accessibilityTarget = bisectTarget({
    id: 'accessibility-target',
    category: 'accessibility',
    testId: 'product-card',
    testName: 'Product page',
    subject: 'button-name',
  });
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
          counts: { visreg: 1, perf: 2, accessibility: 0 },
          targetIds: [visualTarget.id, homepagePerfTarget.id, perfTarget.id],
        },
        {
          sha: 'copy-commit',
          subject: 'update copy',
          position: 3,
          measured: true,
          counts: { visreg: 0, perf: 0, accessibility: 0 },
          targetIds: [],
        },
        {
          sha: 'spacing-commit',
          subject: 'tune spacing',
          position: 4,
          measured: false,
          counts: { visreg: 0, perf: 0, accessibility: 0 },
          targetIds: [],
        },
        {
          sha: 'later-commit',
          subject: 'break button labels',
          position: 5,
          measured: true,
          counts: { visreg: 0, perf: 0, accessibility: 1 },
          targetIds: [accessibilityTarget.id],
        },
      ],
      targets: [visualTarget, homepagePerfTarget, perfTarget, accessibilityTarget],
      targetsById: {
        [visualTarget.id]: visualTarget,
        [homepagePerfTarget.id]: homepagePerfTarget,
        [perfTarget.id]: perfTarget,
        [accessibilityTarget.id]: accessibilityTarget,
      },
      views: {
        unresolved: { targetIds: [] },
        invalid: { targetIds: [] },
      },
    },
  };
}

function bisectTarget({
  id,
  category,
  testId,
  testName,
  subject,
  values,
}: {
  id: string;
  category: BisectReportTarget['category'];
  testId: string;
  testName: string;
  subject: string;
  values?: Record<string, string | number | boolean | null>;
}): BisectReportTarget {
  return {
    id,
    category,
    testId,
    testFile: `ab-tests/${testId}.abtest.ts`,
    testName,
    viewport: 'desktop',
    subject,
    status: 'found',
    badRefObservation: values ? {
      targetId: id,
      commitSha: 'mixed-commit',
      present: true,
      values,
      artifacts: [],
    } : undefined,
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
