import * as path from 'path';
import * as fs from 'fs';
import {
  loadTests,
  findAbTestsConfig,
  loadAbTestsConfig,
  readTestSource,
  embedAsBase64,
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
  VisregArtifact,
  PerfArtifact,
} from './report/types';
import { runVisregForTest, withBrowser, type VisregRunOutput } from './runners/run-visreg';
import { runPerfForTest, type PerfRunOutput } from './runners/run-perf';

export interface CompareRunOptions {
  cwd?: string;
  configPath?: string;
  categories?: Category[];
  testPathPattern?: string;
  filter?: string;
  controlURL?: string;
  experimentURL?: string;
}

const DEFAULT_CATEGORIES: Category[] = ['visreg', 'perf'];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';
}

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

function visregOutputToCategory(out: VisregRunOutput): CategoryResult {
  const artifacts: VisregArtifact[] = out.results.map((r) => ({
    viewportLabel: r.viewportLabel,
    selector: r.selector,
    controlImage: embedAsBase64(r.controlPath) ?? '',
    experimentImage: embedAsBase64(r.experimentPath) ?? '',
    diffImage: r.diffPath ? embedAsBase64(r.diffPath) : null,
    misMatchPercentage: r.misMatchPercentage,
    diffPixels: r.diffPixels,
    threshold: r.threshold,
  }));
  const status: Status = out.results.some((r) => r.changed) ? 'visual_change' : 'no_difference';
  return { category: 'visreg', status, visreg: artifacts };
}

function perfOutputToCategory(out: PerfRunOutput, perfConfig: PerfConfig): CategoryResult {
  const perf: PerfArtifact = {
    metrics: out.metrics.map((m) => ({
      label: m.label,
      controlMs: m.controlMs,
      experimentMs: m.experimentMs,
      pValue: m.pValue,
      hlDiffMs: m.hlDiffMs,
      significant: m.significant,
    })),
    controlLighthouseHref: null,
    experimentLighthouseHref: null,
    timelineHref: null,
    diffHrefs: [],
  };

  const regressionThresholdMs = perfConfig.regressionThreshold ?? 0;
  let status: Status = 'no_difference';
  for (const m of out.metrics) {
    if (!m.significant) continue;
    if (m.label !== 'dom content loaded' && m.label !== 'load event') continue;
    if (m.hlDiffMs > regressionThresholdMs) {
      status = 'regression';
      break;
    }
    if (m.hlDiffMs < -regressionThresholdMs) {
      status = 'improvement';
    }
  }
  return { category: 'perf', status, perf };
}

function logTestHeader(idx: number, total: number, test: AbTestDefinition): void {
  console.log(`\n[${idx + 1}/${total}] ${test.name} · ${test.startingPath}`);
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

  const tests = await loadTests({
    testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
    filter: opts.filter ?? shared.filter,
    log: (msg) => console.log(msg),
  });

  // Reset the results directory to keep stale artifacts from leaking in.
  fs.rmSync(resultsRoot, { recursive: true, force: true });
  fs.mkdirSync(resultsRoot, { recursive: true });

  const startedAt = Date.now();
  const testResults: TestResult[] = [];

  await withBrowser(async (browser) => {
    for (let idx = 0; idx < tests.length; idx++) {
      const test = tests[idx];
      logTestHeader(idx, tests.length, test);

      const slug = slugify(test.name);
      const perTestDir = path.join(resultsRoot, slug);
      fs.mkdirSync(perTestDir, { recursive: true });

      const perCategory: CategoryResult[] = [];
      const testStart = Date.now();

      if (categories.includes('visreg')) {
        const visregDir = path.join(perTestDir, 'visreg');
        const out = await runVisregForTest({
          test,
          outDir: visregDir,
          controlURL,
          experimentURL,
          visregConfig,
          browser,
        });
        if (out.errored) {
          console.log(`  visreg error: ${out.errored}`);
        } else {
          console.log(`  visreg: ${out.results.length} captures`);
        }
        perCategory.push(visregOutputToCategory(out));
      }

      if (categories.includes('perf')) {
        const perfDir = path.join(perTestDir, 'perf');
        const out = await runPerfForTest({
          test,
          outDir: perfDir,
          controlURL,
          experimentURL,
          perfConfig,
          browser,
        });
        if (out.errored) {
          console.log(`  perf error: ${out.errored}`);
        } else {
          console.log(`  perf: ${out.metrics.length} metrics`);
        }
        perCategory.push(perfOutputToCategory(out, perfConfig));
      }

      const relPath = test.file ? path.relative(cwd, test.file) : '(unknown source)';
      testResults.push({
        id: slug,
        name: test.name,
        filePath: relPath,
        startingPath: test.startingPath,
        controlUrl: new URL(test.startingPath, controlURL).href,
        experimentUrl: new URL(test.startingPath, experimentURL).href,
        code: readTestSource(test.file, test.line),
        status: combineStatus(perCategory),
        durationMs: Date.now() - testStart,
        categories: perCategory,
      });
    }
  });

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
