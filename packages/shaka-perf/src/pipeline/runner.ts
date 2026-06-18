/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cancellableRace } from 'race-cancellation';
import chalk from 'chalk';
import {
  consoleCaptureStorage,
  getFallbackEmit,
  installConsoleCapture,
} from './console-capture';
import {
  disposeEventLoopWatchdog,
  installEventLoopWatchdog,
} from './event-loop-watchdog';
import { acquireMeasurementLock } from './measurement-lock';
import {
  readTestSource,
  testRunsForType,
  type AbTestDefinition,
  type Viewport,
} from 'shaka-shared';
import {
  messageWithLatestTestAnnotation,
  runWithTestAnnotationContext,
  stackWithLatestTestAnnotation,
} from '../test-annotation';
import { loadTests } from '../config-loader';
import {
  writeMachineReport,
  writeReport,
  type ChipDescriptor,
  type ReportData,
  type ReportOutcome,
  type TestResult,
} from './report';
import { writeFullReportArchive } from './report-archive';
import { resolveViewportsForTest } from './viewport-plan';
import {
  type Pipeline,
  type PipelineWorkerPool,
  type ChipResultMap,
  type ChipStageResult,
  type ChipTestEntry,
  resolveStageSelection,
} from './pipeline';
import type {
  Stage,
  StageCategory,
  StageLogger,
  StageName,
  StageRuntime,
  TestContext,
} from '../stage/stage';
import { WorkerPool, type WorkerTaskProgressSink } from './worker-pool';
import type { StageSelection } from './pipeline';
import { testIdForTest, unitIdForTest } from './unit-id';
import { ArtifactStore } from './artifact-store';
import type { Outcome, ErrorInfo } from './outcome';
import { StageFailureError, findLastAnnotation } from '../stage/stage-failure';
import { colorizedLogPrefix, testSourcePrefix } from '../visreg/core/util/testContext';
import { attachStickyStatus, formatPoolProgress } from '../bench/cli/commands/compare/sticky-status';
import { announceStage } from './announce-stage';
import { resolveUrl } from './unit-urls';

// Per-shard persisted engine-errors files. Format: <prefix><shardKey><suffix>.
// One file per shard identity — re-running the same shard overwrites its
// own file; disjoint shards write to disjoint paths and coexist on a shared
// resultsRoot. The assembler globs all of them at --report-only time.
const ENGINE_ERRORS_PREFIX = '.shaka-engine-errors-';
const ENGINE_ERRORS_SUFFIX = '.json';

interface PersistedEngineErrors {
  engineErrors: string[];
}

/**
 * Stable hash of what makes this run's measurement scope distinct from
 * another shard's: filters/patterns narrow the test set, stages pick
 * which work runs. Two shards that hash to the same key are measuring the
 * same thing — re-running them must overwrite the same persisted file
 * rather than accumulate stale errors.
 */
