/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import playwright from 'playwright';
import type { AbTestDefinition } from 'shaka-shared';
import { loadTests } from '../../config-loader';
import {
  createPipeline,
  resolveStageSelection,
  type Pipeline,
} from '../pipeline';
import { runPipeline, type RuntimeOptions } from '../runner';
import { ArtifactStore } from '../artifact-store';
import { buildAbTestsConfig } from '../../config';
import { withAbTestsConfigPath } from '../../effective-config';
import { createVisregStage } from '../../compare/stages/visreg';
import type { Stage, StageCategory, StageName, TestContext } from '../../stage/stage';
import type { WorkerPool } from '../worker-pool';
import type { Outcome } from '../outcome';
import type { Browser } from '../../visreg/core/types';
import { SELF_CONTAINED_REPORT_FILENAME } from '../report';

jest.mock('../../config-loader', () => ({
  ...jest.requireActual('../../config-loader'),
  loadTests: jest.fn(),
}));

interface ObservedStageUrls {
  readonly phase: 'run' | 'summary';
  readonly stage: StageName;
  readonly controlURL: string;
  readonly experimentURL: string;
}

function stage(
  name: StageName,
  category: StageCategory = 'perf',
  observedUrls?: ObservedStageUrls[],
): Stage<Record<string, never>> {
  return {
    name,
    label: name,
    category,
    description: `${name} stage`,
    selfContainedReportStrip: {},
    applies: () => true,
    run: async (ctx: TestContext, _pool: WorkerPool) => {
      observedUrls?.push({
        phase: 'run',
        stage: name,
        controlURL: ctx.controlURL,
        experimentURL: ctx.experimentURL,
      });
      return {};
    },
    renderArtifacts: () => null,
    machineReadableSummary: (_measurement, ctx) => {
      observedUrls?.push({
        phase: 'summary',
        stage: name,
        controlURL: ctx.controlURL,
        experimentURL: ctx.experimentURL,
      });
      return {};
    },
  };
}

function pipeline(): Pipeline {
  return createPipeline({
    name: 'test',
    description: 'test pipeline',
    report: {
      reportLabel: 'Test',
      renderHeaderUrls: () => null,
      renderTestCardUrls: () => null,
      renderDialogMetaUrls: () => null,
    },
  }, (builder) => {
    const pool = builder.registerWorkerPool(2);
    builder.runStage(pool, stage('visreg', 'visreg'));
    builder.runStage(pool, stage('perf-warmup'));
    builder.runStage(pool, stage('perf'));
    builder.waitForAllTasksFinishAndDispose(pool);

    const serial = builder.registerWorkerPool(1);
    builder.runStage(serial, stage('perf-low-noise'));
    builder.waitForAllTasksFinishAndDispose(serial);

    builder.buildChips({
      chipsForAllTests: (perTest) => new Map(
        perTest.map(({ test }) => [test, []]),
      ),
    });
    builder.buildSorts({
      sortsForAllTests: () => new Map(),
    });
  });
}

const ALL_PIPELINE_STAGE_CATEGORIES: readonly [StageName, StageCategory][] = [
  // compare + troubleshoot
  ['visreg', 'visreg'],
  ['perf-warmup', 'perf'],
  ['perf', 'perf'],
  ['perf-low-noise', 'perf'],
  // compare + audit
  ['accessibility', 'accessibility'],
  // audit (the last two consume prior artifacts rather than navigating)
  ['audit', 'audit'],
  ['agent-readiness', 'audit'],
  ['build_annotated_timeline', 'audit'],
  ['ai_summary', 'audit'],
];

function allPipelineStages(observedUrls: ObservedStageUrls[]): Pipeline {
  return createPipeline({
    name: 'all-pipeline-stages',
    description: 'all pipeline stages URL contract',
    report: {
      reportLabel: 'All pipeline stages',
      renderHeaderUrls: () => null,
      renderTestCardUrls: () => null,
      renderDialogMetaUrls: () => null,
    },
  }, (builder) => {
    const pool = builder.registerWorkerPool(1);
    for (const [name, category] of ALL_PIPELINE_STAGE_CATEGORIES) {
      builder.runStage(pool, stage(name, category, observedUrls));
    }
    builder.waitForAllTasksFinishAndDispose(pool);
    builder.buildChips({
      chipsForAllTests: (perTest) => new Map(perTest.map(({ test }) => [test, []])),
    });
    builder.buildSorts({ sortsForAllTests: () => new Map() });
  });
}

