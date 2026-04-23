import * as path from 'path';
import * as fs from 'fs';
import {
  loadTests,
  findAbTestsConfig,
  loadAbTestsConfig,
  readTestSource,
  type AbTestDefinition,
} from 'shaka-shared';
import {
  parseAbTestsConfig,
  type AbTestsConfig,
  type Viewport,
  type VisregConfig,
  type PerfConfig,
} from './config';
import {
  writeReport,
  type Category,
  type CategoryResult,
  type PerfArtifact,
  type ReportData,
  type Status,
  type TestResult,
} from './report';
import { invokeVisregEngine } from './engine-bridge/visreg';
import { invokePerfEngine } from './engine-bridge/perf';
import { harvestVisreg } from './harvest/visreg';
import {
  harvestPerf,
  readPerfEngineError,
  readPerfEngineLog,
  slugifyForBench,
  statusFromPerfs,
} from './harvest/perf';

export interface CompareRunOptions {
  cwd?: string;
  configPath?: string;
  categories?: Category[];
  testPathPattern?: string;
  filter?: string;
  controlURL?: string;
  experimentURL?: string;
  /**
   * Re-harvest + re-render the HTML report from whatever artifacts already
   * live in `compare-results/`, skipping the visreg and perf engine runs.
   * Useful when iterating on report/harvest code.
   */
  skipEngines?: boolean;
}

const DEFAULT_CATEGORIES: Category[] = ['visreg', 'perf'];
const VISREG_SUBDIR = '_visreg/html_report';

/**
 * Per-viewport subfolder under `resultsRoot` where the bench engine writes
 * its per-test artifacts for that pass. Keeping each pass in its own subtree
 * means a second viewport's run doesn't clobber the first one's reports.
 */
function perfRootFor(resultsRoot: string, viewport: Viewport): string {
  return path.join(resultsRoot, `perf-${viewport.label}`);
}

/**
 * Viewports a single perf test should be measured at. `options.perf.viewports`
 * overrides the global `perfConfig.viewports` default when present and
 * non-empty.
 */
function perfViewportsForTest(test: AbTestDefinition, perfConfig: PerfConfig): Viewport[] {
  const override = test.options.perf?.viewports;
  return override && override.length > 0 ? override : perfConfig.viewports;
}

function emptyPerfArtifact(viewportLabel: string): PerfArtifact {
  return {
    viewportLabel,
    metrics: [],
    regressedMetrics: [],
    improvedMetrics: [],
    controlLighthouseHref: null,
    experimentLighthouseHref: null,
    timelineHref: null,
    timelinePreviewSvg: null,
    benchReportHref: null,
    diffHrefs: [],
  };
}

const EMPTY_VISREG_CATEGORY: CategoryResult = {
  category: 'visreg',
  status: 'no_difference',
  visreg: [],
};

function hasPerfError(perCategory: CategoryResult[]): boolean {
  // Per-viewport perf failures live on individual PerfArtifacts (so one bad
  // viewport doesn't erase another's metrics); surface them here so a test
  // with any measurement failure still gets the `error` status at the top.
  return perCategory.some((c) => c.perfs?.some((p) => p.error));
}

function combineStatus(perCategory: CategoryResult[]): Status {
  // Error wins over signed signals: a test whose measurement failed cannot
  // truthfully claim a regression or improvement — surface the failure first
  // so the card styling and status filter show it as `error`.
  if (perCategory.some((c) => c.error) || hasPerfError(perCategory)) return 'error';
  if (perCategory.some((c) => c.status === 'regression')) return 'regression';
  if (perCategory.some((c) => c.status === 'visual_change')) return 'visual_change';
  if (perCategory.some((c) => c.status === 'improvement')) return 'improvement';
  return 'no_difference';
}

async function loadConfig(opts: CompareRunOptions): Promise<AbTestsConfig> {
  const configPath = opts.configPath ?? findAbTestsConfig(opts.cwd);
  if (!configPath) {
    return parseAbTestsConfig({});
  }
  const raw = await loadAbTestsConfig(configPath);
  return parseAbTestsConfig(raw);
}

export interface CompareRunResult {
  reportPath: string;
  /**
   * Whether the run surfaced any failures (visreg mismatches, perf regressions,
   * or engine errors). The CLI exits non-zero when true so CI pipelines treat
   * the run as a failed assertion rather than a successful report.
   */
  hasFailures: boolean;
  /** Human-readable summary of what failed — empty string when !hasFailures. */
  failureSummary: string;
}