function shardKey(
  testPathPattern: string | undefined,
  filter: string | undefined,
  stages: StageName[],
): string {
  const sortedStages = [...stages].sort().join(',');
  const input = `${testPathPattern ?? ''}\0${filter ?? ''}\0${sortedStages}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function resultsRootFor(cwd: string, pipeline: Pipeline): string {
  return path.resolve(cwd, pipeline.artifactRoot ?? '.', `${pipeline.name}-results`);
}

interface WorkUnit {
  test: AbTestDefinition;
  viewport: Viewport;
  priorOutcomes: Map<StageName, Outcome>;
}

interface StageProgress {
  queued: number;
  running: number;
  done: number;
  skipped: number;
  error: number;
}

interface StageTaskProgress {
  startedAt: number | null;
  submitted: number;
  running: number;
  completed: number;
  errors: number;
}

interface StageExecution {
  stage: Stage;
  progress: StageProgress;
  taskProgress: StageTaskProgress;
  durations: number[];
  skipOption: string;
  index: number;
  total: number;
  promise: Promise<void>;
}

interface RuntimeWorkerPool {
  ref: PipelineWorkerPool;
  pool: WorkerPool;
  unitChains: Map<string, Promise<void>>;
  stageExecutions: StageExecution[];
  pending: Promise<void>[];
}

function formatStageProgress(progress: StageProgress): string {
  return `queued ${progress.queued}, running ${progress.running}, done ${progress.done}, skipped ${progress.skipped}, error ${progress.error}`;
}

function testAndViewportId(unit: WorkUnit): string {
  return unitIdForTest(unit.test, unit.viewport.label);
}

function formatMs(duration: number): string {
  return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
}

function formatDurationSummary(durations: readonly number[]): string {
  if (durations.length === 0) return '';
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const max = Math.max(...durations);
  return ` · durations total ${formatMs(total)}, avg ${formatMs(total / durations.length)}, max ${formatMs(max)}`;
}

function formatExecutionStatus(
  execution: StageExecution,
  runtimePool: RuntimeWorkerPool | undefined,
): string {
  const snapshot = runtimePool?.pool.snapshot();
  const submitted = execution.taskProgress.submitted;
  const running = execution.taskProgress.running;
  const completed = execution.taskProgress.completed;
  return formatPoolProgress({
    startedAt: execution.taskProgress.startedAt ?? Date.now(),
    completed,
    expectedTotal: submitted === 0 ? null : submitted,
    parallelism: snapshot?.parallelism ?? 1,
    active: running,
    errors: execution.taskProgress.errors,
  }, {
    name: execution.stage.name,
    description: execution.stage.description,
    index: execution.index,
    total: execution.total,
    skipOption: execution.skipOption,
  });
}

function formatPipelineSticky(
  executions: readonly StageExecution[],
  pools: ReadonlyMap<PipelineWorkerPool, RuntimeWorkerPool>,
): string {
  const active = executions.filter((execution) => (
    execution.progress.queued > 0 ||
    execution.progress.running > 0
  ));
  if (active.length === 0) return '';
  return active.map((execution) => {
    const runtimePool = [...pools.values()].find((candidate) => (
      candidate.stageExecutions.includes(execution)
    ));
    return formatExecutionStatus(execution, runtimePool);
  }).join('\n\n');
}

class BufferedStageLogger implements StageLogger {
  private readonly lines: string[] = [];
  private readonly subject: string;

  constructor(stage: Stage, test: AbTestDefinition, viewportLabel: string) {
    this.subject = testSourcePrefix(
      test.file,
      test.line,
      test.name,
      viewportLabel,
      stage.name,
    );
  }

  log(message: string): void {
    const line = `${colorizedLogPrefix(this.subject)}${message}`;
    this.lines.push(line);
    getFallbackEmit()(line);
  }

  flush(): string {
    return this.lines.join('\n');
  }
}

const stageTaskProgressStorage = new AsyncLocalStorage<WorkerTaskProgressSink>();

function errorInfo(err: unknown): ErrorInfo {
  const lastAnnotation = findLastAnnotation(err);
  if (err instanceof Error) {
    // `err.stack` already contains `Caused by:` segments when the error was
    // built via worker-pool's `wrapWithCause`. For everything else — raw
    // throws inside stages, third-party errors that set `cause` themselves,
    // nested wrappers from unknown sources — walk the full `Error.cause`
    // chain. `seen` guards against cycles regardless of depth, so a
    // hand-crafted A↔B loop can't hang the walk.
    let stack = stackWithLatestTestAnnotation(err, lastAnnotation) ?? '';
    if (!/\bCaused by:/.test(stack)) {
      const seen = new Set<unknown>([err]);
      let cursor: unknown = (err as { cause?: unknown }).cause;
      while (cursor instanceof Error && !seen.has(cursor)) {
        seen.add(cursor);
        const causeStack = cursor.stack ?? `${cursor.name}: ${cursor.message}`;
        stack = stack ? `${stack}\nCaused by: ${causeStack}` : causeStack;
        cursor = (cursor as { cause?: unknown }).cause;
      }
    }
    return {
      message: messageWithLatestTestAnnotation(err.message || String(err), lastAnnotation),
      ...(stack ? { stack } : {}),
      ...(lastAnnotation ? { lastAnnotation } : {}),
    };
  }
  return {
    message: messageWithLatestTestAnnotation(err == null ? 'unknown error' : String(err), lastAnnotation),
    ...(lastAnnotation ? { lastAnnotation } : {}),
  };
}

export interface PipelineRunResult {
  /**
   * Backward-compatible alias for the shareable report. Prefer
   * `shortReportPath`/`fullReportPath` for user-facing CLI output.
   */
  reportPath: string;
  /** Shareable, self-contained report intended for Slack/email. */
  shortReportPath: string;
  /** Local full report intended for deeper debugging. */
  fullReportPath: string;
  /**
   * The full report + its artifacts bundled into `<resultsRoot>/full-report.zip`,
   * or `undefined` if no report was written (`--skip-report`) or zipping failed.
   */
  fullReportZipPath?: string;
  /**
   * Directory the pipeline wrote per-test artifacts into (`<cwd>/<name>-results`).
   * Exposed so CLI wrappers can post-process side-channel artifacts the
   * runtime doesn't itself surface — e.g. the audit command's istanbul
   * coverage report, generated from `<resultsRoot>/.nyc_output/`.
   */
  resultsRoot: string;
  /**
   * Whether the run surfaced any failures (visreg mismatches, perf regressions,
   * or engine errors). The CLI exits non-zero when true so CI pipelines treat
   * the run as a failed assertion rather than a successful report.
   */
  hasFailures: boolean;
  /** Human-readable summary of what failed — empty string when !hasFailures. */
  failureSummary: string;
}

export interface RuntimeOptions {
  readonly cwd?: string | undefined;
  readonly controlURL: string;
  readonly experimentURL: string;
  readonly testPathPattern?: string | undefined;
  readonly filter?: string | undefined;
  readonly categories?: string | string[] | undefined;
  readonly skipStages?: string | string[] | undefined;
  /**
   * Restart the run from this stage: discard this stage's and every later
   * stage's results, then re-run them. Earlier stages are retained — their
   * on-disk artifacts and outcomes survive and are hydrated into
   * `priorOutcomes` so the restarted stages' `applies()` can read them. Lets
   * you iterate on a late stage (e.g. a report-shaping stage) without paying
   * to re-run the expensive earlier measurement stages.
   */
  readonly restartFromStage?: string | undefined;
  readonly reportOnly?: boolean | undefined;
  readonly skipReport?: boolean | undefined;
  /**
   * Skip the pre-run wipe of this run's per-unit artifact dirs (and the flat
   * visreg screenshot scratch dirs). Engines still overwrite the files they
   * produce, but unrelated leftovers from a prior run survive instead of
   * being cleared. Off by default — the normal contract is a clean slate per
   * run. Has no effect under `reportOnly`, which never wipes anyway.
   */
  readonly keepOldResults?: boolean | undefined;
  /**
   * Diagnostics: instruct stages that dedupe artifacts to ALSO emit the full,
   * non-deduped form for inspection. Currently consumed only by
   * `build_annotated_timeline`, which renders every synced screencast frame
   * (each annotated with its diff vs the previous frame) next to the normal
   * deduped timeline. Surfaced to stages via `StageRuntime.debugShowAllFrames`.
   */
  readonly debugShowAllFrames?: boolean | undefined;
  /**
   * Launch the measurement browser headed (visible) instead of headless.
   * Driven by the `--headed` CLI flag; surfaced to the Lighthouse stages via
   * `StageRuntime.headed`. Off by default.
   */
  readonly headed?: boolean | undefined;
  /**
   * Bundle the full report + all its artifacts into `full-report.zip` after a
   * run that produced a report. Opt-in (the archive can be large) — off by
   * default; driven by the `--full-report-zip` CLI flag on both pipelines.
   */
  readonly fullReportZip?: boolean | undefined;
  /**
   * Worker-pool crash retries — applied uniformly to every worker pool
   * the pipeline registers. Engine-level retries (e.g. visreg best-of-N
   * screenshot stability) are a stage knob and stay on pipeline config.
   */
  readonly retries: number;
  readonly retryDelay: number;
  /**
   * Per-task wall-clock cap, applied uniformly to every worker pool.
   * Driven by `shared.timeoutMs`; stages never see this value — the pool
   * itself races each `job.run` against the timer and fires its
   * race-cancellation so cooperative subsystems exit on time.
   */
  readonly timeoutMs: number;
  /**
   * Per-stage-category viewport sets. The runner expands `tests × viewports`
   * against `viewports[stage.category]` and emits one TestUnit per pair,
   * so pipelines/stages are viewport-agnostic at construction time.
   * Categories the running pipeline doesn't use carry empty arrays — the
   * caller (CLI) builds this via `viewportsByStageCategory(config)` so the
   * record is always complete.
   */
  readonly viewports: Readonly<Record<StageCategory, readonly Viewport[]>>;
}

export async function runPipeline(
  pipeline: Pipeline,
  runtime: RuntimeOptions,
): Promise<PipelineRunResult> {
  // Stage code uses the default `chalk` import for log lines; those lines are
  // captured into per-test buffers and embedded in the HTML report, where the
  // report shell parses ANSI back into styled spans. chalk auto-strips colours
  // under non-TTY stdio (CI, yarn wrappers, pipes), which would ship the
  // report flat-grey. Force a minimum colour level once at entry so stage code
  // can keep using the global chalk without each callsite re-detecting.
  if (chalk.level < 2) chalk.level = 2;
  installEventLoopWatchdog();
  // Serialise real measurement runs machine-wide: two running at once contend
  // for CPU and corrupt each other's timings. A report-only run takes no
  // measurements, so it skips the queue.
  const measurementLock = runtime.reportOnly ? null : await acquireMeasurementLock();
  try {
    return await runConfiguredPipelineWithSelection(
      pipeline,
      resolveStageSelection(pipeline, runtime),
      runtime,
    );
  } finally {
    measurementLock?.release();
    disposeEventLoopWatchdog();
  }
}

async function runConfiguredPipelineWithSelection(
  pipeline: Pipeline,
  stageSelection: StageSelection,
  runtime: RuntimeOptions,
): Promise<PipelineRunResult> {
  if (runtime.skipReport && runtime.reportOnly) {
    throw new Error('--skip-report and --report-only are mutually exclusive');
  }
  const cwd = runtime.cwd ?? process.cwd();
  const executableStages = stageSelection.stages;
  if (executableStages.length === 0 && !runtime.reportOnly) {
    throw new Error('No executable pipeline stages selected.');
  }

  const controlURL = runtime.controlURL;
  const experimentURL = runtime.experimentURL;
  const resultsRoot = resultsRootFor(cwd, pipeline);
  const startedAt = Date.now();
  const runId = new Date(startedAt).toISOString();
  const store = new ArtifactStore(resultsRoot, runtime.reportOnly ? undefined : runId);
  const categories = categoriesForStages(executableStages);
  const restarting = stageSelection.restartFromStage !== null;
  // Keep the prior run's per-unit artifacts dir on restart: the retained
  // earlier stages' outputs (e.g. the Lighthouse profile the restarted stage
  // reads) live there alongside the restarted stages' soon-to-be-redone files.
  const preserveOldResults = runtime.keepOldResults === true || restarting;

  // Execute the narrowed selection. A normal filtered run should report only
  // the tests it just executed, otherwise stale sibling outcomes already on
  // disk can reappear in a fresh local report. `--report-only` is the explicit
  // full-suite assembly path: it runs no tests, deletes nothing, and rebuilds
  // from whatever per-test artifacts already exist on disk.
  const runTests = runtime.reportOnly
      ? []
      : await loadTests({
        testPathPattern: runtime.testPathPattern,
        filter: runtime.filter,
        log: (msg) => console.log(msg),
      });
  const reportTests = runtime.reportOnly
    ? await loadTests({ log: (msg) => console.log(msg) })
    : runTests;

  // Ensure the results root exists without wiping prior artifacts. CI shards
  // (`skipReport`) and the final assembly run (`reportOnly`) both rely on
  // earlier per-test dirs being present; local iterative runs rely on the
  // report assembly only looking up outcomes by test slug, so stale sibling
  // dirs from deleted tests are harmless noise.
  if (!runtime.reportOnly) {
    fs.mkdirSync(resultsRoot, { recursive: true });
    // Persisted engine-error files belong to a sharded measurement pass.
    // Under `--skip-report` we let other shards' files persist alongside
    // ours (write goes to a shard-keyed path; same-shard re-runs overwrite).
    // A non-shard run (no `--skip-report`, no `--report-only`) is the user
    // returning to local-iteration mode — wipe any leftover shard files so
    // a subsequent `--report-only` can't pick up stale errors from a prior
    // shard pass against the same dir.
    if (!runtime.skipReport) {
      wipePersistedEngineErrors(resultsRoot);
    }
  }

  const engineErrors: string[] = [];

  // Under reportOnly, rehydrate the in-memory error state from whatever the
  // measuring process(es) persisted. A genuinely missing file means the
  // measuring process finished cleanly; a parse failure means the file was
  // truncated by a crashed shard — readPersistedEngineErrors surfaces that
  // as a synthetic entry rather than swallowing it into a green report.
  if (runtime.reportOnly) {
    const { persisted, readError } = readPersistedEngineErrors(resultsRoot);
    if (readError) engineErrors.push(readError);
    if (persisted) {
      engineErrors.push(...persisted.engineErrors);
    }
  }

  const stageRuntime: StageRuntime = {
    resultsRoot,
    debugShowAllFrames: runtime.debugShowAllFrames ?? false,
    headed: runtime.headed ?? false,
  };
  const units = expandWorkUnits(
    runTests,
    executableStages,
    runtime.viewports,
    {
      store,
      hydratePriorStages: stageSelection.skippedStages
        .filter((entry) => !entry.persistOutcome)
        .map((entry) => entry.stage),
    },
  );

  // Single wipe authority: clear every applicable unit's artifact dir once
  // before any stage runs. Engines no longer wipe internally — that was the
  // source of the parallel-visreg race (one invocation rming another's
  // pending PNGs mid-flight). Under --skip-report we still clear this shard's
  // own unit dirs so reruns cannot read stale artifacts, but we leave the
  // flat visreg scratch dirs alone because sibling shards may be using them.
  // --keep-old-results and --restart-from-stage opt out of the wipe entirely
  // (we still ensure the dirs exist) so a rerun layers onto a prior run's
  // artifacts — the retained earlier stages need their prior artifacts and
  // outcome JSONs intact.
  if (!runtime.reportOnly) {
    for (const unit of units) {
      const unitDir = store.unitDirForViewport(unit.test, unit.viewport.label);
      if (!preserveOldResults) {
        fs.rmSync(unitDir, { recursive: true, force: true });
      }
      fs.mkdirSync(store.artifactsDirForViewport(unit.test, unit.viewport.label), { recursive: true });
    }
    // Restart discards the redone stages' prior results before they re-run.
    // The blanket wipe above is skipped on restart to protect the retained
    // earlier stages' artifacts, so the restarted-and-later stages' stale
    // outcome JSONs would otherwise survive — and a re-run that crashes or
    // ends early would leave the previous run's "ok" outcomes masquerading as
    // this run's. Delete them up front so each redone stage starts from a
    // clean slate; the stages rewrite their own outcomes (and prune their own
    // generated artifacts) as they run.
    if (restarting) {
      for (const unit of units) {
        for (const stage of executableStages) {
          store.deleteOutcome(unit.test, unit.viewport.label, stage.name);
        }
      }
    }
  }
  if (!runtime.reportOnly) {
    installConsoleCapture();
    const sticky = attachStickyStatus();
    const runtimePools = new Map<PipelineWorkerPool, RuntimeWorkerPool>();
    const executions: StageExecution[] = [];
    const renderSticky = () => sticky.set(formatPipelineSticky(executions, runtimePools));

    const getRuntimePool = (ref: PipelineWorkerPool): RuntimeWorkerPool => {
      let runtimePool = runtimePools.get(ref);
      if (runtimePool) return runtimePool;
      const pool = new WorkerPool(ref.parallelism, {
        currentTaskProgress: () => stageTaskProgressStorage.getStore(),
        retries: runtime.retries,
        retryDelay: runtime.retryDelay,
        timeoutMs: runtime.timeoutMs,
      });
      runtimePool = {
        ref,
        pool,
        unitChains: new Map(),
        stageExecutions: [],
        pending: [],
      };
      pool.onProgressChange = renderSticky;
      runtimePools.set(ref, runtimePool);
      return runtimePool;
    };

    const disposeRuntimePool = async (ref: PipelineWorkerPool): Promise<void> => {
      const runtimePool = runtimePools.get(ref);
      if (!runtimePool) return;
      const pending = await Promise.allSettled(runtimePool.pending);
      for (const result of pending) {
        if (result.status === 'fulfilled') continue;
        const info = errorInfo(result.reason);
        engineErrors.push(`${ref.id} pipeline task: ${info.message}`);
        console.error(chalk.red(`${ref.id} pipeline task failed: ${info.message}`));
      }
      try {
        await runtimePool.pool.dispose();
      } catch (err) {
        const info = errorInfo(err);
        engineErrors.push(`${ref.id} cleanup: ${info.message}`);
        console.error(chalk.red(`${ref.id} cleanup failed: ${info.message}`));
      } finally {
        runtimePools.delete(ref);
        renderSticky();
      }
    };

    try {
      for (const step of stageSelection.steps) {
        if (step.kind === 'run-stage') {
          const runtimePool = getRuntimePool(step.pool);
          const execution = scheduleStageExecution({
            stage: step.stage,
            runtimePool,
            units,
            store,
            runtime: stageRuntime,
            unitUrlOptions: runtime,
            viewportsByCategory: runtime.viewports,
            stageIndex: executableStages.indexOf(step.stage) + 1,
            totalStages: executableStages.length,
            renderSticky,
          });
          runtimePool.stageExecutions.push(execution);
          runtimePool.pending.push(execution.promise);
          executions.push(execution);
          renderSticky();
          continue;
        }
        if (step.kind === 'dispose-worker-pool') {
          await disposeRuntimePool(step.pool);
        }
      }
      await Promise.all([...runtimePools.keys()].map(disposeRuntimePool));
    } finally {
      sticky.dispose();
    }
  }
  if (!runtime.reportOnly) {
    persistCliSkippedStageOutcomes(store, reportTests, stageSelection, runtime.viewports);
  }

  console.log(
    chalk.blue(
      `\n>>> assemble · per-test artifacts (${reportTests.length} test${reportTests.length === 1 ? '' : 's'})`,
    ),
  );
  const assembleStart = Date.now();
  let assembledCount = 0;
  const partials = await Promise.all(
    reportTests.map(async (test) => {
      const t0 = Date.now();
      const partial = await buildTestPartial({
        test,
        pipeline,
        cwd,
        controlURL,
        experimentURL,
        resultsRoot,
        store,
        categories,
        reportOnly: runtime.reportOnly === true,
        viewports: runtime.viewports,
      });
      assembledCount += 1;
      const idx = String(assembledCount).padStart(String(reportTests.length).length, ' ');
      const sizeMb = (resultBytes(partial.partialResult) / 1024 / 1024).toFixed(1);
      console.log(
        `    [${idx}/${reportTests.length}] ${test.name} ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s, ` +
        `${sizeMb} MB)`,
      );
      return partial;
    }),
  );
  const perTest: ChipTestEntry<Record<string, unknown>>[] = partials.map((p) => ({
    test: p.test,
    results: p.chipResults,
  }));
  const chipsByTest = pipeline.chipsForAllTests(perTest);
  const sortsByTest = pipeline.sortsForAllTests(perTest);
  // Mirror what each test ends up rendering — including the synthetic
  // `brokenChip()` for failed tests — so the machine report agrees with the
  // HTML report on what chips each test carries.
  const finalChipsByTest = new Map<AbTestDefinition, readonly ChipDescriptor[]>();
  const testResults: TestResult[] = partials.map((p) => {
    // Cross-cutting, runner-owned chip (not a pipeline concern): any stage task
    // that crashed/timed out and recovered on a retry makes the test flaky.
    const recovered = p.partialResult.outcomes.some((o) => o.recoveredAfterRetries);
    const flaky = recovered ? [flakyChip()] : [];
    if (p.hasError) {
      const chips = [brokenChip(), ...flaky];
      finalChipsByTest.set(p.test, chips);
      // Failed tests have no measured values to sort by.
      return { ...p.partialResult, chips, sorts: [] };
    }
    const chips = chipsByTest.get(p.test);
    if (!chips) throw new Error(`chipsForAllTests omitted test ${p.test.name}`);
    const copy = [...chips, ...flaky];
    finalChipsByTest.set(p.test, copy);
    // A sort builder may legitimately omit a test (nothing sortable) → [].
    return { ...p.partialResult, chips: copy, sorts: [...(sortsByTest.get(p.test) ?? [])] };
  });
  console.log(`    all tests assembled in ${((Date.now() - assembleStart) / 1000).toFixed(1)}s`);

  const data: ReportData = {
    meta: {
      title: path.basename(cwd) + ` · ${pipeline.name}`,
      pipelineName: pipeline.name,
      generatedAt: new Date().toISOString(),
      controlUrl: controlURL,
      experimentUrl: experimentURL,
      durationMs: Date.now() - startedAt,
      cwd,
      errors: engineErrors,
      reportOnly: runtime.reportOnly === true,
      pipelineConfig: pipeline.pipelineConfig,
      // Overwritten per-file by writeReport. The runner sets a placeholder
      // here so ReportData is well-typed before the two-file split.
      reportMode: 'full',
    },
    tests: testResults,
  };

  // Under skipReport the shard produces no top-level artifacts — only the
  // per-test engine output already written by the stages. Its engine errors
  // are serialised to disk so the downstream reportOnly assembly can surface
  // them in meta.errors; without this, a shard's "visreg engine: timeout"
  // banner would silently disappear at merge time.
  if (runtime.skipReport) {
    const key = shardKey(
      runtime.testPathPattern,
      runtime.filter,
      stageSelection.stageNames,
    );
    writePersistedEngineErrors(resultsRoot, key, {
      engineErrors,
    });
    return {
      reportPath: '',
      shortReportPath: '',
      fullReportPath: '',
      resultsRoot,
      ...summarizeFailures(data),
    };
  }

  console.log(chalk.blue('\n>>> rendering report HTML files'));
  const renderStart = Date.now();
  const { fullPath, lightPath } = writeReport(data, resultsRoot, pipeline.stages);
  const reportPath = lightPath;
  const fullBytes = fs.statSync(fullPath).size;
  const lightBytes = fs.statSync(lightPath).size;
  const elapsed = ((Date.now() - renderStart) / 1000).toFixed(1);
  console.log(
    `    wrote ${fullPath} (${(fullBytes / 1024 / 1024).toFixed(1)} MB) in ${elapsed}s`,
  );
  console.log(
    `    wrote ${lightPath} (${(lightBytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  writeMachineReport(
    path.join(resultsRoot, 'report.json'),
    reportTests,
    (test) => allViewportsForTest(test, pipeline.stages, runtime.viewports),
    pipeline,
    data.meta,
    store,
    stageRuntime,
    finalChipsByTest,
  );

  // Bundle the full report + its artifacts into full-report.zip when opted in
  // via `--full-report-zip` (the archive can be large, so it's off by default).
  // Non-fatal: a zip failure must not sink a run whose report is already on disk.
  let fullReportZipPath: string | undefined;
  if (runtime.fullReportZip) {
    try {
      const { zipPath, bytes } = await writeFullReportArchive(resultsRoot);
      fullReportZipPath = zipPath;
      console.log(`    wrote ${zipPath} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.warn(`    warning: could not write full-report.zip: ${(err as Error).message}`);
    }
  }

  return {
    reportPath,
    shortReportPath: lightPath,
    fullReportPath: fullPath,
    fullReportZipPath,
    resultsRoot,
    ...summarizeFailures(data),
  };
}

interface ScheduleStageExecutionOptions {
  stage: Stage;
  runtimePool: RuntimeWorkerPool;
  units: readonly WorkUnit[];
  store: ArtifactStore;
  runtime: StageRuntime;
  unitUrlOptions: {
    readonly controlURL: string;
    readonly experimentURL: string;
  };
  viewportsByCategory: RuntimeOptions['viewports'];
  stageIndex: number;
  totalStages: number;
  renderSticky(): void;
}

function scheduleStageExecution(opts: ScheduleStageExecutionOptions): StageExecution {
  const {
    stage,
    runtimePool,
    units,
    store,
    runtime,
    unitUrlOptions,
    viewportsByCategory,
    stageIndex,
    totalStages,
    renderSticky,
  } = opts;
  const progress: StageProgress = {
    queued: units.length,
    running: 0,
    done: 0,
    skipped: 0,
    error: 0,
  };
  const taskProgress: StageTaskProgress = {
    startedAt: null,
    submitted: 0,
    running: 0,
    completed: 0,
    errors: 0,
  };
  const execution: StageExecution = {
    stage,
    progress,
    taskProgress,
    durations: [],
    skipOption: `--skip-stages ${stage.name}`,
    index: stageIndex,
    total: totalStages,
    promise: Promise.resolve(),
  };
  announceStage(stage.name, stage.description);

  const unitRuns = units.map((unit) => {
    const id = testAndViewportId(unit);
    const previous = runtimePool.unitChains.get(id) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => executeStageForUnit({
        stage,
        runtimePool,
        unit,
        store,
        runtime,
        unitUrlOptions,
        viewportsByCategory,
        progress,
        taskProgress,
        durations: execution.durations,
        renderSticky,
        testAndViewportId: id,
      }));
    runtimePool.unitChains.set(id, run.catch(() => undefined));
    return run;
  });

  execution.promise = Promise.all(unitRuns).then(() => {
    // Print the final status block to stdout so it scrolls into history
    // before the sticky drops it from its active list.
    console.log(formatExecutionStatus(execution, runtimePool));
    console.log(chalk.blue(`<<< ${stage.name} · ${formatStageProgress(progress)}${formatDurationSummary(execution.durations)}`));
  });
  return execution;
}

interface ExecuteStageForUnitOptions {
  stage: Stage;
  runtimePool: RuntimeWorkerPool;
  unit: WorkUnit;
  store: ArtifactStore;
  runtime: StageRuntime;
  unitUrlOptions: {
    readonly controlURL: string;
    readonly experimentURL: string;
  };
  viewportsByCategory: RuntimeOptions['viewports'];
  progress: StageProgress;
  taskProgress: StageTaskProgress;
  durations: number[];
  renderSticky(): void;
  testAndViewportId: string;
}

async function executeStageForUnit(opts: ExecuteStageForUnitOptions): Promise<void> {
  const {
    stage,
    runtimePool,
    unit,
    store,
    runtime,
    unitUrlOptions,
    viewportsByCategory,
    progress,
    taskProgress,
    durations,
    renderSticky,
    testAndViewportId,
  } = opts;
  const logger = new BufferedStageLogger(stage, unit.test, unit.viewport.label);
  const start = Date.now();

  // Work units are expanded as the UNION of viewports across stage categories
  // (e.g. tests run perf at desktop+phone and visreg at desktop only produce
  // units for {desktop, phone}). Each stage must filter back down to its own
  // category's viewport list so visreg doesn't end up running at perf-only
  // viewports (or vice versa).
  const stageViewports = resolveViewportsForTest(unit.test, viewportsByCategory[stage.category]);
  const viewportApplies = stageViewports.some((vp) => vp.label === unit.viewport.label);

  let selected = false;
  try {
    selected = testDeclaresStageCategory(unit.test, stage) &&
      viewportApplies &&
      stage.applies(unit.test, unit.viewport, unit.priorOutcomes);
  } catch (err) {
    progress.queued -= 1;
    progress.error += 1;
    persistStageOutcome(store, unit, logger, {
      kind: 'error',
      stage: stage.name,
      error: errorInfo(err),
    });
    renderSticky();
    return;
  }

  progress.queued -= 1;
  if (!selected) {
    const reason = !viewportApplies
      ? `${unit.viewport.label} not in ${stage.category}.viewports`
      : `${stage.name} does not apply to ${unit.viewport.label}`;
    persistStageOutcome(store, unit, logger, skippedOutcome(stage.name, reason));
    progress.skipped += 1;
    renderSticky();
    return;
  }

  progress.running += 1;
  renderSticky();
  // Fresh per-stage-per-unit cancellation token. Stages thread it into long
  // browser awaits so a future runner-side cancel can give them a chance to
  // surface a failure screenshot before the browser is torn down. The
  // returned `cancel` is unused today — the worker-pool's per-task token
  // is what actually fires on timeout — but the field is part of the
  // contract so stages don't need to special-case its absence.
  const [raceCancellation] = cancellableRace();
  const ctx: TestContext = {
    test: unit.test,
    viewport: unit.viewport,
    artifacts: store.scopeFor(unit.test, unit.viewport.label),
    logger,
    priorOutcomes: unit.priorOutcomes,
    runtime,
    controlURL: resolveUrl(unit.test.startingPath, unitUrlOptions.controlURL),
    experimentURL: resolveUrl(
      unit.test.experimentPathOverride ?? unit.test.startingPath,
      unitUrlOptions.experimentURL,
    ),
    testAndViewportId,
    raceCancellation,
    // Lazy on-demand read of an earlier stage's persisted result. Earlier
    // stages have already written their `<stage>.json` (with full measurement)
    // to this unit's dir, so a consequent stage can pull their data even though
    // the in-memory `priorOutcomes` map is lean.
    readPriorResult: <M = unknown>(priorStage: StageName): M | undefined =>
      store.readOutcome(unit.test, unit.viewport.label, priorStage)?.measurement as M | undefined,
  };
  let outcome: Outcome;
  // Failed attempts for THIS task only (the shared `taskProgress.errors` is a
  // stage-wide aggregate). If the task ultimately succeeds with this > 0, a
  // retry recovered it from a crash/timeout → "flaky (recovered after retries)".
  let failedAttempts = 0;
  const taskProgressSink: WorkerTaskProgressSink & { readonly stageName: string } = {
    stageName: stage.name,
    onTaskSubmitted() {
      taskProgress.startedAt ??= Date.now();
      taskProgress.submitted += 1;
    },
    onTaskStarted() {
      taskProgress.running += 1;
    },
    onTaskSettled() {
      taskProgress.completed += 1;
      taskProgress.running = Math.max(0, taskProgress.running - 1);
    },
    onTaskFailed() {
      taskProgress.errors += 1;
      failedAttempts += 1;
    },
  };
  try {
    const measurement = await consoleCaptureStorage.run(
      logger,
      () => stageTaskProgressStorage.run(
        taskProgressSink,
        () => runWithTestAnnotationContext(() => stage.run(ctx, runtimePool.pool)),
      ),
    );
    outcome = {
      kind: 'ok',
      stage: stage.name,
      measurement,
      ...(failedAttempts > 0 ? { recoveredAfterRetries: true } : {}),
    };
  } catch (err) {
    outcome = {
      kind: 'error',
      stage: stage.name,
      error: errorInfo(err),
      ...(err instanceof StageFailureError ? { failure: err.failureArtifacts } : {}),
    };
  }

  durations.push(Date.now() - start);
  progress.running -= 1;
  if (outcome.kind === 'error') progress.error += 1;
  else progress.done += 1;
  persistStageOutcome(store, unit, logger, outcome);
  renderSticky();
}

function persistStageOutcome(
  store: ArtifactStore,
  unit: WorkUnit,
  logger: StageLogger,
  outcome: Outcome,
): void {
  const logs = logger.flush();
  if (logs) outcome.logs = logs;
  store.writeOutcome(unit.test, unit.viewport.label, outcome);
  // priorOutcomes is consulted only by `Stage.applies(...)` which reads
  // `.kind`. The full `outcome` carries `measurement`, `logs`, `error`,
  // `failure` — for the audit stage `measurement.lighthouseHref` alone is a
  // multi-MB base64 data URI of the entire Lighthouse HTML report. Stashing
  // the whole outcome here (× every unit × every stage, for the run's
  // lifetime) leaks O(units × MB) into the JS heap. Strip to the only fields
  // any applies() consumer reads; the heavy payload is already on disk via
  // store.writeOutcome above.
  unit.priorOutcomes.set(outcome.stage, leanPriorOutcome(outcome));
}

function persistCliSkippedStageOutcomes(
  store: ArtifactStore,
  tests: AbTestDefinition[],
  stageSelection: StageSelection,
  viewportsByCategory: RuntimeOptions['viewports'],
): void {
  const skippedStages = stageSelection.skippedStages.filter((entry) => entry.persistOutcome);
  if (skippedStages.length === 0) return;
  for (const test of tests) {
    const viewports = viewportsForTestAndStages(test, skippedStages.map((entry) => entry.stage), viewportsByCategory);
    for (const { stage, reason } of skippedStages) {
      for (const viewport of viewports) {
        store.writeOutcome(test, viewport.label, skippedOutcome(stage.name, reason));
      }
    }
  }
}

function leanPriorOutcome(outcome: Outcome): Outcome {
  const lean: Outcome = { kind: outcome.kind, stage: outcome.stage };
  if (outcome.runId !== undefined) lean.runId = outcome.runId;
  return lean;
}

interface ExpandWorkUnitsOptions {
  store?: ArtifactStore;
  hydratePriorStages?: readonly Stage[];
}

function expandWorkUnits(
  tests: readonly AbTestDefinition[],
  stages: readonly Stage[],
  viewportsByCategory: RuntimeOptions['viewports'],
  options: ExpandWorkUnitsOptions = {},
): WorkUnit[] {
  const units: WorkUnit[] = [];
  for (const test of tests) {
    for (const viewport of viewportsForTestAndStages(test, stages, viewportsByCategory)) {
      const priorOutcomes = new Map<StageName, Outcome>();
      for (const stage of options.hydratePriorStages ?? []) {
        const outcome = options.store?.readOutcome(test, viewport.label, stage.name);
        if (outcome) priorOutcomes.set(stage.name, leanPriorOutcome(outcome));
      }
      units.push({ test, viewport, priorOutcomes });
    }
  }
  return units;
}

function viewportsForTestAndStages(
  test: AbTestDefinition,
  stages: readonly Stage[],
  viewportsByCategory: RuntimeOptions['viewports'],
): Viewport[] {
  const labels = new Map<string, Viewport>();
  for (const stage of stages) {
    if (!testDeclaresStageCategory(test, stage)) continue;
    for (const viewport of resolveViewportsForTest(test, viewportsByCategory[stage.category])) {
      labels.set(viewport.label, viewport);
    }
  }
  return [...labels.values()];
}

function categoriesForStages(stages: readonly Stage[]): StageCategory[] {
  return [...new Set(stages.map((stage) => stage.category))];
}

function testDeclaresStageCategory(test: AbTestDefinition, stage: Stage): boolean {
  return testRunsForType(test, stage.category);
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
  }

  return {
    persisted: { engineErrors },
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
  let accessibilityViolations = 0;
  let accessibilityRegressions = 0;
  let accessibilityErrors = 0;
  let errors = 0;
  for (const t of data.tests) {
    if (t.outcomes.some((outcome) => outcome.kind === 'error') || hasChipTag(t, 'broken')) errors++;
    if (hasChipTag(t, 'regression')) regressions++;
    if (hasChipTag(t, 'visual change')) visualChanges++;
    if (hasChipTag(t, 'accessibility violation')) accessibilityViolations++;
    if (hasChipTag(t, 'accessibility regression')) accessibilityRegressions++;
    if (hasChipTag(t, 'accessibility error')) accessibilityErrors++;
  }
  if (data.meta.errors.length > 0) errors += data.meta.errors.length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (regressions > 0) parts.push(`${regressions} perf regression${regressions === 1 ? '' : 's'}`);
  if (visualChanges > 0) parts.push(`${visualChanges} visreg mismatch${visualChanges === 1 ? '' : 'es'}`);
  if (accessibilityViolations > 0) {
    parts.push(
      `${accessibilityViolations} test${accessibilityViolations === 1 ? '' : 's'} with accessibility violations`,
    );
  }
  if (accessibilityRegressions > 0) {
    parts.push(
      `${accessibilityRegressions} test${accessibilityRegressions === 1 ? '' : 's'} with accessibility regressions`,
    );
  }
  if (accessibilityErrors > 0) {
    parts.push(
      `${accessibilityErrors} accessibility scan error${accessibilityErrors === 1 ? '' : 's'}`,
    );
  }
  return {
    hasFailures: parts.length > 0,
    failureSummary: parts.join(', '),
  };
}

function resultBytes(result: Omit<TestResult, 'chips' | 'sorts'> | TestResult): number {
  try {
    return Buffer.byteLength(JSON.stringify(result), 'utf8');
  } catch {
    return 0;
  }
}

interface BuildTestResultOpts {
  test: AbTestDefinition;
  pipeline: Pipeline;
  cwd: string;
  controlURL: string;
  experimentURL: string;
  resultsRoot: string;
  store: ArtifactStore;
  categories: StageCategory[];
  reportOnly: boolean;
  viewports: RuntimeOptions['viewports'];
}

function viewportFilterSkipReason(category: StageCategory, narrow: string[] | undefined): string {
  const detail = narrow && narrow.length > 0 ? ` [${narrow.join(', ')}]` : '';
  return `skipped by test viewport filter${detail} — no overlap with ${category}.viewports`;
}

interface TestPartial {
  readonly test: AbTestDefinition;
  readonly partialResult: Omit<TestResult, 'chips' | 'sorts'>;
  readonly chipResults: ChipResultMap<Record<string, unknown>>;
  readonly hasError: boolean;
}

async function buildTestPartial(opts: BuildTestResultOpts): Promise<TestPartial> {
  const {
    test,
    pipeline,
    cwd,
    controlURL,
    experimentURL,
    resultsRoot,
    store,
    categories,
    reportOnly,
    viewports: viewportsByCategory,
  } = opts;

  // Pre-stage skip outcomes that the per-stage applies() can't express:
  // "test opted out of this testType" and "no viewport overlap with category".
  // These don't go through the stage loop because the runner pre-filters
  // work units by viewport, so we persist them here.
  if (!reportOnly) {
    for (const testType of categories) {
      const categoryStages = pipeline.stages.filter((stage) => stage.category === testType);
      const categoryViewports = viewportsByCategory[testType] ?? [];
      if (categoryViewports.length === 0) continue;
      if (!testRunsForType(test, testType)) {
        persistSkippedOutcomesForStages(
          store,
          test,
          categoryStages,
          `skipped: test opted out of ${testType} via testTypes`,
          viewportsByCategory,
        );
        continue;
      }
      const narrowed = resolveViewportsForTest(test, categoryViewports);
      if (narrowed.length === 0) {
        persistSkippedOutcomesForStages(
          store,
          test,
          categoryStages,
          viewportFilterSkipReason(testType, test.options.viewports),
          viewportsByCategory,
        );
      }
    }
  }

  const relFilePath = test.file ? path.relative(cwd, test.file) : '(unknown source)';
  const stagesByName = new Map(pipeline.stages.map((stage, index) => [stage.name, { stage, index }]));
  const viewportOutcomes = allViewportsForTest(test, pipeline.stages, viewportsByCategory).flatMap((viewport) =>
    store.readOutcomesForViewport(test, viewport.label).map((outcome) => ({ outcome, viewport })),
  ).sort((a, b) => {
    // Render order = DESCENDING renderingPriority (higher shows first), ties
    // broken by registration order. Decoupled from execution order so a stage
    // can run last but render first (e.g. the audit AI summary).
    const sa = stagesByName.get(a.outcome.stage);
    const sb = stagesByName.get(b.outcome.stage);
    const pa = sa?.stage.renderingPriority ?? 0;
    const pb = sb?.stage.renderingPriority ?? 0;
    if (pa !== pb) return pb - pa;
    return (sa?.index ?? Number.MAX_SAFE_INTEGER) - (sb?.index ?? Number.MAX_SAFE_INTEGER);
  });
  const outcomes = viewportOutcomes.map(({ outcome, viewport }) => ({ ...outcome, viewport }));
  const hasError = outcomes.some((outcome) => outcome.kind === 'error');
  const chipResults = chipResultsForOutcomes(pipeline, outcomes);
  const runId = newestRunId(outcomes);
  const viewportArtifactPaths = allViewportsForTest(test, pipeline.stages, viewportsByCategory).map((vp) => ({
    viewport: vp.label,
    path: store.unitDirForViewport(test, vp.label),
  }));
  return {
    test,
    chipResults,
    hasError,
    partialResult: {
      id: testIdForTest(test),
      name: test.name,
      filePath: relFilePath,
      startingPath: test.startingPath,
      controlUrl: resolveUrl(test.startingPath, controlURL),
      experimentUrl: resolveUrl(test.experimentPathOverride ?? test.startingPath, experimentURL),
      code: readTestSource(test.file, test.line),
      durationMs: 0,
      measuredAt: freshestArtifactMtime(resultsRoot, test, pipeline.stages, viewportsByCategory),
      runId,
      outcomes,
      viewportArtifactPaths,
    },
  };
}

function chipResultsForOutcomes(
  pipeline: Pipeline,
  outcomes: readonly ReportOutcome[],
): ChipResultMap<Record<string, unknown>> {
  const results: Record<string, ChipStageResult<unknown>[]> = {};
  for (const stage of pipeline.stages) {
    results[stage.name] = [];
  }
  for (const outcome of outcomes) {
    if (outcome.kind !== 'ok' || outcome.measurement == null) continue;
    const successfulOutcome = outcome as ReportOutcome & { kind: 'ok'; measurement: unknown };
    const entries = results[outcome.stage] ?? (results[outcome.stage] = []);
    entries.push({
      stage: outcome.stage,
      viewport: outcome.viewport,
      measurement: successfulOutcome.measurement,
      outcome: successfulOutcome,
    });
  }
  return results;
}

function brokenChip(): ChipDescriptor {
  return { tag: 'broken', text: 'broken', color: 'red', sortingWeight: 0 };
}

// Cross-cutting warning chip the runner attaches to any test whose stage task
// crashed or timed out on an earlier attempt but succeeded on a worker-pool
// retry. Informational (doesn't drive card order); filterable to isolate flaky
// tests. Distinct from the compare pipeline's "visreg unstable" chip, which is
// about visual-comparison instability rather than crash recovery.
function flakyChip(): ChipDescriptor {
  return {
    tag: 'flaky',
    text: 'flaky (recovered after retries)',
    color: 'yellow',
    sortingWeight: 16,
    affectsCardOrder: false,
    tooltip: 'A stage crashed or timed out on an earlier attempt but a retry succeeded — the test is flaky but recovered.',
  };
}

function hasChipTag(test: TestResult, tag: string): boolean {
  return test.chips.some((chip) => chip.tag === tag);
}

function newestRunId(outcomes: readonly Outcome[]): string | null {
  let newest: string | null = null;
  for (const outcome of outcomes) {
    if (!outcome.runId) continue;
    if (newest == null || outcome.runId > newest) newest = outcome.runId;
  }
  return newest;
}

function allViewportsForTest(
  test: AbTestDefinition,
  stages: readonly Stage[],
  viewportsByCategory: RuntimeOptions['viewports'],
): Viewport[] {
  return resolveViewportsForTest(test, viewportsForStages(stages, viewportsByCategory));
}

function viewportsForStages(
  stages: readonly Stage[],
  viewportsByCategory: RuntimeOptions['viewports'],
): Viewport[] {
  const labels = new Set<string>();
  const viewports: Viewport[] = [];
  for (const stage of stages) {
    for (const viewport of viewportsByCategory[stage.category] ?? []) {
      if (labels.has(viewport.label)) continue;
      labels.add(viewport.label);
      viewports.push(viewport);
    }
  }
  return viewports;
}

function skippedOutcome(stage: StageName, reason: string): Outcome {
  return { kind: 'skipped', stage, reason };
}

function persistSkippedOutcomesForStages(
  store: ArtifactStore,
  test: AbTestDefinition,
  stages: readonly Stage[],
  reason: string,
  viewportsByCategory: RuntimeOptions['viewports'],
): void {
  for (const stage of stages) {
    for (const viewport of viewportsByCategory[stage.category] ?? []) {
      if (store.readOutcome(test, viewport.label, stage.name)) continue;
      store.writeOutcome(test, viewport.label, skippedOutcome(stage.name, reason));
    }
  }
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
  test: AbTestDefinition,
  stages: readonly Stage[],
  viewportsByCategory: RuntimeOptions['viewports'],
): number | null {
  let freshest = 0;
  const consider = (absPath: string): void => {
    try {
      const m = fs.statSync(absPath).mtimeMs;
      if (m > freshest) freshest = m;
    } catch { /* missing: test wasn't measured at this viewport */ }
  };
  const considerStageOutcome = (absPath: string): void => {
    try {
      const outcome = JSON.parse(fs.readFileSync(absPath, 'utf8')) as Outcome;
      if (outcome.kind === 'skipped') return;
    } catch {
      return;
    }
    consider(absPath);
  };
  for (const vp of viewportsForStages(stages, viewportsByCategory)) {
    const slug = unitIdForTest(test, vp.label);
    for (const stage of stages) {
      considerStageOutcome(path.join(resultsRoot, slug, `${stage.name}.json`));
    }
    consider(path.join(resultsRoot, slug, 'artifacts', 'report.json'));
  }
  return freshest > 0 ? freshest : null;
}
