import * as path from 'path';
import * as fs from 'fs';
import {
  loadTests,
  findAbTestsConfig,
  loadAbTestsConfig,
  readTestSource,
  testRunsForType,
  type AbTestDefinition,
  type TestType,
} from 'shaka-shared';
import {
  parseAbTestsConfig,
  type AbTestsConfig,
  type Viewport,
} from './config';
import {
  writeReport,
  type CategoryResult,
  type ReportData,
  type Status,
  type TestResult,
} from './report';
import { invokeVisregEngine } from './engine-bridge/visreg';
import { invokePerfEngine } from './engine-bridge/perf';
import { slugifyForBench } from './harvest/perf';
import { CATEGORY_DEFS } from './categories';

export interface CompareRunOptions {
  cwd?: string;
  configPath?: string;
  categories?: TestType[];
  testPathPattern?: string;
  filter?: string;
  controlURL?: string;
  experimentURL?: string;
  /**
   * Re-harvest + re-render the HTML report from whatever artifacts already
   * live in `compare-results/`, skipping the visreg and perf engine runs.
   * Useful when iterating on report/harvest code and as the final assembly
   * step in sharded CI runs where shards produced artifacts with
   * `skipReport: true`.
   */
  reportOnly?: boolean;
  /**
   * Run both engines normally, but don't produce the top-level
   * `report.html` / `report.json`. Intended for CI shards that measure a
   * subset of tests and leave final report assembly to a downstream
   * `reportOnly` run over merged artifacts. Engine errors are persisted
   * to `<resultsRoot>/.shaka-engine-errors.json` so the assembler can
   * surface them even though nothing was held in memory across processes.
   */
  skipReport?: boolean;
}

const ENGINE_ERRORS_FILE = '.shaka-engine-errors.json';

interface PersistedEngineErrors {
  engineErrors: string[];
  perfEngineFailedByLabel: string[];
}

const DEFAULT_CATEGORIES: TestType[] = ['visreg', 'perf'];

/**
 * Per-viewport subfolder under `resultsRoot` where the bench engine writes
 * its per-test artifacts for that pass. Keeping each pass in its own subtree
 * means a second viewport's run doesn't clobber the first one's reports.
 */
function perfRootFor(resultsRoot: string, viewport: Viewport): string {
  return path.join(resultsRoot, `perf-${viewport.label}`);
}

/**
 * Resolves the viewports a single test should run at for a given category.
 * Returns the intersection of the category's `viewports` and the test's
 * `options.viewports` narrow (if any). An empty result means the category
 * is SKIPPED for this test — callers surface it as `status: 'skipped'`.
 *
 * Config-level viewports are validated by Zod; per-test `options.viewports`
 * bypasses Zod (plain-TS test files) so unknown labels are silently
 * ignored here — they just won't intersect with anything.
 */
function resolveViewportsForTest(
  test: AbTestDefinition,
  categoryViewports: Viewport[],
): Viewport[] {
  const narrow = test.options.viewports;
  if (!narrow || narrow.length === 0) return categoryViewports;
  const narrowSet = new Set(narrow);
  return categoryViewports.filter((v) => narrowSet.has(v.label));
}

/**
 * Shared empty-category result for a test that has no on-disk artifacts
 * for this category at any resolved viewport. Perf and visreg both read
 * per-(viewport, slug) `report.json` files now; when the harvester finds
 * none of them, the resulting CategoryResult carries the same error
 * message regardless of which engine was missing so the report surface
 * is consistent. Matches `missingArtifactsErrorMessage(category)` so the
 * text is composed in one place.
 */
function missingArtifactsCategory(category: TestType): CategoryResult {
  const error = missingArtifactsErrorMessage(category);
  if (category === 'perf') {
    return { testType: 'perf', status: 'no_difference', artifacts: [], error };
  }
  return { testType: 'visreg', status: 'no_difference', artifacts: [], error };
}