describe('resolveStageSelection', () => {
  it('selects the restart stage and later stages', () => {
    const selected = resolveStageSelection(pipeline(), { restartFromStage: 'perf' });

    expect(selected.stageNames).toEqual(['perf', 'perf-low-noise']);
    expect(selected.restartFromStage).toBe('perf');
    expect(selected.skippedStages.map((entry) => ({
      stage: entry.stage.name,
      persistOutcome: entry.persistOutcome,
    }))).toEqual([
      { stage: 'visreg', persistOutcome: false },
      { stage: 'perf-warmup', persistOutcome: false },
    ]);
  });

  it('does not persist skipped outcomes for stages before the restart point', () => {
    const selected = resolveStageSelection(pipeline(), {
      restartFromStage: 'perf',
      skipStages: 'perf-low-noise',
    });

    expect(selected.stageNames).toEqual(['perf']);
    expect(selected.skippedStages.map((entry) => ({
      stage: entry.stage.name,
      persistOutcome: entry.persistOutcome,
    }))).toEqual([
      { stage: 'visreg', persistOutcome: false },
      { stage: 'perf-warmup', persistOutcome: false },
      { stage: 'perf-low-noise', persistOutcome: true },
    ]);
  });

  it('validates the restart stage name', () => {
    expect(() => resolveStageSelection(pipeline(), { restartFromStage: 'missing' }))
      .toThrow('Unknown stage "missing". Valid: visreg, perf-warmup, perf, perf-low-noise');
  });

  it('warns and ignores unknown --skip-stages entries instead of crashing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const selected = resolveStageSelection(pipeline(), {
        skipStages: 'perf-warmup,does-not-exist',
      });

      expect(selected.stageNames).toEqual(['visreg', 'perf', 'perf-low-noise']);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ignoring unknown stage "does-not-exist" in --skip-stages'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runPipeline', () => {
  const frozenTest: AbTestDefinition = {
    name: 'Frozen homepage',
    startingPath: '/',
    file: null,
    line: null,
    testTypes: null,
    testFn: async () => {},
  };

  beforeEach(() => {
    jest.mocked(loadTests).mockReset();
  });

  async function runWithFrozenTest(
    runtime: Partial<RuntimeOptions> = {},
    selectedPipeline: Pipeline = pipeline(),
  ) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-pipeline-test-'));
    // Point the machine-wide measurement lock at a private tmpdir so the test
    // doesn't queue behind (or block) a real shaka-perf run on this machine.
    const savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = cwd;
    try {
      return await runPipeline(selectedPipeline, {
        cwd,
        config: buildAbTestsConfig({ shared: { controlURL: 'http://control.test', experimentURL: 'http://experiment.test', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] }, timeoutMs: 1_000, retries: 0, retryDelay: 0 } }),
        controlURL: 'http://control.test',
        experimentURL: 'http://experiment.test',
        tests: [frozenTest],
        ...runtime,
      });
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }

  it('uses frozen report tests without loading test definitions', async () => {
    await runWithFrozenTest({ reportOnly: true });

    expect(loadTests).not.toHaveBeenCalled();
  });

  it('exposes assembled test results when skipping report generation', async () => {
    const result = await runWithFrozenTest({ skipReport: true });

    expect(result.testResults[0]?.name).toBe(frozenTest.name);
  });

  it('uses per-test shared base URLs in every pipeline stage and report context', async () => {
    const test: AbTestDefinition = {
      ...frozenTest,
      startingPath: '/control-path',
      experimentPathOverride: '/experiment-path',
      config: {
        shared: {
          controlURL: 'http://per-test-control.test/base',
          experimentURL: 'http://per-test-experiment.test/base',
        },
      },
    };
    const observedUrls: ObservedStageUrls[] = [];

    const result = await runWithFrozenTest(
      { tests: [test] },
      allPipelineStages(observedUrls),
    );

    const expectedStages = new Set(ALL_PIPELINE_STAGE_CATEGORIES.map(([name]) => name));
    expect(new Set(
      observedUrls.filter(({ phase }) => phase === 'run').map(({ stage }) => stage),
    )).toEqual(expectedStages);
    expect(new Set(
      observedUrls.filter(({ phase }) => phase === 'summary').map(({ stage }) => stage),
    )).toEqual(expectedStages);
    for (const observed of observedUrls) {
      expect(observed.controlURL).toBe('http://per-test-control.test/control-path');
      expect(observed.experimentURL).toBe('http://per-test-experiment.test/experiment-path');
    }
    expect(result.testResults[0]?.controlUrl)
      .toBe('http://per-test-control.test/control-path');
    expect(result.testResults[0]?.experimentUrl)
      .toBe('http://per-test-experiment.test/experiment-path');
  });

  it('applies one-sided per-test URLs independently in every context', async () => {
    for (const overriddenSide of ['control', 'experiment'] as const) {
      const test: AbTestDefinition = {
        ...frozenTest,
        startingPath: '/control-path',
        experimentPathOverride: '/experiment-path',
        config: {
          shared: overriddenSide === 'control'
            ? { controlURL: 'http://per-test-control.test/base' }
            : { experimentURL: 'http://per-test-experiment.test/base' },
        },
      };
      const observedUrls: ObservedStageUrls[] = [];
      const result = await runWithFrozenTest(
        {
          tests: [test],
          controlURL: 'http://run-control.test/base',
          experimentURL: 'http://run-experiment.test/base',
        },
        allPipelineStages(observedUrls),
      );
      const expectedControlURL = overriddenSide === 'control'
        ? 'http://per-test-control.test/control-path'
        : 'http://run-control.test/control-path';
      const expectedExperimentURL = overriddenSide === 'experiment'
        ? 'http://per-test-experiment.test/experiment-path'
        : 'http://run-experiment.test/experiment-path';

      for (const observed of observedUrls) {
        expect(observed.controlURL).toBe(expectedControlURL);
        expect(observed.experimentURL).toBe(expectedExperimentURL);
      }
      expect(result.testResults[0]?.controlUrl).toBe(expectedControlURL);
      expect(result.testResults[0]?.experimentUrl).toBe(expectedExperimentURL);
    }
  });

});

