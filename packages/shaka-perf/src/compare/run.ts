import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import chalk from 'chalk';
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
import { planTestViewports, resolveViewportsForTest } from './viewport-plan';
import { announceStage } from './announce-stage';

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
   * `reportOnly` run over merged artifacts. Each shard persists its engine
   * errors to its own `.shaka-engine-errors-<shardKey>.json` (keyed by
   * filter + testPathPattern + categories), so disjoint shards coexist
   * and the assembler globs+merges them all.
   */
  skipReport?: boolean;
  skipPerfWarmup?: boolean;
  skipLowNoiseProfiles?: boolean;
  lowNoiseProfilesOnly?: boolean;
}

// Per-shard persisted engine-errors files. Format: <prefix><shardKey><suffix>.
// One file per shard identity — re-running the same shard overwrites its
// own file; disjoint shards write to disjoint paths and coexist on a shared
// resultsRoot. The assembler globs all of them at --report-only time.
const ENGINE_ERRORS_PREFIX = '.shaka-engine-errors-';
const ENGINE_ERRORS_SUFFIX = '.json';

interface PersistedEngineErrors {
  engineErrors: string[];
  perfEngineFailedByLabel: string[];
}

/**
 * Stable hash of what makes this run's measurement scope distinct from
 * another shard's: filters/patterns narrow the test set, categories pick
 * which engines run. Two shards that hash to the same key are measuring
 * the same thing — re-running them must overwrite the same persisted file
 * rather than accumulate stale errors.
 */