function missingArtifactsErrorMessage(category: TestType): string {
  return `${category} did not produce artifacts for this test`;
}

function combineStatus(perCategory: CategoryResult[]): Status {
  // Skipped categories (viewport-filter narrow or testTypes opt-out) have
  // `status === 'skipped'` — none of the status checks below match them,
  // so they naturally don't drag the combined status.
  //
  // Error wins over signed signals: a test whose measurement failed cannot
  // truthfully claim a regression or improvement — surface the failure first
  // so the card styling and status filter show it as `error`. The perf
  // CategoryResult already folds per-viewport errors into its own
  // `c.status === 'error'`, so the single check covers both category-wide
  // visreg errors and per-viewport perf errors.
  if (perCategory.some((c) => c.error || c.status === 'error')) return 'error';
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
  if (opts.skipReport && opts.reportOnly) {
    throw new Error('--skip-report and --report-only are mutually exclusive');
  }
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig(opts);
  const { shared, visreg: visregConfig, perf: perfConfig } = config;

  const controlURL = opts.controlURL ?? shared.controlURL;
  const experimentURL = opts.experimentURL ?? shared.experimentURL;
  const resultsRoot = path.resolve(cwd, shared.resultsFolder);
  const categories = opts.categories ?? DEFAULT_CATEGORIES;

  // Load tests once up-front so we know the full set before delegating; both
  // engines also call loadTests() internally with the same inputs, producing
  // identical test selection.
  //
  // `--report-only` intentionally ignores filters. Shards may have measured
  // disjoint subsets via --filter/--testPathPattern; the assembly step needs
  // the full test set so it can fold every shard's artifacts into one report.
  // Any narrowing here would silently drop results the shards already wrote
  // to disk.
  const tests = await loadTests({
    testPathPattern: opts.reportOnly ? undefined : (opts.testPathPattern ?? shared.testPathPattern),
    filter: opts.reportOnly ? undefined : (opts.filter ?? shared.filter),
    log: (msg) => console.log(msg),
  });

  // Ensure the results root exists without wiping prior artifacts. CI shards
  // (`skipReport`) and the final assembly run (`reportOnly`) both rely on
  // earlier per-test dirs being present; local iterative runs rely on the
  // harvester only looking up artifacts by test slug, so stale sibling dirs
  // from deleted tests are harmless noise.
  if (!opts.reportOnly) {
    fs.mkdirSync(resultsRoot, { recursive: true });
    // Persisted engine errors belong to exactly one measurement pass. Any file
    // lingering from a prior `--skip-report` run would be read by a later
    // `--report-only` assembler as if it were ours — either surfacing stale
    // errors or (after this run finishes without `--skip-report`) sticking
    // around to poison the next assembly. Nuke it before engines start.
    fs.rmSync(path.join(resultsRoot, ENGINE_ERRORS_FILE), { force: true });
  }

  const startedAt = Date.now();
  const engineErrors: string[] = [];
  // Per-label: one viewport's bench throw must not attribute "engine aborted"
  // to tests in another viewport's bucket that ran cleanly.
  const perfEngineFailedByLabel = new Set<string>();

  // Under reportOnly, rehydrate the in-memory error state from whatever the
  // measuring process(es) persisted. A genuinely missing file means the
  // measuring process finished cleanly; a parse failure means the file was
  // truncated by a crashed shard — readPersistedEngineErrors surfaces that
  // as a synthetic entry rather than swallowing it into a green report.
  if (opts.reportOnly) {
    const { persisted, readError } = readPersistedEngineErrors(resultsRoot);
    if (readError) engineErrors.push(readError);
    if (persisted) {
      engineErrors.push(...persisted.engineErrors);
      for (const label of persisted.perfEngineFailedByLabel) {
        perfEngineFailedByLabel.add(label);
      }
    }
  }

  // Run the engines sequentially (each launches its own browser). Visreg
  // is now harvested per-test inside `buildTestResult`, mirroring perf —
  // this block only drives the engine invocation.
  if (categories.includes('visreg') && !opts.reportOnly) {
    console.log('\n>>> visreg');
    try {
      await invokeVisregEngine({
        controlURL,
        experimentURL,
        resultsRoot,
        visregConfig,
        sharedConfig: shared,
        testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
        filter: opts.filter ?? shared.filter,
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      console.error(`visreg engine error: ${message}`);
      engineErrors.push(`visreg engine: ${message}`);
    }
  }

  // Bucket tests by the perf viewport they resolved to (category viewports ∩
  // test narrow). Each bucket becomes one bench pass. A test whose narrow
  // excludes every perf viewport contributes to no bucket and is marked
  // skipped at report time.
  const perfBuckets = new Map<string, { viewport: Viewport; tests: AbTestDefinition[] }>();
  for (const test of tests) {
    for (const viewport of resolveViewportsForTest(test, perfConfig.viewports)) {
      const bucket = perfBuckets.get(viewport.label);
      if (bucket) bucket.tests.push(test);
      else perfBuckets.set(viewport.label, { viewport, tests: [test] });
    }
  }

  if (categories.includes('perf') && !opts.reportOnly) {
    for (const { viewport, tests: bucketTests } of perfBuckets.values()) {
      // Buckets are seeded on first insert (see perfBuckets construction
      // above), so an empty bucket is unreachable today. Guard anyway: an
      // empty `filter` would be falsy in `load-tests.ts`'s `if (filter)`
      // check and silently fall back to running every discovered test at
      // this viewport.
      if (bucketTests.length === 0) continue;
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
        perfEngineFailedByLabel.add(viewport.label);
      }
    }
  }

  const testResults: TestResult[] = tests.map((test) =>
    buildTestResult({
      test,
      cwd,
      controlURL,
      experimentURL,
      config,
      resultsRoot,
      categories,
      perfEngineFailedByLabel,
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
      reportOnly: opts.reportOnly === true,
    },
    tests: testResults,
  };

  // Under skipReport the shard produces no top-level artifacts — only the
  // per-test engine output already written by the bridges. Its engine errors
  // are serialised to disk so the downstream reportOnly assembly can surface
  // them in meta.errors; without this, a shard's "visreg engine: timeout"
  // banner would silently disappear at merge time.
  if (opts.skipReport) {
    writePersistedEngineErrors(resultsRoot, {
      engineErrors,
      perfEngineFailedByLabel: [...perfEngineFailedByLabel],
    });
    return {
      reportPath: '',
      ...summarizeFailures(data),
    };
  }

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

interface ReadPersistedResult {
  persisted: PersistedEngineErrors | null;
  /** Surfaced to the user as a top-level banner when the file exists but
   *  can't be parsed — a truncated JSON from a crashed shard must not be
   *  swallowed into a green report. */
  readError: string | null;
}

function readPersistedEngineErrors(resultsRoot: string): ReadPersistedResult {
  const p = path.join(resultsRoot, ENGINE_ERRORS_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { persisted: null, readError: null };
    }
    return {
      persisted: null,
      readError: `persisted engine errors unreadable at ${p}: ${(err as Error).message}`,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedEngineErrors>;
    return {
      persisted: {
        engineErrors: Array.isArray(parsed.engineErrors) ? parsed.engineErrors : [],
        perfEngineFailedByLabel: Array.isArray(parsed.perfEngineFailedByLabel)
          ? parsed.perfEngineFailedByLabel
          : [],
      },
      readError: null,
    };
  } catch (err) {
    return {
      persisted: null,
      readError: `persisted engine errors corrupted at ${p}: ${(err as Error).message}`,
    };
  }
}

function writePersistedEngineErrors(resultsRoot: string, payload: PersistedEngineErrors): void {
  // Write via tmp + rename so a crashed shard can't leave a truncated JSON
  // that the assembler would later read as authoritative.
  const finalPath = path.join(resultsRoot, ENGINE_ERRORS_FILE);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, finalPath);
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
      if (c.status === 'skipped') continue;
      if (c.error) errors++;
      if (c.testType === 'perf') {
        // One perf card carries N viewports; count each viewport's regressions
        // and per-viewport errors separately so multi-viewport failures land
        // in the summary line with the right count.
        for (const p of c.artifacts) {
          if (p.error) errors++;
          if (p.regressedMetrics.length > 0) regressions++;
        }
      }
      if (c.testType === 'visreg' && c.status === 'visual_change') visualChanges++;
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
  config: AbTestsConfig;
  resultsRoot: string;
  categories: TestType[];
  /** Set of viewport labels whose bench pass threw — used to distinguish
   *  "this test's viewport had an engine failure" from "this test happens to
   *  be missing report.json in an otherwise healthy viewport's subtree". */
  perfEngineFailedByLabel: Set<string>;
}

function skippedCategory(category: TestType, skipReason: string): CategoryResult {
  if (category === 'perf') {
    return { testType: 'perf', status: 'skipped', skipReason, artifacts: [] };
  }
  return { testType: 'visreg', status: 'skipped', skipReason, artifacts: [] };
}

function viewportFilterSkipReason(category: TestType, narrow: string[] | undefined): string {
  const detail = narrow && narrow.length > 0 ? ` [${narrow.join(', ')}]` : '';
  return `skipped by test viewport filter${detail} — no overlap with ${category}.viewports`;
}

function buildTestResult(opts: BuildTestResultOpts): TestResult {
  const { test, cwd, controlURL, experimentURL, config, resultsRoot, categories, perfEngineFailedByLabel } = opts;

  const slug = slugifyForBench(test.name);
  const perCategory: CategoryResult[] = [];
  for (const testType of categories) {
    const def = CATEGORY_DEFS[testType];
    // Listed in `categories` but no harvester registered (e.g. accessibility
    // is in the TestType union but compare doesn't ship a CategoryDef yet).
    if (!def) continue;
    if (!testRunsForType(test, def.testType)) {
      perCategory.push(skippedCategory(testType, `skipped: test opted out of ${testType} via testTypes`));
      continue;
    }
    const viewports = resolveViewportsForTest(test, def.viewports(config));
    if (viewports.length === 0) {
      perCategory.push(skippedCategory(testType, viewportFilterSkipReason(testType, test.options.viewports)));
      continue;
    }
    perCategory.push(def.harvest({
      test,
      slug,
      viewports,
      resultsRoot,
      controlURL,
      experimentURL,
      config,
      perfEngineFailedByLabel,
    }) ?? missingArtifactsCategory(testType));
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
    measuredAt: freshestArtifactMtime(resultsRoot, slug, config),
    categories: perCategory,
  };
}

/**
 * Walks the on-disk report.json files for this test across all perf/visreg
 * viewports and returns the freshest mtime (epoch ms), or null if no
 * report.json exists anywhere. Used to render "updated N d H h ago" on each
 * card so that, in a merged --report-only assembly, shards run at different
 * times read clearly as different freshness.
 */
function freshestArtifactMtime(
  resultsRoot: string,
  slug: string,
  config: AbTestsConfig,
): number | null {
  let freshest = 0;
  const consider = (absPath: string): void => {
    try {
      const m = fs.statSync(absPath).mtimeMs;
      if (m > freshest) freshest = m;
    } catch { /* missing: test wasn't measured at this viewport */ }
  };
  for (const [testType, def] of Object.entries(CATEGORY_DEFS)) {
    if (!def) continue;
    for (const vp of def.viewports(config)) {
      consider(path.join(resultsRoot, `${testType}-${vp.label}`, slug, 'report.json'));
    }
  }
  return freshest > 0 ? freshest : null;
}
