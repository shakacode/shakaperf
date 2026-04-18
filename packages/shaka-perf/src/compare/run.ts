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
import { writeReport } from './report/render';
import type {
  Category,
  CategoryResult,
  ReportData,
  Status,
  TestResult,
} from './report/types';
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
    controlLighthouseHref: null,
    experimentLighthouseHref: null,
    timelineHref: null,
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

  // Run the engines sequentially (each launches its own browser).
  let visregByLabel = new Map<string, CategoryResult>();
  const htmlReportDir = path.join(resultsRoot, VISREG_SUBDIR);

  if (categories.includes('visreg')) {
    if (!opts.skipEngines) {
      console.log('\n>>> visreg');
      await invokeVisregEngine({
        controlURL,
        experimentURL,
        htmlReportDir,
        visregConfig,
        testFile: opts.testFile,
        testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
        filter: opts.filter ?? shared.filter,
      }).catch((err: Error) => {
        console.error(`visreg engine error: ${err.message}`);
      });
    }
    visregByLabel = harvestVisreg(htmlReportDir);
  }

  if (categories.includes('perf') && !opts.skipEngines) {
    console.log('\n>>> perf');
    await invokePerfEngine({
      controlURL,
      experimentURL,
      resultsFolder: resultsRoot,
      perfConfig,
      sharedConfig: shared,
      testFile: opts.testFile,
      testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
      filter: opts.filter ?? shared.filter,
    }).catch((err: Error) => {
      console.error(`perf engine error: ${err.message}`);
    });
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
}

function buildTestResult(opts: BuildTestResultOpts): TestResult {
  const { test, cwd, controlURL, experimentURL, perfConfig, resultsRoot, categories, visregByLabel } = opts;

  const slug = slugifyForBench(test.name);
  const perCategory: CategoryResult[] = [];

  if (categories.includes('visreg')) {
    perCategory.push(visregByLabel.get(test.name) ?? EMPTY_VISREG_CATEGORY);
  }
  if (categories.includes('perf')) {
    const perTestDir = path.join(resultsRoot, slug);
    if (fs.existsSync(perTestDir)) {
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