function shardKey(
  testPathPattern: string | undefined,
  filter: string | undefined,
  categories: TestType[],
): string {
  const sortedCategories = [...categories].sort().join(',');
  const input = `${testPathPattern ?? ''}\0${filter ?? ''}\0${sortedCategories}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
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
  const raw = configPath ? await loadAbTestsConfig(configPath) : {};
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
  if (opts.skipLowNoiseProfiles && opts.lowNoiseProfilesOnly) {
    throw new Error('--skip-low-noise-profiles and --low-noise-profiles-only are mutually exclusive');
  }
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig(opts);
  const { shared, visreg: visregConfig } = config;
  const perfConfig = {
    ...config.perf,
    skipPerfWarmup: opts.skipPerfWarmup || config.perf.skipPerfWarmup,
    skipLowNoiseProfiles: opts.skipLowNoiseProfiles || config.perf.skipLowNoiseProfiles,
    lowNoiseProfilesOnly: opts.lowNoiseProfilesOnly || config.perf.lowNoiseProfilesOnly,
  };

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
    // Persisted engine-error files belong to a sharded measurement pass.
    // Under `--skip-report` we let other shards' files persist alongside
    // ours (write goes to a shard-keyed path; same-shard re-runs overwrite).
    // A non-shard run (no `--skip-report`, no `--report-only`) is the user
    // returning to local-iteration mode — wipe any leftover shard files so
    // a subsequent `--report-only` can't pick up stale errors from a prior
    // shard pass against the same dir.
    if (!opts.skipReport) {
      wipePersistedEngineErrors(resultsRoot);
    }
  }

  const startedAt = Date.now();
  const engineErrors: string[] = [];
  // Per-label: if the perf engine throws before it can write complete
  // artifacts, mark all planned viewport labels as failed for harvest.
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
  let visregRanBeforePerf = false;
  if (categories.includes('visreg') && !opts.reportOnly) {
    // TODO: update the narrowing hint below when accessibility and seo land
    // as categories — `--categories perf` will no longer be the only way to
    // run "everything except visreg".
    announceStage(
      'visreg',
      'Loading every test page on both the control server and the experiment server, taking a screenshot of each once the page has settled, and comparing the two screenshots pixel-by-pixel. ' +
      'A test fails when the two sides look visibly different. ' +
      'This is how a code change that does not break anything functionally still gets caught when it accidentally moves a button, shifts a layout, or changes a color. ' +
      'When you only care about perf this run, narrow the work by passing --categories perf so visreg is not run.'
    );
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
      visregRanBeforePerf = true;
    } catch (err) {
      const message = (err as Error).message || String(err);
      console.error(chalk.red(`visreg engine error: ${message}`));
      engineErrors.push(`visreg engine: ${message}`);
      visregRanBeforePerf = true;
    }
  }

  if (categories.includes('perf') && !opts.reportOnly) {
    const perfPlan = planTestViewports(tests, perfConfig.viewports)
      .filter((entry) => entry.viewports.length > 0);
    if (perfPlan.length > 0) {
      // TODO: update the narrowing hint below when accessibility and seo land
      // as categories — `--categories visreg` will no longer be the only way
      // to run "everything except perf".
      announceStage(
        'perf',
        'Measuring how long pages take to load on the control server vs. the experiment server, then deciding whether the experiment is meaningfully slower or faster. ' +
        'Runs in three sub-stages, each announced separately: a warmup pass to skip unrepresentative first-load costs, the actual statistical sampling that produces the regression verdict, and one final careful pass per test that produces detailed Lighthouse reports and traces you can dig into. ' +
        'When you only care about visreg this run, narrow the work by passing --categories visreg so perf is not run.'
      );
      for (const { test, viewports } of perfPlan) {
        for (const viewport of viewports) {
          fs.mkdirSync(path.join(perfRootFor(resultsRoot, viewport), slugifyForBench(test.name)), { recursive: true });
        }
      }
    }
    try {
      await invokePerfEngine({
        controlURL,
        experimentURL,
        resultsFolder: resultsRoot,
        perfConfig,
        sharedConfig: shared,
        viewports: perfConfig.viewports,
        testPathPattern: opts.testPathPattern ?? shared.testPathPattern,
        filter: opts.filter ?? shared.filter,
        warmedUpByVisreg: visregRanBeforePerf,
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      console.error(chalk.red(`perf engine error: ${message}`));
      engineErrors.push(`perf engine: ${message}`);
      for (const { viewports } of perfPlan) {
        for (const viewport of viewports) {
          perfEngineFailedByLabel.add(viewport.label);
        }
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
    const key = shardKey(
      opts.testPathPattern ?? shared.testPathPattern,
      opts.filter ?? shared.filter,
      categories,
    );
    writePersistedEngineErrors(resultsRoot, key, {
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
  /** Surfaced to the user as a top-level banner when at least one shard
   *  file exists but can't be parsed — a truncated JSON from a crashed
   *  shard must not be swallowed into a green report. Reports the first
   *  unreadable / corrupt file; subsequent files still get parsed and
   *  merged into `persisted` so one bad shard doesn't drop the others. */
  readError: string | null;
}

function listPersistedEngineErrorFiles(resultsRoot: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(resultsRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.startsWith(ENGINE_ERRORS_PREFIX) && e.endsWith(ENGINE_ERRORS_SUFFIX))
    .map((e) => path.join(resultsRoot, e));
}

function readPersistedEngineErrors(resultsRoot: string): ReadPersistedResult {
  const files = listPersistedEngineErrorFiles(resultsRoot);
  if (files.length === 0) return { persisted: null, readError: null };

  const engineErrors: string[] = [];
  const labels = new Set<string>();
  let firstReadError: string | null = null;

  for (const p of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch (err) {
      const msg = `persisted engine errors unreadable at ${p}: ${(err as Error).message}`;
      if (!firstReadError) firstReadError = msg;
      continue;
    }
    let parsed: Partial<PersistedEngineErrors>;
    try {
      parsed = JSON.parse(raw) as Partial<PersistedEngineErrors>;
    } catch (err) {
      const msg = `persisted engine errors corrupted at ${p}: ${(err as Error).message}`;
      if (!firstReadError) firstReadError = msg;
      continue;
    }
    if (Array.isArray(parsed.engineErrors)) engineErrors.push(...parsed.engineErrors);
    if (Array.isArray(parsed.perfEngineFailedByLabel)) {
      for (const label of parsed.perfEngineFailedByLabel) labels.add(label);
    }
  }

  return {
    persisted: { engineErrors, perfEngineFailedByLabel: [...labels] },
    readError: firstReadError,
  };
}

function writePersistedEngineErrors(
  resultsRoot: string,
  key: string,
  payload: PersistedEngineErrors,
): void {
  // Write via tmp + rename so a crashed shard can't leave a truncated JSON
  // that the assembler would later read as authoritative.
  const finalPath = path.join(resultsRoot, `${ENGINE_ERRORS_PREFIX}${key}${ENGINE_ERRORS_SUFFIX}`);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, finalPath);
}

function wipePersistedEngineErrors(resultsRoot: string): void {
  for (const p of listPersistedEngineErrorFiles(resultsRoot)) {
    fs.rmSync(p, { force: true });
  }
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
    experimentUrl: new URL(test.experimentPathOverride ?? test.startingPath, experimentURL).href,
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
