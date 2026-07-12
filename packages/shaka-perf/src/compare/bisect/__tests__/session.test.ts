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
  runBisect,
  type BisectDecisionLogEntry,
  type ExecuteBisectDependencies,
  type ExecuteBisectInput,
} from '../session';
import { runCandidate } from '../run-candidate';
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
  signalOnDecisionEvent?: string;
  signal?: NodeJS.Signals;
  checkoutErrorBySha?: Record<string, Error>;
  compareErrorBySha?: Record<string, Error>;
  refreshBySha?: Record<string, { mode: 'commands' | 'container'; usedFallback: boolean }>;
  restoreError?: Error;
  writeSessionErrorStatus?: BisectSession['status'];
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
    sessions: BisectSession[];
    summaries: BisectSession[];
    restored: Array<[string | null, string]>;
    events: string[];
    progress: string[];
    decisions: BisectDecisionLogEntry[];
    checkpoints: Array<{ afterEvent: string | undefined; session: BisectSession }>;
    summaryAfterEvents: string[][];
    signalHandlers: Set<(signal: NodeJS.Signals) => void>;
  };
} {
  let writeSessionErrorThrown = false;
  const calls = {
    checkouts: [] as string[],
    materialized: [] as Array<[string | null, string]>,
    refreshes: [] as string[],
    compares: [] as Array<{ sha: string; categories: string[]; testFiles: string[] }>,
    sessions: [] as BisectSession[],
    summaries: [] as BisectSession[],
    restored: [] as Array<[string | null, string]>,
    events: [] as string[],
    progress: [] as string[],
    decisions: [] as BisectDecisionLogEntry[],
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
        return () => calls.signalHandlers.delete(handler);
      },
      async beginSession() {
        calls.events.push('lease:begin');
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
      async materialize(request) {
        calls.materialized.push([request.previousSha, request.candidateSha]);
        calls.events.push(`materialize:${request.candidateSha}`);
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
      writeSession(session) {
        const snapshot = JSON.parse(JSON.stringify(session)) as BisectSession;
        calls.sessions.push(snapshot);
        calls.checkpoints.push({ afterEvent: calls.events.at(-1), session: snapshot });
        if (!writeSessionErrorThrown && session.status === options.writeSessionErrorStatus) {
          writeSessionErrorThrown = true;
          throw new Error(`persist ${session.status} exploded`);
        }
      },
      writeSummary(session) {
        calls.summaries.push(JSON.parse(JSON.stringify(session)) as BisectSession);
        calls.summaryAfterEvents.push([...calls.events]);
      },
      recordDecision(entry) {
        calls.decisions.push(JSON.parse(JSON.stringify(entry)) as BisectDecisionLogEntry);
        if (entry.event === options.signalOnDecisionEvent) {
          for (const handler of calls.signalHandlers) handler(options.signal ?? 'SIGINT');
        }
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
    }]);
    expect(harness.calls.checkouts).toEqual(['bad', 'good', 'a', 'b']);
    expect(harness.calls.materialized).toEqual([
      [null, 'bad'],
      ['bad', 'good'],
      ['good', 'a'],
      ['a', 'b'],
    ]);
    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], testFiles: [] },
      { sha: 'good', categories: ['visreg'], testFiles: ['tests/homepage.abtest.ts'] },
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

  it('marks targets invalid when they are already present at the good ref', async () => {
    const harness = deps({
      good: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect(input(rootDir), harness.deps);

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

  it('still restores, releases the lease, and disposes handlers when failure persistence throws', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      compareErrorBySha: {
        bad: new Error('compare exploded'),
      },
      writeSessionErrorStatus: 'failed',
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(
      /compare exploded.*session persistence failed: persist failed exploded/i,
    );

    expect(harness.calls.restored).toEqual([['bad', 'bad']]);
    expect(harness.calls.events.slice(-4)).toEqual([
      'checkout:original',
      'sync:original',
      'refresh:original',
      'lease:end',
    ]);
    expect(harness.calls.signalHandlers.size).toBe(0);
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
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'good', 'a']);
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

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(new RegExp(signal, 'i'));

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

  it('keeps signal handlers through final durable-state persistence', async () => {
    const harness = deps({ bad: [] }, {
      signalOnDecisionEvent: 'session-complete',
      signal: 'SIGTERM',
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(/SIGTERM/i);

    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'interrupted',
      failure: expect.stringMatching(/SIGTERM/i),
    });
    expect(harness.calls.sessions.at(-1)?.status).not.toBe('running');
    expect(harness.calls.signalHandlers.size).toBe(0);
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
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'good', 'a', 'b']);
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
