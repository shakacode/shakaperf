/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  executeBisect,
  restoreExperimentState,
  runBisect,
  type BisectDecisionLogEntry,
  type ExecuteBisectDependencies,
  type ExecuteBisectInput,
} from '../session';
import { BisectInterruptedError, runCandidate } from '../run-candidate';
import type { AbTestsConfig } from '../../../config';
import type { TestResult } from '../../../pipeline/report';
import type { BisectSession } from '../types';

function config(): AbTestsConfig {
  return {
    bisect: {
      rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
      rebuildContainer: false,
    },
  } as AbTestsConfig;
}

function input(rootDir: string): ExecuteBisectInput {
  return {
    cwd: rootDir,
    resultsDirectory: path.join(rootDir, 'compare-bisect-results'),
    config: config(),
    twinServers: {} as ExecuteBisectInput['twinServers'],
    selectedCategories: ['visreg'],
    frozenTests: [],
    gitRange: {
      goodSha: 'good',
      badSha: 'bad',
      orderedCommits: ['good', 'a', 'b', 'bad'],
      originalExperiment: {
        branch: 'feature',
        sha: 'bad',
      },
    },
    headed: false,
    controlURL: 'http://control.test',
    experimentURL: 'http://experiment.test',
    reuseCurrentResults: false,
    dryRun: false,
    validateGoodRef: false,
  };
}

function resultWithVisualDiff(diffImage: string | null): TestResult {
  return {
    id: 'homepage',
    name: 'Homepage',
    filePath: 'tests/homepage.abtest.ts',
    startingPath: '/',
    controlUrl: 'http://control.test/',
    experimentUrl: 'http://experiment.test/',
    code: null,
    chips: [],
    sorts: [],
    durationMs: 0,
    measuredAt: null,
    runId: null,
    viewportArtifactPaths: [],
    outcomes: [{
      kind: 'ok',
      stage: 'visreg',
      viewport: DESKTOP_VIEWPORT,
      measurement: [{
        selector: 'document',
        controlImage: 'control.png',
        experimentImage: 'experiment.png',
        diffImage,
        misMatchPercentage: diffImage ? 2.5 : 0,
        diffPixels: diffImage ? 42 : 0,
        threshold: 0.1,
        diffBbox: null,
        savedByRetries: false,
      }],
    }],
  };
}

function resultWithVisualDiffAndError(diffImage: string | null): TestResult {
  const result = resultWithVisualDiff(diffImage);
  result.outcomes.push({
    kind: 'error',
    stage: 'visreg',
    viewport: DESKTOP_VIEWPORT,
    error: { message: 'capture failed after one selector succeeded' },
  });
  return result;
}

interface HarnessOptions {
  signalOnCompare?: string;
  signalOnTerminalWriteStatus?: BisectSession['status'];
  signalOnSummary?: boolean;
  signal?: NodeJS.Signals;
  beginSessionError?: Error;
  checkoutErrorBySha?: Record<string, Error>;
  materializeErrorBySha?: Record<string, Error>;
  compareErrorBySha?: Record<string, Error>;
  refreshBySha?: Record<string, { mode: 'commands' | 'container'; usedFallback: boolean }>;
  restoreError?: Error;
  disposeError?: Error;
  terminalWriteSessionErrors?: Error[];
}

