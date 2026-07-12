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
import { executeBisect, type ExecuteBisectDependencies, type ExecuteBisectInput } from '../session';
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

function deps(resultsBySha: Record<string, readonly TestResult[]>): {
  deps: ExecuteBisectDependencies;
  calls: {
    checkouts: string[];
    materialized: Array<[string | null, string]>;
    refreshes: string[];
    compares: Array<{ sha: string; categories: string[]; testFiles: string[] }>;
    sessions: BisectSession[];
    summaries: BisectSession[];
    restored: Array<[string | null, string]>;
    events: string[];
  };
} {
  const calls = {
    checkouts: [] as string[],
    materialized: [] as Array<[string | null, string]>,
    refreshes: [] as string[],
    compares: [] as Array<{ sha: string; categories: string[]; testFiles: string[] }>,
    sessions: [] as BisectSession[],
    summaries: [] as BisectSession[],
    restored: [] as Array<[string | null, string]>,
    events: [] as string[],
  };
  return {
    calls,
    deps: {
      async beginSession() {
        calls.events.push('lease:begin');
      },
      async endSession() {
        calls.events.push('lease:end');
      },
      async checkout(sha) {
        calls.checkouts.push(sha);
        calls.events.push(`checkout:${sha}`);
      },
      async restore(request) {
        calls.restored.push([request.previousSha, request.originalSha]);
        calls.events.push('restore:original');
      },
      async materialize(request) {
        calls.materialized.push([request.previousSha, request.candidateSha]);
        calls.events.push(`materialize:${request.candidateSha}`);
      },
      async refresh(request) {
        calls.refreshes.push(request.sha);
        calls.events.push(`refresh:${request.sha}`);
        return { mode: request.preferredMode, usedFallback: false };
      },
      async compare(request) {
        calls.events.push(`compare:${request.sha}`);
        calls.compares.push({
          sha: request.sha,
          categories: [...request.categories],
          testFiles: [...request.testFiles],
        });
        return {
          testResults: resultsBySha[request.sha] ?? [],
          compareResultsPath: `/repo/compare-bisect-results/commits/${request.sha}/compare-results`,
        };
      },
      writeSession(session) {
        calls.sessions.push(JSON.parse(JSON.stringify(session)) as BisectSession);
      },
      writeSummary(session) {
        calls.summaries.push(JSON.parse(JSON.stringify(session)) as BisectSession);
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
    expect(harness.calls.events.slice(-2)).toEqual(['restore:original', 'lease:end']);
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
    expect(harness.calls.events.slice(-2)).toEqual(['restore:original', 'lease:end']);
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
    expect(harness.calls.events.slice(-2)).toEqual(['restore:original', 'lease:end']);
  });
});
