/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  executeBisect,
  filterFrozenTests,
  runBisect,
  type BisectDecisionLogEntry,
  type ExecuteBisectDependencies,
  type ExecuteBisectInput,
} from '../session';
import * as bisectGit from '../git';
import { BisectInterruptedError } from '../run-candidate';
import type { AbTestsConfig } from '../../../config';
import type { TestResult } from '../../../pipeline/report';
import type { BisectSession } from '../types';
import { BISECT_REPORT_FILENAME } from '../report';
import { parseBisectSession } from '../state';
import type { BisectSummaryMetadata } from '../persistence';
import { createFileBisectDecisionLogger } from '../execution-services';

function config(): AbTestsConfig {
  return {
    bisect: {
      rebuildContainer: false,
    },
    twinServers: {
      rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
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
      commitSubjects: {
        good: 'good',
        a: 'a',
        b: 'b',
        bad: 'bad',
      },
      commitParents: {
        good: [],
        a: ['good'],
        b: ['a'],
        bad: ['b'],
      },
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

function resultForTest(
  testFile: string,
  testName: string,
  diffImage: string | null,
): TestResult {
  return {
    ...resultWithVisualDiff(diffImage),
    id: JSON.stringify([testFile, testName]),
    name: testName,
    filePath: testFile,
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

function frozenTest(rootDir: string, testFile: string, testName: string): AbTestDefinition {
  return {
    name: testName,
    startingPath: '/',
    file: path.join(rootDir, testFile),
    line: 1,
    testTypes: null,
    testFn: async () => undefined,
  };
}

interface HarnessOptions {
  signalOnCompare?: string;
  signalOnTerminalWriteStatus?: BisectSession['status'];
  signalOnSummary?: boolean;
  signal?: NodeJS.Signals;
  beginSessionError?: Error;
  checkoutErrorBySha?: Record<string, Error>;
  compareErrorBySha?: Record<string, Error>;
  refreshBySha?: Record<string, { mode: 'commands' | 'container'; usedFallback: boolean }>;
  endpointRestoreError?: Error;
  restoreError?: Error;
  disposeError?: Error;
  terminalWriteSessionErrors?: Error[];
  reportErrors?: Array<Error | undefined>;
  previewResetError?: Error;
  clearPriorReportOutput?: () => void;
  nativeHistory?: string[];
}

function deps(
  resultsBySha: Record<string, readonly TestResult[]>,
  options: HarnessOptions = {},
): {
  deps: ExecuteBisectDependencies;
  emitSignal(signal: NodeJS.Signals): void;
  calls: {
    checkouts: string[];
    refreshes: string[];
    compares: Array<{
      sha: string;
      categories: string[];
      tests: Array<{ testFile: string; testName: string }>;
    }>;
    reusedResults: Array<{ sha: string; categories: string[] }>;
    reports: Array<{ session: BisectSession; testNames: string[] }>;
    sessions: BisectSession[];
    summaries: BisectSession[];
    summaryMetadata: BisectSummaryMetadata[];
    restored: string[];
    events: string[];
    progress: string[];
    decisions: BisectDecisionLogEntry[];
    disposeAttempts: number;
    nativeResetAttempts: number;
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
    refreshes: [] as string[],
    compares: [] as Array<{
      sha: string;
      categories: string[];
      tests: Array<{ testFile: string; testName: string }>;
    }>,
    reusedResults: [] as Array<{ sha: string; categories: string[] }>,
    reports: [] as Array<{ session: BisectSession; testNames: string[] }>,
    sessions: [] as BisectSession[],
    summaries: [] as BisectSession[],
    summaryMetadata: [] as BisectSummaryMetadata[],
    restored: [] as string[],
    events: [] as string[],
    progress: [] as string[],
    decisions: [] as BisectDecisionLogEntry[],
    disposeAttempts: 0,
    nativeResetAttempts: 0,
    sessionAttempts: [] as BisectSession[],
    summaryWriteHandlerCounts: [] as number[],
    terminalWriteHandlerCounts: [] as number[],
    checkpoints: [] as Array<{ afterEvent: string | undefined; session: BisectSession }>,
    summaryAfterEvents: [] as string[][],
    signalHandlers: new Set<(signal: NodeJS.Signals) => void>(),
  };
  const primaryNativeHistory = options.nativeHistory ?? ['good', 'a', 'b', 'bad'];
  const nativeHistories = [primaryNativeHistory, ['base', 'source', 'topic']];
  let nativeHistory = primaryNativeHistory;
  let nativeGood = 'good';
  let nativeBad = 'bad';
  let nativeCandidate: string | null = null;
  const nativeStep = (): bisectGit.NativeBisectStep => {
    const goodIndex = nativeHistory.indexOf(nativeGood);
    const badIndex = nativeHistory.indexOf(nativeBad);
    if (goodIndex === -1 || badIndex === -1 || goodIndex >= badIndex) {
      throw new Error(`Invalid stubbed native bisect range ${nativeGood}..${nativeBad}`);
    }
    if (badIndex - goodIndex === 1) {
      nativeCandidate = null;
      return { candidateSha: null, firstBadSha: nativeBad, complete: true, output: '' };
    }
    nativeCandidate = nativeHistory[Math.floor((goodIndex + badIndex) / 2)]!;
    calls.checkouts.push(nativeCandidate);
    calls.events.push(`checkout:${nativeCandidate}`);
    const checkoutError = options.checkoutErrorBySha?.[nativeCandidate];
    if (checkoutError) throw checkoutError;
    return { candidateSha: nativeCandidate, firstBadSha: null, complete: false, output: '' };
  };
  const nativeGit = new class extends bisectGit.NativeGitBisectDriver {
    constructor() {
      super({ repoDir: '/unused' });
    }

    override async start(group: import('../types').BisectTargetGroup) {
      nativeHistory = nativeHistories.find((history) => (
        history.includes(group.goodSha) && history.includes(group.badSha)
      )) ?? primaryNativeHistory;
      nativeGood = group.goodSha;
      nativeBad = group.badSha;
      return nativeStep();
    }

    override async mark(verdict: import('../git').NativeBisectVerdict) {
      if (!nativeCandidate) throw new Error('Stubbed native bisect has no candidate to mark');
      if (verdict === 'good') nativeGood = nativeCandidate;
      else nativeBad = nativeCandidate;
      return nativeStep();
    }

    override async reset() {
      calls.nativeResetAttempts += 1;
    }

    override async assertAt(expectedSha: string) {
      if (nativeCandidate !== expectedSha) {
        throw new Error(`Stubbed native bisect selected ${nativeCandidate}; expected ${expectedSha}`);
      }
    }

    override async preview(group: import('../types').BisectTargetGroup) {
      if (options.previewResetError) {
        const error = options.previewResetError;
        options.previewResetError = undefined;
        calls.nativeResetAttempts += 1;
        throw error;
      }
      const previewHistory = nativeHistories.find((history) => (
        history.includes(group.goodSha) && history.includes(group.badSha)
      )) ?? primaryNativeHistory;
      const goodIndex = previewHistory.indexOf(group.goodSha);
      const badIndex = previewHistory.indexOf(group.badSha);
      if (badIndex - goodIndex === 1) {
        return { candidateSha: null, firstBadSha: group.badSha, complete: true, output: '' };
      }
      return {
        candidateSha: previewHistory[Math.floor((goodIndex + badIndex) / 2)]!,
        firstBadSha: null,
        complete: false,
        output: '',
      };
    }
  }();
  const exactCheckout = new class extends bisectGit.ExactCheckout {
    constructor() {
      super({ repoDir: '/unused' });
    }

    override async current() {
      return { branch: 'feature', sha: 'bad' };
    }

    override async position(sha: string) {
      calls.checkouts.push(sha);
      calls.events.push(`checkout:${sha}`);
      const checkoutError = options.checkoutErrorBySha?.[sha];
      if (checkoutError) throw checkoutError;
    }

    override async assertAt() {}

    override async restore() {
      if (options.endpointRestoreError) throw options.endpointRestoreError;
    }
  }();
  return {
    calls,
    emitSignal(signal) {
      for (const handler of calls.signalHandlers) handler(signal);
    },
    deps: {
      nativeGit,
      exactCheckout,
      mergeRangeSource: {
        async load() {
          throw new Error('Unexpected merge range load');
        },
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      signals: {
        install(handler) {
          calls.signalHandlers.add(handler);
          return () => {
            calls.disposeAttempts += 1;
            calls.signalHandlers.delete(handler);
            if (options.disposeError) throw options.disposeError;
          };
        },
      },
      server: {
        async begin() {
          calls.events.push('lease:begin');
          if (options.beginSessionError) throw options.beginSessionError;
        },
        async end() {
          calls.events.push('lease:end');
        },
        async refreshExperiment(request) {
          calls.refreshes.push(request.sha);
          calls.events.push(`reload-experiment:${request.sha}`);
          return options.refreshBySha?.[request.sha]
            ?? { mode: request.preferredExperimentReloadMode, usedFallback: false };
        },
      },
      restoration: {
        async restore() {
          calls.restored.push('bad');
          calls.events.push('checkout:original');
          calls.events.push('reload-experiment:original');
          if (options.restoreError) throw options.restoreError;
        },
      },
      comparison: {
        async run(request) {
          calls.events.push(`run-candidate-comparisons:${request.sha}`);
          calls.compares.push({
            sha: request.sha,
            categories: [...request.categories],
            tests: [...request.tests],
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
      },
      reusableResults: {
        async load(request) {
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
      },
      artifacts: {
        clearPrevious() {
          options.clearPriorReportOutput?.();
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
        writeReport(session, badRefTests) {
          calls.reports.push({
            session: JSON.parse(JSON.stringify(session)) as BisectSession,
            testNames: badRefTests.map((test) => test.name),
          });
          const reportError = options.reportErrors?.shift();
          if (reportError) throw reportError;
        },
        writeSummary(session, metadata = {}) {
          calls.summaryWriteHandlerCounts.push(calls.signalHandlers.size);
          if (options.signalOnSummary) {
            for (const handler of calls.signalHandlers) handler(options.signal ?? 'SIGINT');
          }
          calls.summaries.push(JSON.parse(JSON.stringify(session)) as BisectSession);
          calls.summaryMetadata.push(JSON.parse(JSON.stringify(metadata)) as BisectSummaryMetadata);
          calls.summaryAfterEvents.push([...calls.events]);
        },
        writeBadRefTests() {
          return 'fixture';
        },
      },
      decisions: {
        record(entry) {
          calls.decisions.push(JSON.parse(JSON.stringify(entry)) as BisectDecisionLogEntry);
        },
        progress(message) {
          calls.progress.push(message);
        },
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
    const bisectInput = input(rootDir);
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect(bisectInput, harness.deps);

    expect(session.status).toBe('complete');
    expect('version' in parseBisectSession(session)).toBe(false);
    expect(session.primary.commitSubjects).toEqual(bisectInput.gitRange.commitSubjects);
    expect(harness.calls.sessions).toContainEqual(expect.objectContaining({
      primary: expect.objectContaining({
        commitSubjects: bisectInput.gitRange.commitSubjects,
      }),
    }));
    expect(session.primary.targets).toMatchObject([{
      category: 'visreg',
      subject: 'document',
      status: 'found',
      firstBadSha: 'b',
      recordedTargetEvaluations: {
        bad: expect.objectContaining({
          commitSha: 'bad',
          regressionDetected: true,
          evidence: expect.objectContaining({ diffPixels: 42 }),
          evidenceArtifacts: expect.arrayContaining(['control.png', 'experiment.png', 'diff.png']),
        }),
      },
    }]);
    expect(harness.calls.checkouts).toEqual(['bad', 'a', 'b']);
    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], tests: [] },
      {
        sha: 'a',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
      },
      {
        sha: 'b',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
      },
    ]);
    expect(session.commitRuns.a).toMatchObject({
      requestedTests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
    });
    expect((session as unknown as { primary: {
      status: string;
      attempts: Array<{ sha: string; status: string }>;
    } }).primary).toMatchObject({
      status: 'complete',
      attempts: [
        { sha: 'a', status: 'complete' },
        { sha: 'b', status: 'complete' },
      ],
    });
    expect(harness.calls.summaries.at(-1)?.status).toBe('complete');
    expect(harness.calls.reports.at(0)).toEqual({
      session: expect.objectContaining({ status: 'running' }),
      testNames: ['Homepage'],
    });
    expect(harness.calls.reports.at(-1)?.session.status).toBe('complete');
    expect(harness.calls.restored).toEqual(['bad']);
    expect(harness.calls.events.at(0)).toBe('lease:begin');
    expect(harness.calls.events.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
      'lease:end',
    ]);
    expect(harness.calls.progress).toEqual(expect.arrayContaining([
      'Starting compare bisect session',
      'Measuring bad ref bad to discover regression targets',
      'Selected Git candidate a for 1 active target(s)',
      'Selected Git candidate b for 1 active target(s)',
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
      tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
      targets: [expect.objectContaining({
        group: {
          id: 'primary-group-1',
          goodSha: 'a',
          badSha: 'bad',
        },
      })],
    });
  });

  it('resumes a complete primary session without acquiring a lease or comparing again', async () => {
    const bisectInput = input(rootDir);
    const initialHarness = deps({
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });
    const completed = await executeBisect(bisectInput, initialHarness.deps);
    const resumeHarness = deps({});

    const resumed = await executeBisect({
      ...bisectInput,
      resumeSession: parseBisectSession(completed),
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, resumeHarness.deps);

    expect(resumed.status).toBe('complete');
    expect(resumeHarness.calls.events).not.toContain('lease:begin');
    expect(resumeHarness.calls.checkouts).toEqual([]);
    expect(resumeHarness.calls.compares).toEqual([]);
  });

  it('marks an empty primary phase complete so resume requires no work', async () => {
    const bisectInput = input(rootDir);
    const initialHarness = deps({ bad: [resultWithVisualDiff(null)] });
    const completed = await executeBisect(bisectInput, initialHarness.deps);
    const resumeHarness = deps({});

    expect(completed).toMatchObject({
      status: 'complete',
      primary: { status: 'complete', targets: [], attempts: [] },
    });

    const resumed = await executeBisect({
      ...bisectInput,
      resumeSession: parseBisectSession(completed),
      resumeBadRefTests: [resultWithVisualDiff(null)],
    }, resumeHarness.deps);

    expect(resumed.primary?.status).toBe('complete');
    expect(resumeHarness.calls.events).not.toContain('lease:begin');
    expect(resumeHarness.calls.checkouts).toEqual([]);
    expect(resumeHarness.calls.compares).toEqual([]);
  });

  it('retries incomplete work through the normal reload path', async () => {
    const bisectInput = input(rootDir);
    const failedHarness = deps({ bad: [resultWithVisualDiff('diff.png')] }, {
      compareErrorBySha: { a: new Error('compare stopped') },
    });
    await expect(executeBisect(bisectInput, failedHarness.deps)).rejects.toThrow('compare stopped');
    const saved = parseBisectSession(failedHarness.calls.sessions.at(-1));
    const resumeHarness = deps({
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
    });

    const resumed = await executeBisect({
      ...bisectInput,
      resumeSession: saved,
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, resumeHarness.deps);

    expect(resumed.status).toBe('complete');
    expect(resumeHarness.calls.events[0]).toBe('lease:begin');
    expect(resumeHarness.calls.compares.map((run) => run.sha)).toEqual(['a', 'b']);
    expect(resumed.primary?.attempts.map(({ sha, status }) => ({ sha, status }))).toEqual([
      { sha: 'a', status: 'incomplete' },
      { sha: 'a', status: 'complete' },
      { sha: 'b', status: 'complete' },
    ]);
  });

  it('checkpoints the complete primary report before investigating a merge source', async () => {
    const bisectInput = input(rootDir);
    bisectInput.investigateMerges = true;
    bisectInput.gitRange.commitParents.b = ['a', 'topic'];
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      topic: [resultWithVisualDiff('diff.png')],
      source: [resultWithVisualDiff('diff.png')],
    });
    const order: string[] = [];
    const writeReport = harness.deps.artifacts.writeReport;
    harness.deps.artifacts.writeReport = (session, tests) => {
      if (session.primary?.status === 'complete') order.push('primary-report');
      writeReport(session, tests);
    };
    harness.deps.mergeRangeSource = {
      async load() {
        order.push('prepare-child');
        return {
          mergeBase: 'base',
          secondParent: 'topic',
          orderedCommits: ['base', 'source', 'topic'],
          commitSubjects: { base: 'base', source: 'source', topic: 'topic' },
          commitParents: { base: [], source: ['base'], topic: ['source'] },
        };
      },
    };

    const session = await executeBisect(bisectInput, harness.deps);

    expect(parseBisectSession(session).mergeInvestigations.b.status).toBe('complete');
    expect(order.indexOf('primary-report')).toBeLessThan(order.indexOf('prepare-child'));
    expect(session.mergeQueue).toEqual(['b']);
    expect(session.mergeInvestigations?.b.targetResults).toMatchObject({
      [session.primary.targets[0].id]: { kind: 'source-found', sourceSha: 'source' },
    });
    expect(harness.calls.compares.map((run) => run.sha)).toEqual([
      'bad', 'a', 'b', 'topic', 'source',
    ]);
  });

  it('does not write a report when bad-ref validation fails before target discovery', async () => {
    const harness = deps({
      bad: [resultWithVisualDiffAndError('diff.png')],
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toThrow(
      /bad.*visreg.*capture failed/i,
    );

    expect(harness.calls.reports).toEqual([]);
  });

  it('clears prior report output when bad-ref discovery fails', async () => {
    const bisectInput = input(rootDir);
    const priorReportPath = path.join(bisectInput.resultsDirectory, BISECT_REPORT_FILENAME);
    fs.mkdirSync(bisectInput.resultsDirectory, { recursive: true });
    fs.writeFileSync(priorReportPath, '<html>stale report</html>');
    const clearPriorReportOutput = jest.fn(() => {
      fs.rmSync(priorReportPath, { force: true });
    });
    const harness = deps({
      bad: [resultWithVisualDiffAndError('diff.png')],
    }, { clearPriorReportOutput });

    await expect(executeBisect(bisectInput, harness.deps)).rejects.toThrow(
      /bad.*visreg.*capture failed/i,
    );

    expect(clearPriorReportOutput).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(priorReportPath)).toBe(false);
  });

  it('resumes after a bad-ref report failure without repeating endpoint comparison', async () => {
    const bisectInput = input(rootDir);
    const failedHarness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      reportErrors: [new Error('report rendering failed')],
    });

    await expect(executeBisect(bisectInput, failedHarness.deps))
      .rejects.toThrow(/report rendering failed/i);
    const saved = parseBisectSession(failedHarness.calls.sessions.at(-1));
    expect(saved).toMatchObject({
      commitRuns: { bad: { compareCompleted: true } },
      primary: {
        targets: [expect.objectContaining({
          recordedTargetEvaluations: {
            bad: expect.objectContaining({ regressionDetected: true }),
          },
        })],
      },
    });

    const resumeHarness = deps({
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
    });
    const resumed = await executeBisect({
      ...bisectInput,
      resumeSession: saved,
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, resumeHarness.deps);

    expect(resumed.status).toBe('complete');
    expect(resumeHarness.calls.compares.map(({ sha }) => sha)).toEqual(['a', 'b']);
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

    expect(session.primary.targets).toMatchObject([{
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
      compareCompleted: true,
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

    expect(session.primary.targets).toMatchObject([{ status: 'found', firstBadSha: 'b' }]);
    expect(harness.calls.checkouts).toEqual(['good', 'a', 'b']);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['good', 'a', 'b']);
    expect(harness.calls.decisions.map((entry) => entry.event)).toContain('good-ref-validated');
    expect(harness.calls.decisions.find((entry) => entry.event === 'good-ref-start')?.data)
      .toMatchObject({
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
      });
  });

  it('reuses durable good-ref validation after report failure', async () => {
    const bisectInput = {
      ...input(rootDir),
      reuseCurrentResults: true,
      validateGoodRef: true,
    };
    const failedHarness = deps({
      good: [resultWithVisualDiff(null)],
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      reportErrors: [undefined, new Error('good-ref report failed')],
    });

    await expect(executeBisect(bisectInput, failedHarness.deps))
      .rejects.toThrow(/good-ref report failed/i);
    const saved = parseBisectSession(failedHarness.calls.sessions.at(-1));
    expect(saved.commitRuns.good).toMatchObject({ compareCompleted: true });
    expect(saved.primary.targets[0]?.recordedTargetEvaluations.good)
      .toMatchObject({ regressionDetected: false });

    const resumeHarness = deps({
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
    });
    const resumed = await executeBisect({
      ...bisectInput,
      reuseCurrentResults: false,
      resumeSession: saved,
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, resumeHarness.deps);

    expect(resumed.status).toBe('complete');
    expect(resumeHarness.calls.compares.map(({ sha }) => sha)).toEqual(['a', 'b']);
    expect(resumeHarness.calls.decisions.map(({ event }) => event))
      .toContain('good-ref-validation-reused');

    const failedRunHarness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
    });
    const sessionWithFailedGoodRun = {
      ...saved,
      commitRuns: {
        ...saved.commitRuns,
        good: {
          ...saved.commitRuns.good!,
          infrastructureError: 'stale good-ref analysis failure',
        },
      },
    };
    await executeBisect({
      ...bisectInput,
      reuseCurrentResults: false,
      resumeSession: sessionWithFailedGoodRun,
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, failedRunHarness.deps);

    expect(failedRunHarness.calls.compares.map(({ sha }) => sha)).toEqual(['good', 'a', 'b']);
    expect(failedRunHarness.calls.decisions.map(({ event }) => event))
      .not.toContain('good-ref-validation-reused');
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
      primary: {
        targets: [expect.objectContaining({
          status: 'active',
          category: 'visreg',
          subject: 'document',
        })],
      },
    });
    expect(harness.calls.summaryMetadata.at(-1)).toMatchObject({
      dryRun: true,
      nextAction: {
        kind: 'measure-candidate',
        sha: 'a',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
        targetIds: ['["visreg","tests/homepage.abtest.ts","Homepage","desktop","document"]'],
      },
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

  it('retries native reset during final cleanup when dry-run preview reset fails', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    }, {
      previewResetError: new Error('preview reset failed'),
    });

    await expect(executeBisect({
      ...input(rootDir),
      reuseCurrentResults: true,
      dryRun: true,
    }, harness.deps)).rejects.toThrow(/preview reset failed/i);

    expect(harness.calls.nativeResetAttempts).toBe(2);
    expect(harness.calls.sessions.at(-1)).toMatchObject({ status: 'failed' });
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
    });
    expect(harness.calls.summaryMetadata.at(-1)).toMatchObject({
      dryRun: true,
      nextAction: {
        kind: 'measure-candidate',
        sha: 'a',
      },
    });
    expect(harness.calls.checkouts).toEqual(['bad']);
    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], tests: [] },
    ]);
    expect(harness.calls.restored).toEqual(['bad']);
    expect(harness.calls.decisions.map((entry) => entry.event)).not.toContain('good-ref-start');
  });

  it('plans good-ref validation in dry-run mode only when requested', async () => {
    const harness = deps({
      bad: [resultWithVisualDiff('diff.png')],
    });

    await executeBisect({
      ...input(rootDir),
      reuseCurrentResults: true,
      dryRun: true,
      validateGoodRef: true,
    }, harness.deps);

    expect(harness.calls.summaryMetadata.at(-1)).toMatchObject({
      nextAction: {
        kind: 'validate-good-ref',
        sha: 'good',
        tests: [{ testFile: 'tests/homepage.abtest.ts', testName: 'Homepage' }],
      },
    });
  });

  it('marks targets invalid when regressions are already detected at the good ref', async () => {
    const harness = deps({
      good: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    const session = await executeBisect({
      ...input(rootDir),
      validateGoodRef: true,
    }, harness.deps);

    expect(session.status).toBe('complete');
    expect(session.primary.targets).toMatchObject([{
      status: 'invalid',
      invalidReason: 'regression is already detected at the good ref',
    }]);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'good']);
    expect(harness.calls.restored).toEqual(['bad']);
    expect(harness.calls.events.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
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

    expect(session.primary.targets).toMatchObject([{
      status: 'invalid',
      invalidReason: 'regression is already detected at the good ref',
      recordedTargetEvaluations: {
        bad: expect.objectContaining({ regressionDetected: true }),
        good: expect.objectContaining({ regressionDetected: true }),
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
    expect(harness.calls.restored).toEqual(['bad']);
    expect(harness.calls.events.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
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
    harness.deps.artifacts.clearPrevious = () => {
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

    expect(harness.calls.restored).toEqual(['bad']);
    expect(harness.calls.events.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
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
      primary: { targets: [{ status: 'active' }] },
    });
    expect(harness.calls.sessions.at(-1)?.primary.targets[0]?.recordedTargetEvaluations.a).toBeUndefined();
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'a']);
  });

  it('persists endpoint results and candidate classifications after comparison', async () => {
    const harness = deps({
      good: [resultWithVisualDiff(null)],
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    });

    await executeBisect(input(rootDir), harness.deps);

    expect(harness.calls.checkpoints.some((checkpoint) => (
      checkpoint.afterEvent === 'run-candidate-comparisons:bad'
      && checkpoint.session.commitRuns.bad?.compareCompleted === true
    ))).toBe(true);
    expect(harness.calls.checkpoints.some((checkpoint) => (
      checkpoint.afterEvent === 'checkout:bad'
      || checkpoint.afterEvent === 'reload-experiment:bad'
    ))).toBe(false);
    expect(harness.calls.checkpoints.some((checkpoint) => (
      checkpoint.afterEvent === 'run-candidate-comparisons:a'
      && checkpoint.session.primary.targets[0]?.recordedTargetEvaluations.a?.regressionDetected === false
    ))).toBe(true);
  });

  it('persists actual reload fallback metadata before a comparison failure', async () => {
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
      compareCompleted: false,
      experimentReloadMode: 'container',
      usedFallback: true,
      infrastructureError: 'compare exploded',
    });
    const beforeCompare = harness.calls.checkpoints.find((checkpoint) => (
      checkpoint.afterEvent === 'reload-experiment:a'
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
    expect(harness.calls.sessions.at(-1)?.primary.targets[0]?.recordedTargetEvaluations.a).toBeUndefined();
    expect(harness.calls.events.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
      'lease:end',
    ]);
    expect(harness.calls.signalHandlers.size).toBe(0);
    },
  );

  it('uses fresh cancellation state when the same services resume an interrupted run', async () => {
    const harnessOptions: HarnessOptions = { signalOnCompare: 'a', signal: 'SIGINT' };
    const harness = deps({
      a: [resultWithVisualDiff(null)],
      b: [resultWithVisualDiff('diff.png')],
      bad: [resultWithVisualDiff('diff.png')],
    }, harnessOptions);

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toBeInstanceOf(
      BisectInterruptedError,
    );
    const interrupted = parseBisectSession(harness.calls.sessions.at(-1));
    delete harnessOptions.signalOnCompare;

    const resumed = await executeBisect({
      ...input(rootDir),
      resumeSession: interrupted,
      resumeBadRefTests: [resultWithVisualDiff('diff.png')],
    }, harness.deps);

    expect(resumed.status).toBe('complete');
    expect(resumed.primary.attempts.map(({ sha, status }) => ({ sha, status }))).toEqual([
      { sha: 'a', status: 'incomplete' },
      { sha: 'a', status: 'complete' },
      { sha: 'b', status: 'complete' },
    ]);
    expect(harness.calls.signalHandlers.size).toBe(0);
  });

  it('persists interrupted endpoint metadata when endpoint restoration also fails', async () => {
    const harness = deps({ bad: [resultWithVisualDiff('diff.png')] }, {
      signalOnCompare: 'bad',
      signal: 'SIGINT',
      endpointRestoreError: new Error('endpoint restore failed'),
    });

    await expect(executeBisect(input(rootDir), harness.deps)).rejects.toMatchObject({
      name: 'AggregateError',
    });
    expect(harness.calls.sessions.at(-1)).toMatchObject({
      status: 'interrupted',
      commitRuns: { bad: { sha: 'bad', compareCompleted: true } },
    });
  });

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
    expect(harness.calls.summaryAfterEvents[0]?.slice(-3)).toEqual([
      'checkout:original',
      'reload-experiment:original',
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

    expect(session.primary.targets).toHaveLength(2);
    expect(harness.calls.compares.map((call) => call.sha)).toEqual(['bad', 'a', 'b']);
  });

  it('narrows later candidates to smaller test subsets as target intervals diverge', async () => {
    const account = (diffImage: string | null) => resultForTest(
      'tests/account.abtest.ts',
      'Account overview',
      diffImage,
    );
    const admin = (diffImage: string | null) => resultForTest(
      'tests/admin.abtest.ts',
      'Admin overview',
      diffImage,
    );
    const harness = deps({
      a: [account(null)],
      b: [account('account-diff.png'), admin(null)],
      c: [admin('admin-diff.png')],
      bad: [account('account-diff.png'), admin('admin-diff.png')],
    }, { nativeHistory: ['good', 'a', 'b', 'c', 'bad'] });

    const divergingInput = input(rootDir);
    divergingInput.gitRange = {
      ...divergingInput.gitRange,
      orderedCommits: ['good', 'a', 'b', 'c', 'bad'],
    };

    await executeBisect(divergingInput, harness.deps);

    expect(harness.calls.compares).toEqual([
      { sha: 'bad', categories: ['visreg'], tests: [] },
      {
        sha: 'b',
        categories: ['visreg'],
        tests: [
          { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
          { testFile: 'tests/admin.abtest.ts', testName: 'Admin overview' },
        ],
      },
      {
        sha: 'a',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/account.abtest.ts', testName: 'Account overview' }],
      },
      {
        sha: 'c',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/admin.abtest.ts', testName: 'Admin overview' }],
      },
    ]);
  });

  it('exposes the one-object runBisect contract', async () => {
    const harness = deps({ bad: [] });
    const bisectInput = input(rootDir);
    const inspectRepositories = jest.spyOn(bisectGit, 'inspectBisectRepositories')
      .mockResolvedValue({
        identity: {
          controlRoot: '/control',
          experimentRoot: '/experiment',
          controlGitCommonDir: '/control/.git',
          experimentGitCommonDir: '/experiment/.git',
          controlOrigin: null,
          experimentOrigin: null,
        },
        control: { branch: null, sha: 'good' },
        experiment: { branch: 'feature', sha: 'bad' },
      });

    try {
      await expect(runBisect({
        cwd: bisectInput.cwd,
        resultsDirectory: bisectInput.resultsDirectory,
        config: bisectInput.config,
        twinServers: {
          ...bisectInput.twinServers,
          controlDir: '/control',
          experimentDir: '/experiment',
        },
        selectedCategories: bisectInput.selectedCategories,
        frozenTests: bisectInput.frozenTests,
        headed: bisectInput.headed,
        controlURL: bisectInput.controlURL,
        experimentURL: bisectInput.experimentURL,
        gitRange: bisectInput.gitRange,
        dependencies: harness.deps,
      })).resolves.toMatchObject({ status: 'complete' });
    } finally {
      inspectRepositories.mockRestore();
    }
  });
});

describe('frozen bisect test selection', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-tests-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('matches normalized relative file path plus exact test name', () => {
    const tests = [
      frozenTest(rootDir, 'tests/account.abtest.ts', 'Overview'),
      frozenTest(rootDir, 'tests/account.abtest.ts', 'Settings'),
      frozenTest(rootDir, 'tests/admin.abtest.ts', 'Overview'),
    ];

    expect(filterFrozenTests(tests, rootDir, [
      { testFile: './tests/account.abtest.ts', testName: 'Settings' },
      { testFile: 'tests\\admin.abtest.ts', testName: 'Overview' },
    ])).toEqual([tests[1], tests[2]]);
  });

  it('returns all frozen tests for the empty bad-ref discovery selection', () => {
    const tests = [
      frozenTest(rootDir, 'tests/account.abtest.ts', 'Overview'),
      frozenTest(rootDir, 'tests/account.abtest.ts', 'Settings'),
    ];

    expect(filterFrozenTests(tests, rootDir, [])).toEqual(tests);
  });
});

describe('bisect decision log', () => {
  let resultsDirectory: string;

  beforeEach(() => {
    resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-decisions-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDirectory, { recursive: true, force: true });
  });

  it('appends resumed-run decisions instead of truncating prior history', () => {
    createFileBisectDecisionLogger(resultsDirectory).record({
      timestamp: '2026-07-12T00:00:00.000Z',
      event: 'session-start',
      message: 'Initial run',
    });
    createFileBisectDecisionLogger(resultsDirectory).record({
      timestamp: '2026-07-12T01:00:00.000Z',
      event: 'session-start',
      message: 'Resumed run',
    });

    const entries = fs.readFileSync(
      path.join(resultsDirectory, 'decision-log.jsonl'),
      'utf8',
    ).trim().split('\n').map((line) => JSON.parse(line) as BisectDecisionLogEntry);
    expect(entries.map(({ message }) => message)).toEqual(['Initial run', 'Resumed run']);
  });
});