function deps(
  resultsBySha: Record<string, readonly TestResult[]>,
  options: HarnessOptions = {},
): {
  deps: ExecuteBisectDependencies;
  emitSignal(signal: NodeJS.Signals): void;
  calls: {
    checkouts: string[];
    materialized: Array<[string | null, string]>;
    refreshes: string[];
    compares: Array<{ sha: string; categories: string[]; testFiles: string[] }>;
    reusedResults: Array<{ sha: string; categories: string[] }>;
    sessions: BisectSession[];
    summaries: BisectSession[];
    restored: Array<[string | null, string]>;
    events: string[];
    progress: string[];
    decisions: BisectDecisionLogEntry[];
    disposeAttempts: number;
    sessionAttempts: BisectSession[];
    summaryWriteHandlerCounts: number[];
    terminalWriteHandlerCounts: number[];
    checkpoints: Array<{ afterEvent: string | undefined; session: BisectSession }>;
    summaryAfterEvents: string[][];
    signalHandlers: Set<(signal: NodeJS.Signals) => void>;
  };
} {
  const calls = {
    checkouts: [] as string[],
    materialized: [] as Array<[string | null, string]>,
    refreshes: [] as string[],
    compares: [] as Array<{ sha: string; categories: string[]; testFiles: string[] }>,
    reusedResults: [] as Array<{ sha: string; categories: string[] }>,
    sessions: [] as BisectSession[],
    summaries: [] as BisectSession[],
    restored: [] as Array<[string | null, string]>,
    events: [] as string[],
    progress: [] as string[],
    decisions: [] as BisectDecisionLogEntry[],
    disposeAttempts: 0,
    sessionAttempts: [] as BisectSession[],
    summaryWriteHandlerCounts: [] as number[],
    terminalWriteHandlerCounts: [] as number[],
    checkpoints: [] as Array<{ afterEvent: string | undefined; session: BisectSession }>,
    summaryAfterEvents: [] as string[][],
    signalHandlers: new Set<(signal: NodeJS.Signals) => void>(),
  };
  return {
    calls,
    emitSignal(signal) {
      for (const handler of calls.signalHandlers) handler(signal);
    },
    deps: {
      installSignalHandlers(handler) {
        calls.signalHandlers.add(handler);
        return () => {
          calls.disposeAttempts += 1;
          calls.signalHandlers.delete(handler);
          if (options.disposeError) throw options.disposeError;
        };
      },
      async beginSession() {
        calls.events.push('lease:begin');
        if (options.beginSessionError) throw options.beginSessionError;
      },
      async endSession() {
        calls.events.push('lease:end');
      },
      async checkout(sha) {
        calls.checkouts.push(sha);
        calls.events.push(`checkout:${sha}`);
        const checkoutError = options.checkoutErrorBySha?.[sha];
        if (checkoutError) throw checkoutError;
      },
      async restore(request) {
        calls.restored.push([request.previousSha, request.originalSha]);
        calls.events.push('checkout:original');
        calls.events.push('sync:original');
        calls.events.push('refresh:original');
        if (options.restoreError) throw options.restoreError;
      },
      clearSummary() {},
      async materialize(request) {
        calls.materialized.push([request.previousSha, request.candidateSha]);
        calls.events.push(`materialize:${request.candidateSha}`);
        const materializeError = options.materializeErrorBySha?.[request.candidateSha];
        if (materializeError) throw materializeError;
      },
      async refresh(request) {
        calls.refreshes.push(request.sha);
        calls.events.push(`refresh:${request.sha}`);
        return options.refreshBySha?.[request.sha]
          ?? { mode: request.preferredMode, usedFallback: false };
      },
      async compare(request) {
        calls.events.push(`compare:${request.sha}`);
        calls.compares.push({
          sha: request.sha,
          categories: [...request.categories],
          testFiles: [...request.testFiles],
        });
        if (options.signalOnCompare === request.sha) {
          for (const handler of calls.signalHandlers) handler(options.signal ?? 'SIGINT');
        }
        const compareError = options.compareErrorBySha?.[request.sha];
        if (compareError) throw compareError;
        return {
          testResults: resultsBySha[request.sha] ?? [],
          compareResultsPath: `/repo/compare-bisect-results/commits/${request.sha}/compare-results`,
        };
      },
      async reuseCurrentResults(request) {
        calls.events.push(`reuse:${request.sha}`);
        calls.reusedResults.push({
          sha: request.sha,
          categories: [...request.categories],
        });
        return {
          testResults: resultsBySha[request.sha] ?? [],
          compareResultsPath: '/repo/compare-results',
        };
      },
      writeSession(session) {
        const snapshot = JSON.parse(JSON.stringify(session)) as BisectSession;
        calls.sessionAttempts.push(snapshot);
        if (session.status !== 'running') {
          calls.terminalWriteHandlerCounts.push(calls.signalHandlers.size);
        }
        if (session.status === options.signalOnTerminalWriteStatus) {
          for (const handler of calls.signalHandlers) handler(options.signal ?? 'SIGINT');
        }
        if (session.status !== 'running') {
          const writeError = options.terminalWriteSessionErrors?.shift();
          if (writeError) throw writeError;
        }
        calls.sessions.push(snapshot);
        calls.checkpoints.push({ afterEvent: calls.events.at(-1), session: snapshot });
      },
      writeSummary(session) {
        calls.summaryWriteHandlerCounts.push(calls.signalHandlers.size);
        if (options.signalOnSummary) {
          for (const handler of calls.signalHandlers) handler(options.signal ?? 'SIGINT');
        }
        calls.summaries.push(JSON.parse(JSON.stringify(session)) as BisectSession);
        calls.summaryAfterEvents.push([...calls.events]);
      },
      recordDecision(entry) {
        calls.decisions.push(JSON.parse(JSON.stringify(entry)) as BisectDecisionLogEntry);
      },
      logProgress(message) {
        calls.progress.push(message);
      },
      now() {
        return '2026-07-12T00:00:00.000Z';
      },
    },
  };
}