describe('pre-run wipe', () => {
  // The narrowed test's plan is tablet-only for visreg; desktop/phone dirs
  // hold outcomes from a run before the narrowing.
  const narrowedTest: AbTestDefinition = {
    name: 'Narrowed homepage',
    startingPath: '/',
    file: null,
    line: null,
    testTypes: null,
    testFn: async () => {},
    config: { visreg: { viewports: ['tablet'] } },
  };

  let cwd: string;

  beforeEach(() => {
    jest.mocked(loadTests).mockReset();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-pipeline-wipe-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  async function run(runtime: Partial<RuntimeOptions> = {}) {
    // Private measurement-lock location — see runWithFrozenTest.
    const savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = cwd;
    try {
      return await runPipeline(pipeline(), {
        cwd,
        config: buildAbTestsConfig({ shared: { controlURL: 'http://control.test', experimentURL: 'http://experiment.test', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] }, timeoutMs: 1_000, retries: 0, retryDelay: 0 } }),
        controlURL: 'http://control.test',
        experimentURL: 'http://experiment.test',
        tests: [narrowedTest],
        skipReport: true,
        ...runtime,
      });
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
    }
  }

  function seedOutcome(viewportLabel: string, stage: string) {
    const store = new ArtifactStore(path.join(cwd, 'test-results'));
    store.writeOutcome(narrowedTest, viewportLabel, { kind: 'ok', stage, measurement: {} });
    return path.join(store.unitDirForViewport(narrowedTest, viewportLabel), `${stage}.json`);
  }

  it('sweeps a selected stage\'s stale outcomes at viewports outside the current plan', async () => {
    // visreg ran at desktop before the test narrowed itself to tablet.
    const staleVisreg = seedOutcome('desktop', 'visreg');

    await run({ categories: 'visreg' });

    expect(fs.existsSync(staleVisreg)).toBe(false);
    // The dir may be re-created by the post-run "--categories skipped" perf
    // markers, but nothing measured survives — only skip markers.
    const remaining = fs.existsSync(path.dirname(staleVisreg))
      ? fs.readdirSync(path.dirname(staleVisreg)).filter((f) => f.endsWith('.json'))
      : [];
    for (const file of remaining) {
      const outcome = JSON.parse(fs.readFileSync(path.join(path.dirname(staleVisreg), file), 'utf8')) as { kind: string };
      expect(outcome.kind).toBe('skipped');
    }
  });

  it('drops other categories\' measured outcomes when sweeping', async () => {
    // A default run means "this run's results only": the unit dir goes
    // wholesale so no stale artifact (notably visreg's accumulated screenshot
    // frames) survives into this run. The perf outcome does not survive as a
    // measurement — it reappears only as a `--categories` skip marker.
    const staleVisreg = seedOutcome('desktop', 'visreg');
    const sweptPerf = seedOutcome('desktop', 'perf');

    await run({ categories: 'visreg' });

    expect(fs.existsSync(staleVisreg)).toBe(false);
    const perf = fs.existsSync(sweptPerf)
      ? (JSON.parse(fs.readFileSync(sweptPerf, 'utf8')) as { kind: string })
      : null;
    expect(perf?.kind ?? 'absent').not.toBe('ok');
  });

  it('clears stale artifacts at an IN-PLAN viewport, not just outcomes', async () => {
    // tablet is the narrowed test's planned visreg viewport. Regression guard:
    // visreg's screenshot pool ACCUMULATES content-addressed frames and never
    // prunes its own dir, so a frame left by a previous run would re-enter this
    // run's best-of-N match and pass on stale pixels. Deleting the outcome is
    // not enough — the artifacts/ subtree must go with it.
    const store = new ArtifactStore(path.join(cwd, 'test-results'));
    store.writeOutcome(narrowedTest, 'tablet', {
      kind: 'error', stage: 'visreg', error: 'stale from previous run',
    } as never);
    const unitDir = store.unitDirForViewport(narrowedTest, 'tablet');
    const staleVisreg = path.join(unitDir, 'visreg.json');
    seedOutcome('tablet', 'perf');
    const staleFrame = path.join(unitDir, 'artifacts', 'experiment_screenshots', 'S_0_document_0_tablet__deadbeef.png');
    fs.mkdirSync(path.dirname(staleFrame), { recursive: true });
    fs.writeFileSync(staleFrame, 'stale frame from a previous run');

    await run({ categories: 'visreg' });

    expect(fs.existsSync(staleFrame)).toBe(false);
    // The stale visreg outcome was swept; whatever visreg.json exists now came
    // from THIS run's stage (the mock stage succeeds), not the stale error.
    const rewritten = JSON.parse(fs.readFileSync(staleVisreg, 'utf8')) as { kind: string };
    expect(rewritten.kind).toBe('ok');
  });

  it('leaves stale outcomes alone under --keep-old-results', async () => {
    const staleVisreg = seedOutcome('desktop', 'visreg');

    await run({ categories: 'visreg', keepOldResults: true });

    expect(fs.existsSync(staleVisreg)).toBe(true);
  });
});

