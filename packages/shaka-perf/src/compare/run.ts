import * as path from 'path';
import * as fs from 'fs';
import {
  loadTests,
  findAbTestsConfig,
  loadAbTestsConfig,
  readTestSource,
  type AbTestDefinition,
} from 'shaka-shared';
import { parseAbTestsConfig, type AbTestsConfig, type VisregConfig, type PerfConfig } from './config';
import {
  writeReport,
  type Category,
  type CategoryResult,
  type ReportData,
  type Status,
  type TestResult,
} from './report';
import { invokeVisregEngine } from './engine-bridge/visreg';
import { invokePerfEngine } from './engine-bridge/perf';
import { harvestVisreg } from './harvest/visreg';
import { harvestPerf, slugifyForBench } from './harvest/perf';

export interface CompareRunOptions {
  cwd?: string;
  configPath?: string;
  categories?: Category[];
  testFile?: string;
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
const EMPTY_PERF_CATEGORY: CategoryResult = {
  category: 'perf',
  status: 'no_difference',
  perf: {
    metrics: [],
    regressedMetrics: [],
    improvedMetrics: [],
    controlLighthouseHref: null,
    experimentLighthouseHref: null,
    timelineHref: null,
    timelinePreviewSvg: null,
    benchReportHref: null,
    diffHrefs: [],
  },
};
const EMPTY_VISREG_CATEGORY: CategoryResult = {
  category: 'visreg',
  status: 'no_difference',
  visreg: [],
};

function combineStatus(perCategory: CategoryResult[]): Status {
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

export async function runCompare(opts: CompareRunOptions = {}): Promise<string> {
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
    testFile: opts.testFile,
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
          testFile: opts.testFile,
          testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
          filter: opts.filter ?? shared.filter,
        });
      } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`visreg engine error: ${message}`);
        engineErrors.push(`visreg engine: ${message}`);
      }
    }
    visregByLabel = harvestVisreg(htmlReportDir);
  }

  if (categories.includes('perf') && !opts.skipEngines) {
    console.log('\n>>> perf');
    // Pre-create each per-test dir so the bench engine's internal readdirSync
    // calls never ENOENT before a test has any profile files written.
    for (const test of tests) {
      fs.mkdirSync(path.join(resultsRoot, slugifyForBench(test.name)), { recursive: true });
    }
    try {
      await invokePerfEngine({
        controlURL,
        experimentURL,
        resultsFolder: resultsRoot,
        perfConfig,
        sharedConfig: shared,
        testFile: opts.testFile,
        testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
        filter: opts.filter ?? shared.filter,
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      console.error(`perf engine error: ${message}`);
      engineErrors.push(`perf engine: ${message}`);
      perfEngineFailed = true;
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
  return reportPath;
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
    const perTestDir = path.join(resultsRoot, slug);
    const reportJsonExists = fs.existsSync(path.join(perTestDir, 'report.json'));
    if (reportJsonExists) {
      perCategory.push(
        harvestPerf({
          perTestDir,
          controlURL,
          experimentURL,
          perfConfig,
          reportRoot: resultsRoot,
          slug,
        }),
      );
    } else if (perfEngineFailed) {
      perCategory.push({
        ...EMPTY_PERF_CATEGORY,
        error: 'perf engine aborted before measuring this test — see the error banner above',
      });
    } else {
      perCategory.push(EMPTY_PERF_CATEGORY);
    }
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