describe('compare bisect session orchestration', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-session-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('finds the first bad commit and narrows candidate compare work', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect(input(rootDir), harness.deps);

    expect(session.status).toBe('complete');
    expect(session.targets).toMatchObject([{
      category: 'visreg',
      subject: 'document',
      status: 'found',
      firstBadSha: 'b',
      observations: {
        bad: expect.objectContaining({
          commitSha: 'bad',
          present: true,
          values: expect.objectContaining({ diffPixels: 42 }),
          artifacts: expect.arrayContaining(['control.png', 'experiment.png', 'diff.png']),
        }),
      },
    }]);
    expect(harness.calls.checkouts).toEqual(['bad', 'a', 'b']);
    expect(harness.calls.materialized).toEqual([
      [null, 'bad'],
      ['bad', 'a'],
      ['a', 'b'],
    ]);
    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], testFiles: [] },
      { sha: 'a', categories: ['visreg'], testFiles: ['tests/homepage.abtest.ts'] },
      { sha: 'b', categories: ['visreg'], testFiles: ['tests/homepage.abtest.ts'] },
    ]);
    expect(harness.calls.summaries.at(-1)?.status).toBe('complete');
    expect(harness.calls.restored).toEqual([['b', 'bad']]);
    expect(harness.calls.events.at(0)).toBe('lease:begin');
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
    expect(harness.calls.progress).toEqual(expect.arrayContaining([
      'Starting compare bisect session',
      'Measuring bad ref bad to discover regression targets',
      'Selected midpoint a for 1 active target(s)',
      'Selected midpoint b for 1 active target(s)',
      'Compare bisect session completed',
    ]));
    expect(harness.calls.decisions.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      'session-start',
      'bad-ref-targets',
      'candidate-selected',
      'candidate-observed',
      'session-complete',
    ]));
    expect(harness.calls.decisions.find((entry) => (
      entry.event === 'candidate-selected' && entry.data?.sha === 'b'
    ))?.data).toMatchObject({
      sha: 'b',
      targets: [expect.objectContaining({
        interval: {
          goodIndex: 1,
          goodSha: 'a',
          badIndex: 3,
          badSha: 'bad',
        },
      })],
    });
  });

  it('reuses current results for bad-ref discovery without rebuilding the bad ref', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });
    const reuseInput = {
      ...input(rootDir),
      reuseCurrentResults: true,
    };

    const session = await executeBisect(reuseInput, harness.deps);

    expect(session.targets).toMatchObject([{
      status: 'found',
      firstBadSha: 'b',
    }]);
    expect(harness.calls.reusedResults).toEqual([{
      sha: 'bad',
      categories: ['visreg'],
    }]);
    expect(harness.calls.checkouts).toEqual(['a', 'b']);
    expect(harness.calls.refreshes).toEqual(['a', 'b']);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['a', 'b']);
    expect(session.commitRuns.bad).toMatchObject({
      reusedResults: true,
      compareResultsPath: '/repo/compare-results',
    });
    expect(harness.calls.decisions.map((entry) => entry.event)).toContain('bad-ref-reuse-start');
  });

  it('validates the good ref before midpoint search only when requested', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect({
      ...input(rootDir),
      reuseCurrentResults: true,
      validateGoodRef: true,
    }, harness.deps);

    expect(session.targets).toMatchObject([{ status: 'found', firstBadSha: 'b' }]);
    expect(harness.calls.checkouts).toEqual(['good', 'a', 'b']);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['good', 'a', 'b']);
    expect(harness.calls.decisions.map((entry) => entry.event)).toContain('good-ref-validated');
  });

  it('dry runs through target discovery and records the first midpoint by default', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    });
    const dryRunInput = {
      ...input(rootDir),
      reuseCurrentResults: true,
      dryRun: true,
    };

    const session = await executeBisect(dryRunInput, harness.deps);

    expect(session).toMatchObject({
      status: 'complete',
      dryRun: true,
      nextAction: {
        kind: 'measure-candidate',
        sha: 'a',
        categories: ['visreg'],
        testFiles: ['tests/homepage.abtest.ts'],
        targetIds: ['["visreg","tests/homepage.abtest.ts","Homepage","desktop","document"]'],
      },
      targets: [expect.objectContaining({
        status: 'active',
        category: 'visreg',
        subject: 'document',
      })],
    });
    expect(harness.calls.reusedResults).toEqual([{ sha: 'bad', categories: ['visreg'] }]);
    expect(harness.calls.checkouts).toEqual([]);
    expect(harness.calls.compares).toEqual([]);
    expect(harness.calls.restored).toEqual([]);
    expect(harness.calls.decisions.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      'bad-ref-targets',
      'dry-run-plan',
      'session-dry-run-complete',
    ]));
    expect(harness.calls.decisions.map((entry) => entry.event)).not.toContain('good-ref-start');
    expect(harness.calls.decisions.map((entry) => entry.event)).not.toContain('candidate-selected');
  });

  it('dry runs by measuring only the bad ref when current results are not reused', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect({
      ...input(rootDir),
      dryRun: true,
    }, harness.deps);

    expect(session).toMatchObject({
      status: 'complete',
      dryRun: true,
      nextAction: {
        kind: 'measure-candidate',
        sha: 'a',
      },
    });
    expect(harness.calls.checkouts).toEqual(['bad']);
    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], testFiles: [] },
    ]);
    expect(harness.calls.restored).toEqual([['bad', 'bad']]);
    expect(harness.calls.decisions.map((entry) => entry.event)).not.toContain('good-ref-start');
  });

  it('plans good-ref validation in dry-run mode only when requested', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect({
      ...input(rootDir),
      reuseCurrentResults: true,
      dryRun: true,
      validateGoodRef: true,
    }, harness.deps);

    expect(session).toMatchObject({
      nextAction: {
        kind: 'validate-good-ref',
        sha: 'good',
      },
    });
  });

  it('marks targets invalid when they are already present at the good ref', async () => {
    const harness = deps({
      good: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect({
      ...input(rootDir),
      validateGoodRef: true,
    }, harness.deps);

    expect(session.status).toBe('complete');
    expect(session.targets).toMatchObject([{
      status: 'invalid',
      invalidReason: 'target is already present at the good ref',
    }]);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'good']);
    expect(harness.calls.restored).toEqual([['good', 'bad']]);
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
  });

  it('validates the good endpoint when good and bad are adjacent', async () => {
    const harness = deps({
      good: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });
    const adjacentInput: ExecuteBisectInput = {
      ...input(rootDir),
      validateGoodRef: true,
      gitRange: {
        ...input(rootDir).gitRange,
        orderedCommits: ['good', 'bad'],
      },
    };

    const session = await executeBisect(adjacentInput, harness.deps);

    expect(session.targets).toMatchObject([{
      status: 'invalid',
      invalidReason: 'target is already present at the good ref',
      observations: {
        bad: expect.objectContaining({ present: true }),
        good: expect.objectContaining({ present: true }),
      },
    }]);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'good']);
  });

  it('persists failed state and restores after candidate infrastructure errors', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      bad: [resultWithVisualDiff('diff.png')],
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/candidate a failed/i);

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'failed',
      failure: expect.stringMatching(/candidate a failed/i),
    });
    expect(harness.calls.sessions.at(-1)?.commitRuns.a).toMatchObject({
      infrastructureError: expect.stringMatching(/missing visreg measurement/i),
    });
    expect(harness.calls.restored).toEqual([['a', 'bad']]);
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
  });

  it('retries a transient terminal persistence failure with durable failed state', async () => {
    const harness = deps({ bad: [] }, {
      terminalWriteSessionErrors: [new Error('transient persistence failure')],
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(
      /transient persistence failure/i,
    );

    expect(harness.calls.sessionAttempts.filter((session) => session.status !== 'running')
      .map((session) => session.status)).toEqual(['complete', 'failed']);
    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'failed',
      failure: expect.stringMatching(/transient persistence failure/i),
    });
    expect(harness.calls.sessions.some((session) => session.status === 'complete')).toBe(false);
    expect(harness.calls.summaries).toEqual([]);
  });

  it('bounds permanent terminal persistence failure without complete artifacts', async () => {
    const harness = deps({ bad: [] }, {
      terminalWriteSessionErrors: [
        new Error('persistence failed once'),
        new Error('persistence failed twice'),
      ],
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/persistence failed/i);

    expect(harness.calls.sessionAttempts.filter((session) => session.status !== 'running'))
      .toHaveLength(2);
    expect(harness.calls.sessions.some((session) => session.status === 'complete')).toBe(false);
    expect(harness.calls.summaries).toEqual([]);
  });

  it('invalidates a stale complete summary before checkout when terminal persistence fails permanently', async () => {
    const harness = deps({ bad: [] }, {
      terminalWriteSessionErrors: [
        new Error('persistence failed once'),
        new Error('persistence failed twice'),
      ],
    });
    let visibleSummary: BisectSession | null = { status: 'complete' } as BisectSession;
    harness.deps.clearSummary = () => {
      visibleSummary = null;
      harness.calls.events.push('summary:cleared');
    };

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/persistence failed/i);

    expect(harness.calls.events.indexOf('summary:cleared'))
      .toBeLessThan(harness.calls.events.indexOf('checkout:bad'));
    expect(visibleSummary).toBeNull();
    expect(harness.calls.summaries).toEqual([]);
  });

  it('rethrows the primary error object with cleanup failure context', async () => {
    const primaryError = new TypeError('lease acquisition exploded');
    const originalStack = primaryError.stack;
    const harness = deps({}, {
      beginSessionError: primaryError,
      disposeError: new Error('dispose exploded'),
    });

    let rejection: unknown;
    try {
      await executeBisect(input(rootDir), harness.deps);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBe(primaryError);
    expect(rejection).toBeInstanceOf(TypeError);
    expect((rejection as Error).stack).toBe(originalStack);
    expect((rejection as Error).cause).toEqual(expect.objectContaining({
      message: expect.stringMatching(/dispose exploded/i),
    }));
  });

  it('persists handler disposal failure before writing terminal artifacts', async () => {
    const harness = deps({ bad: [] }, {
      disposeError: new Error('dispose exploded'),
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/dispose exploded/i);

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'failed',
      failure: expect.stringMatching(/dispose exploded/i),
    });
    expect(harness.calls.sessions.some((session) => session.status === 'complete')).toBe(false);
    expect(harness.calls.summaries).toEqual([]);
    expect(harness.calls.disposeAttempts).toBe(1);
    expect(harness.calls.terminalWriteHandlerCounts).toEqual([0]);
  });

  it('restores after the first checkout mutates the worktree and then rejects', async () => {
    const harness = deps({}, {
      checkoutErrorBySha: {
        bad: new Error('checkout mutated then exploded'),
      },
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/checkout mutated then exploded/i);

    expect(harness.calls.restored).toEqual([[null, 'bad']]);
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
  });

  it('forces a full restore reconcile after materialization partially fails', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      materializeErrorBySha: {
        a: new Error('materialize partially copied then exploded'),
      },
    });

    await expect(executeBisect(input(rootDir), harness.deps))
      .rejects.toThrow(/materialize partially copied then exploded/i);

    expect(harness.calls.restored).toEqual([[null, 'bad']]);
  });

  it('rejects mixed valid and error outcomes without advancing boundaries', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiffAndError(null)],
      bad: [resultWithVisualDiff('diff.png')],
    });

    await expect(executeBisect(input(rootDir), harness.deps))
      .rejects.toThrow(/a.*visreg.*capture failed/i);

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'failed',
      targets: [{ goodIndex: 0, badIndex: 3 }],
    });
    expect(harness.calls.sessions.at(-1)?.targets[0]?.observations.a).toBeUndefined();
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'a']);
  });

  it('persists checkout, materialize, refresh, compare, and boundary checkpoints', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    await executeBisect(input(rootDir), harness.deps);

    for (const event of ['checkout:bad', 'materialize:bad', 'refresh:bad', 'compare:bad']) {
      expect(harness.calls.checkpoints.some((checkpoint) => checkpoint.afterEvent === event)).toBe(true);
    }
    expect(harness.calls.checkpoints.some((checkpoint) => (
      checkpoint.afterEvent === 'compare:a'
      && checkpoint.session.targets[0]?.observations.a?.present === false
    ))).toBe(true);
  });

  it('persists actual fallback metadata before a compare failure', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      refreshBySha: {
        a: { mode: 'container', usedFallback: true },
      },
      compareErrorBySha: {
        a: new Error('compare exploded'),
      },
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/compare exploded/i);

    expect(harness.calls.sessions.at(-1)?.commitRuns.a).toMatchObject({
      refreshMode: 'container',
      usedFallback: true,
      infrastructureError: 'compare exploded',
    });
    const beforeCompare = harness.calls.checkpoints.find((checkpoint) => (
      checkpoint.afterEvent === 'refresh:a'
      && checkpoint.session.commitRuns.a?.usedFallback === true
    ));
    expect(beforeCompare?.session.commitRuns.a?.compareResultsPath).toBeUndefined();
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'handles %s by interrupting before boundary updates and cleaning up',
    async (signal) => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      signalOnCompare: 'a',
      signal,
    });

    let rejection: unknown;
    try {
      await executeBisect(input(rootDir), harness.deps);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(BisectInterruptedError);
    expect((rejection as Error).message).toMatch(new RegExp(signal, 'i'));
    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'interrupted',
    });
    expect(harness.calls.sessions.at(-1)?.targets[0]?.observations.a).toBeUndefined();
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
    expect(harness.calls.signalHandlers.size).toBe(0);
    },
  );

  it('leaves failed durable state and no summary when restoration fails', async () => {
    const harness = deps({
      bad: [],
    }, {
      restoreError: new Error('restore exploded'),
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/restore exploded/i);

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'failed',
      failure: expect.stringMatching(/restore exploded/i),
    });
    expect(harness.calls.sessions.some((session) => session.status === 'complete')).toBe(false);
    expect(harness.calls.summaries).toEqual([]);
    expect(harness.calls.events.at(-1)).toBe('lease:end');
  });

  it('writes complete state and summary only after restoration and lease release', async () => {
    const harness = deps({
      bad: [],
    });

    await executeBisect(input(rootDir), harness.deps);

    const completeCheckpoint = harness.calls.checkpoints.find((checkpoint) => (
      checkpoint.session.status === 'complete'
    ));
    expect(completeCheckpoint?.afterEvent).toBe('lease:end');
    expect(harness.calls.summaryAfterEvents[0]?.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
  });

  it('disposes signal handlers before summary and session terminal writes', async () => {
    const harness = deps({ bad: [] }, {
      signalOnTerminalWriteStatus: 'complete',
      signalOnSummary: true,
      signal: 'SIGTERM',
    });

    await expect(executeBisect(input(rootDir), harness.deps)).resolves.toMatchObject({
      status: 'complete',
    });

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'complete',
    });
    expect(harness.calls.summaries.at(-1)).toMatchObject({ status: 'complete' });
    expect(harness.calls.signalHandlers.size).toBe(0);
    expect(harness.calls.summaryWriteHandlerCounts).toEqual([0]);
    expect(harness.calls.terminalWriteHandlerCounts).toEqual([0]);
  });

  it('runs a shared midpoint once for multiple cached targets', async () => {
    const withTwoSelectors = (diffImage: string | null): TestResult => {
      const result = resultWithVisualDiff(diffImage);
      const visreg = result.outcomes[0]!.measurement as Array<Record<string, unknown>>;
      visreg.push({ ...visreg[0], selector: '[data-cy="hero"]' });
      return result;
    };
    const harness = deps({
      good: [withTwoSelectors(null)],
      a: [withTwoSelectors(null)],
      b: [withTwoSelectors('diff.png')],
      bad: [withTwoSelectors('diff.png')],
    });

    const session = await executeBisect(input(rootDir), harness.deps);

    expect(session.targets).toHaveLength(2);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'a', 'b']);
  });

  it('exposes one-object runBisect and runCandidate contracts', async () => {
    const harness = deps({ bad: [] });
    const bisectInput = input(rootDir);

    await expect(runBisect({
      cwd: bisectInput.cwd,
      resultsDirectory: bisectInput.resultsDirectory,
      config: bisectInput.config,
      twinServers: bisectInput.twinServers,
      selectedCategories: bisectInput.selectedCategories,
      frozenTests: bisectInput.frozenTests,
      headed: bisectInput.headed,
      controlURL: bisectInput.controlURL,
      experimentURL: bisectInput.experimentURL,
      gitRange: bisectInput.gitRange,
      dependencies: harness.deps,
    })).resolves.toMatchObject({ status: 'complete' });
    expect(runCandidate).toEqual(expect.any(Function));
  });
});

describe('experiment restoration', () => {
  it.each([
    ['checkout', ['checkout', 'refresh']],
    ['sync', ['checkout', 'sync', 'refresh']],
  ] as const)('attempts refresh after %s restoration fails', async (failure, expectedEvents) => {
    const events: string[] = [];

    await expect(restoreExperimentState({
      async restoreCheckout() {
        events.push('checkout');
        if (failure === 'checkout') throw new Error('checkout restore failed');
      },
      async syncVolume() {
        events.push('sync');
        if (failure === 'sync') throw new Error('volume restore failed');
      },
      async refreshExperiment() {
        events.push('refresh');
      },
    })).rejects.toThrow(new RegExp(failure === 'checkout' ? 'checkout restore' : 'volume restore'));

    expect(events).toEqual(expectedEvents);
  });
});