describe('per-side visreg failures', () => {
  const CONTROL_SCREENSHOT = Buffer.from('control');
  const EXPERIMENT_SCREENSHOT = Buffer.from('experiment');
  const Base64 = (value: string): string => Buffer.from(value).toString('base64');

  function visregPipeline(): Pipeline {
    return createPipeline({
      name: 'test',
      description: 'test pipeline',
      report: {
        reportLabel: 'Test',
        renderHeaderUrls: () => null,
        renderTestCardUrls: () => null,
        renderDialogMetaUrls: () => null,
      },
    }, (builder) => {
      const pool = builder.registerWorkerPool(1);
      builder.runStage(pool, createVisregStage({
        mismatchThreshold: 0.1,
        maxNumDiffPixels: 0,
        comparePixelmatchThreshold: 0.1,
        compareRetries: 0,
        compareRetryDelay: 0,
      }));
      builder.waitForAllTasksFinishAndDispose(pool);
      builder.buildChips({ chipsForAllTests: (perTest) => new Map(perTest.map(({ test }) => [test, []])) });
      builder.buildSorts({ sortsForAllTests: () => new Map() });
    });
  }

  function fakeBrowser(): Browser {
    return {
      newContext: async () => {
        let pageUrl = '';
        let closed = false;
        let rejectPendingScreenshot: ((reason: Error) => void) | undefined;
        const page = {
          goto: async (url: string) => { pageUrl = url; },
          evaluate: async () => true,
          screenshot: async () => {
            if (closed) {
              throw new Error('page.screenshot: Target page, context or browser has been closed');
            }
            if (pageUrl.startsWith('http://control.test')) {
              // The control side is still taking its normal screenshot when
              // the experiment fails. Closing the active control context must
              // cancel this work without replacing the experiment's failure.
              return new Promise<Buffer>((resolve, reject) => {
                rejectPendingScreenshot = reject;
                setTimeout(() => resolve(CONTROL_SCREENSHOT), 50);
              });
            }
            return EXPERIMENT_SCREENSHOT;
          },
          setDefaultTimeout: () => {},
          setDefaultNavigationTimeout: () => {},
          close: async () => {},
        };
        return {
          on: () => {},
          clearCookies: async () => {},
          addInitScript: async () => {},
          newPage: async () => page,
          close: async () => {
            closed = true;
            rejectPendingScreenshot?.(
              new Error('page.screenshot: Target page, context or browser has been closed'),
            );
            // Real Playwright context shutdown does not resolve at the same
            // instant that it rejects an in-flight page operation.
            await new Promise((resolve) => setTimeout(resolve, 20));
          },
        };
      },
      close: async () => {},
    } as unknown as Browser;
  }

  async function runFailingVisreg(): Promise<{
    outcome: Outcome;
    mediaBytes: Buffer;
    selfContainedReport: string;
  }> {
    let controlFinished!: () => void;
    const controlDone = new Promise<void>((resolve) => { controlFinished = resolve; });
    const test: AbTestDefinition = {
      name: 'Cart Edit Item',
      startingPath: '/',
      file: null,
      line: null,
      testTypes: null,
      testFn: async ({ isControl, annotate }) => {
        if (isControl) {
          await annotate('control opens menu');
          await annotate('control adds item');
          await annotate('control clicks Update');
          controlFinished();
          return;
        }

        await annotate('adding Curly Fries');
        await annotate('clicking Add to order');
        await controlDone;
        throw new Error('locator.click: Timeout 60000ms exceeded.');
      },
      config: { visreg: { viewports: ['tablet'] } },
    };
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-visreg-side-'));
    const configPath = path.join(cwd, 'abtests.config.js');
    fs.writeFileSync(
      configPath,
      'module.exports = { shared: { controlURL: "http://control.test", experimentURL: "http://experiment.test", parallelism: 1, playwrightOptions: { browser: "chromium", waitTimeout: 60000 }, browserConsole: { failOn: ["error", "warn"], allowList: [] } } };',
    );
    const savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = cwd;
    const launch = jest.spyOn(playwright.chromium, 'launch')
      .mockResolvedValue(fakeBrowser());
    try {
      jest.mocked(loadTests).mockResolvedValue([test]);
      const result = await withAbTestsConfigPath(configPath, () =>
        runPipeline(visregPipeline(), {
          cwd,
          config: buildAbTestsConfig({ shared: { controlURL: 'http://control.test', experimentURL: 'http://experiment.test', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] }, timeoutMs: 5_000, retries: 0, retryDelay: 0 } }),
          controlURL: 'http://control.test',
          experimentURL: 'http://experiment.test',
            tests: [test],
        }));

      const store = new ArtifactStore(path.join(cwd, 'test-results'));
      const outcome = store.readOutcome(test, 'tablet', 'visreg');
      if (!outcome) throw new Error('visreg outcome was not persisted');
      const media = outcome.failure?.media;
      if (!media) throw new Error('visreg failure media was not persisted');
      return {
        outcome,
        mediaBytes: fs.readFileSync(path.join(result.resultsRoot, media)),
        selfContainedReport: fs.readFileSync(
          path.join(result.resultsRoot, SELF_CONTAINED_REPORT_FILENAME),
          'utf8',
        ),
      };
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
      launch.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }

  beforeEach(() => {
    jest.mocked(loadTests).mockReset();
  });

  it('labels a failing side with its own step, not a concurrent sibling\'s', async () => {
    const { outcome } = await runFailingVisreg();

    expect(outcome.kind).toBe('error');
    expect(outcome.error?.message)
      .toContain('locator.click: Timeout 60000ms exceeded.');
    expect(outcome.error?.message)
      .not.toContain('Target page, context or browser has been closed');
    expect(outcome.error?.lastAnnotation).toBe('clicking Add to order');
  });

  it('attaches the failing side\'s screenshot, not a concurrent sibling\'s', async () => {
    const { outcome, mediaBytes, selfContainedReport } = await runFailingVisreg();

    expect(outcome.kind).toBe('error');
    expect(outcome.failure?.media)
      .toMatch(/\/artifacts\/experiment-visreg-failure-screenshot\.png$/);
    expect(mediaBytes).toEqual(EXPERIMENT_SCREENSHOT);
    expect(selfContainedReport)
      .toContain(`data:image/png;base64,${Base64('experiment')}`);
    expect(selfContainedReport)
      .not.toContain(`data:image/png;base64,${Base64('control')}`);
  });
});