export async function runCompare(opts: CompareRunOptions = {}): Promise<CompareRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig(opts);
  const shared = config.shared ?? {};
  const visregConfig: VisregConfig = config.visreg ?? {};
  const perfConfig: PerfConfig = config.perf ?? {};

  const controlURL = opts.controlURL ?? shared.controlURL ?? 'http://localhost:3020';
  const experimentURL = opts.experimentURL ?? shared.experimentURL ?? 'http://localhost:3030';
  const resultsRoot = path.resolve(cwd, shared.resultsFolder ?? 'compare-results');
  const categories = opts.categories ?? DEFAULT_CATEGORIES;

  // Load tests once up-front so we know the full set before delegating; both
  // engines also call loadTests() internally with the same inputs, producing
  // identical test selection.
  const tests = await loadTests({
    testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
    filter: opts.filter ?? shared.filter,
    log: (msg) => console.log(msg),
  });

  if (!opts.skipEngines) {
    // Wipe stale artifacts so the harvester never reads last run's files.
    fs.rmSync(resultsRoot, { recursive: true, force: true });
    fs.mkdirSync(resultsRoot, { recursive: true });
  }

  const startedAt = Date.now();
  const engineErrors: string[] = [];
  let perfEngineFailed = false;

  // Run the engines sequentially (each launches its own browser).
  let visregByLabel = new Map<string, CategoryResult>();
  const htmlReportDir = path.join(resultsRoot, VISREG_SUBDIR);

  if (categories.includes('visreg')) {
    if (!opts.skipEngines) {
      console.log('\n>>> visreg');
      try {
        await invokeVisregEngine({
          controlURL,
          experimentURL,
          htmlReportDir,
          visregConfig,
          testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
          filter: opts.filter ?? shared.filter,
        });
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`visreg engine error: ${message}`);
        engineErrors.push(`visreg engine: ${message}`);
      }
    }
    try {
      visregByLabel = harvestVisreg(htmlReportDir);
    } catch (err) {
      const message = (err as Error).message || String(err);
      console.error(`visreg harvest error: ${message}`);
      engineErrors.push(`visreg harvest: ${message}`);
    }
  }

  // Bucket tests by the perf viewport they asked for — global default or
  // a per-test override. Each bucket becomes one bench pass; a test that
  // wants both desktop and phone shows up in both buckets.
  const perfBuckets = new Map<string, { viewport: Viewport; tests: AbTestDefinition[] }>();
  for (const test of tests) {
    for (const viewport of perfViewportsForTest(test, perfConfig)) {
      const bucket = perfBuckets.get(viewport.label);
      if (bucket) bucket.tests.push(test);
      else perfBuckets.set(viewport.label, { viewport, tests: [test] });
    }
  }

  if (categories.includes('perf') && !opts.skipEngines) {
    for (const { viewport, tests: bucketTests } of perfBuckets.values()) {
      console.log(`\n>>> perf · ${viewport.label}`);
      const perfRoot = perfRootFor(resultsRoot, viewport);
      // Pre-create each per-test dir so the bench engine's internal readdirSync
      // calls never ENOENT before a test has any profile files written.
      for (const test of bucketTests) {
        fs.mkdirSync(path.join(perfRoot, slugifyForBench(test.name)), { recursive: true });
      }
      // Anchored regex-per-name joined with commas (bench treats commas as
      // OR, full regex per piece) restricts the pass to exactly these
      // tests even when the user's global filter would pull in more.
      const filter = bucketTests
        .map((t) => `^${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
        .join(',');
      try {
        await invokePerfEngine({
          controlURL,
          experimentURL,
          resultsFolder: perfRoot,
          perfConfig,
          sharedConfig: shared,
          viewport,
          testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
          filter,
        });
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`perf engine error (${viewport.label}): ${message}`);
        engineErrors.push(`perf engine (${viewport.label}): ${message}`);
        perfEngineFailed = true;
      }
    }
  }

  const testResults: TestResult[] = tests.map((test) =>
    buildTestResult({
      test,
      cwd,
      controlURL,
      experimentURL,
      perfConfig,
      resultsRoot,
      categories,
      visregByLabel,
      perfEngineFailed,
    }),
  );

  const data: ReportData = {
    meta: {
      title: path.basename(cwd) + ' · compare',
      generatedAt: new Date().toISOString(),
      controlUrl: controlURL,
      experimentUrl: experimentURL,
      durationMs: Date.now() - startedAt,
      cwd,
      categories,
      errors: engineErrors,
    },
    tests: testResults,
  };

  const reportPath = writeReport(data, resultsRoot);
  fs.writeFileSync(
    path.join(resultsRoot, 'report.json'),
    JSON.stringify(data, null, 2),
  );

  return {
    reportPath,
    ...summarizeFailures(data),
  };
}

function summarizeFailures(data: ReportData): { hasFailures: boolean; failureSummary: string } {
  let regressions = 0;
  let visualChanges = 0;
  let errors = 0;
  for (const t of data.tests) {
    // Visit every category directly — a single test can be both errored and
    // visually changed (or regressed + improved across different metrics),
    // and the combined `test.status` hides all but the top-ranked one.
    for (const c of t.categories) {
      if (c.error) errors++;
      if (c.category === 'perf') {
        // One perf card carries N viewports; count each viewport's regressions
        // and per-viewport errors separately so multi-viewport failures land
        // in the summary line with the right count.
        for (const p of c.perfs ?? []) {
          if (p.error) errors++;
          if (p.regressedMetrics.length > 0) regressions++;
        }
      }
      if (c.category === 'visreg' && c.status === 'visual_change') visualChanges++;
    }
  }
  if (data.meta.errors.length > 0) errors += data.meta.errors.length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (regressions > 0) parts.push(`${regressions} perf regression${regressions === 1 ? '' : 's'}`);
  if (visualChanges > 0) parts.push(`${visualChanges} visreg mismatch${visualChanges === 1 ? '' : 'es'}`);
  return {
    hasFailures: parts.length > 0,
    failureSummary: parts.join(', '),
  };
}

interface BuildTestResultOpts {
  test: AbTestDefinition;
  cwd: string;
  controlURL: string;
  experimentURL: string;
  perfConfig: PerfConfig;
  resultsRoot: string;
  categories: Category[];
  visregByLabel: Map<string, CategoryResult>;
  perfEngineFailed: boolean;
}

function buildTestResult(opts: BuildTestResultOpts): TestResult {
  const { test, cwd, controlURL, experimentURL, perfConfig, resultsRoot, categories, visregByLabel, perfEngineFailed } = opts;

  const slug = slugifyForBench(test.name);
  const perCategory: CategoryResult[] = [];

  if (categories.includes('visreg')) {
    const visregResult = visregByLabel.get(test.name);
    if (visregResult) {
      perCategory.push(visregResult);
    } else {
      // Visreg engine ran but this test has no pairs in the manifest —
      // commonly means the engine aborted before capturing this test.
      perCategory.push({
        ...EMPTY_VISREG_CATEGORY,
        error: 'visreg did not produce artifacts for this test',
      });
    }
  }
  if (categories.includes('perf')) {
    // One PerfArtifact per viewport this test was measured at, collected
    // into a single `CategoryResult.perfs` — mirrors how visreg packs N
    // per-viewport pairs into one `CategoryResult.visreg`.
    const perfs: PerfArtifact[] = [];
    for (const viewport of perfViewportsForTest(test, perfConfig)) {
      const perfRoot = perfRootFor(resultsRoot, viewport);
      const perTestDir = path.join(perfRoot, slug);
      const reportJsonExists = fs.existsSync(path.join(perTestDir, 'report.json'));
      const perTestEngineError = readPerfEngineError(perTestDir);
      const viewportLabel = viewport.label;
      if (reportJsonExists) {
        try {
          perfs.push(
            harvestPerf({
              perTestDir,
              controlURL,
              experimentURL,
              perfConfig,
              reportRoot: resultsRoot,
              slug,
              viewportLabel,
            }),
          );
        } catch (err) {
          const message = (err as Error).message || String(err);
          perfs.push({
            ...emptyPerfArtifact(viewportLabel),
            error: `perf report unreadable: ${message}`,
            errorLog: readPerfEngineLog(perTestDir),
          });
        }
      } else if (perTestEngineError) {
        perfs.push({
          ...emptyPerfArtifact(viewportLabel),
          error: `perf measurement failed: ${perTestEngineError}`,
          errorLog: readPerfEngineLog(perTestDir),
        });
      } else if (perfEngineFailed) {
        perfs.push({
          ...emptyPerfArtifact(viewportLabel),
          error: 'perf engine aborted before measuring this test — see the error banner above',
        });
      } else {
        perfs.push(emptyPerfArtifact(viewportLabel));
      }
    }
    perCategory.push({
      category: 'perf',
      status: statusFromPerfs(perfs),
      perfs,
    });
  }

  const relFilePath = test.file ? path.relative(cwd, test.file) : '(unknown source)';
  return {
    id: slug,
    name: test.name,
    filePath: relFilePath,
    startingPath: test.startingPath,
    controlUrl: new URL(test.startingPath, controlURL).href,
    experimentUrl: new URL(test.startingPath, experimentURL).href,
    code: readTestSource(test.file, test.line),
    status: combineStatus(perCategory),
    durationMs: 0,
    categories: perCategory,
  };
}