describe('per-test task limits reach the pool', () => {
  // The whole seam is two lines in the runner: it publishes each unit's
  // TaskLimits — derived from that unit's EFFECTIVE config — into an
  // async-local, and the pool reads that async-local at submit time. Cut
  // either line and the pool silently falls back to the FILE config, which is
  // precisely the bug this replaced. No other test in the suite notices,
  // because none of them declares a per-test override: with the wire cut they
  // still assert the file numbers they already pass in.
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Cooperates with the pool's cancellation, the way a real stage does.
  // `raceCancellation` RESOLVES with a marker instead of throwing, so the
  // sentinel tells the two apart; rethrowing puts us on the poison path
  // immediately rather than waiting out the 15s grace window.
  const FINISHED = 'finished';

  function poolWorkStage(name: StageName): Stage<Record<string, never>> {
    return {
      ...stage(name),
      run: async (_ctx: TestContext, pool: WorkerPool) => {
        await pool.submit(async (_state, raceCancellation) => {
          const settled = await raceCancellation(() => sleep(150).then(() => FINISHED));
          if (settled !== FINISHED) throw new Error('stage aborted');
          return FINISHED;
        });
        return {};
      },
    };
  }

  function poolWorkPipeline(): Pipeline {
    return createPipeline({
      name: 'test',
      description: 'test pipeline',
      report: {
        reportLabel: 'Test',
        renderHeaderUrls: () => null,
        renderTestCardUrls: () => null,
        renderDialogMetaUrls: () => null,
      },
    }, (builder) => {
      const pool = builder.registerWorkerPool(2);
      builder.runStage(pool, poolWorkStage('perf'));
      builder.waitForAllTasksFinishAndDispose(pool);
      builder.buildChips({
        chipsForAllTests: (perTest) => new Map(perTest.map(({ test }) => [test, []])),
      });
      builder.buildSorts({ sortsForAllTests: () => new Map() });
    });
  }

  const definition = (name: string, config?: AbTestDefinition['config']): AbTestDefinition => ({
    name,
    startingPath: '/',
    file: null,
    line: null,
    testTypes: null,
    testFn: async () => {},
    ...(config ? { config } : {}),
  });

  beforeEach(() => {
    jest.mocked(loadTests).mockReset();
  });

  it('caps a test at ITS OWN timeoutMs and everyone else at the file\'s', async () => {
    // 20ms against a file-wide 60s: only the per-test value can end this task,
    // and only if the runner actually delivers it to the pool.
    const capped = definition('Capped', { shared: { timeoutMs: 20 } });
    const plain = definition('Plain');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-task-limits-'));
    const savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = cwd;
    try {
      jest.mocked(loadTests).mockResolvedValue([capped, plain]);
      const result = await runPipeline(poolWorkPipeline(), {
        cwd,
        config: buildAbTestsConfig({ shared: { controlURL: 'http://control.test', experimentURL: 'http://experiment.test', parallelism: 2, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 }, browserConsole: { failOn: ['error', 'warn'], allowList: [] }, viewports: ['desktop'], timeoutMs: 60_000, retries: 0, retryDelay: 0 } }),
        controlURL: 'http://control.test',
        experimentURL: 'http://experiment.test',
        tests: [capped, plain],
        skipReport: true,
      });

      const outcomeFor = (name: string) =>
        result.testResults.find((t) => t.name === name)?.outcomes[0];

      expect(outcomeFor('Capped')?.kind).toBe('error');
      expect(outcomeFor('Capped')?.error?.message)
        .toContain('task exceeded its 20ms budget');
      // The file's 60s cap never fires, so the un-overriding test just finishes.
      expect(outcomeFor('Plain')?.kind).toBe('ok');
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
