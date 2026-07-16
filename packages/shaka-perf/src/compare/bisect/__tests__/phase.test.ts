/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { runSearchPhase } from '../phase';
import type { CandidateResult } from '../run-candidate';
import type {
  BisectSearchPhase,
  BisectTarget,
  TargetObservation,
} from '../types';

function target(
  id: string,
  category: BisectTarget['category'],
  testFile: string,
  testName: string,
): BisectTarget {
  return {
    id,
    category,
    testFile,
    testName,
    viewport: 'desktop',
    subject: id,
    status: 'active',
    goodIndex: 0,
    badIndex: 4,
    observations: {},
  };
}

function phase(): BisectSearchPhase {
  return {
    id: 'primary',
    status: 'pending',
    goodSha: 'good',
    badSha: 'bad',
    orderedCommits: ['good', 'a', 'b', 'c', 'bad'],
    commitSubjects: { good: 'good', a: 'a', b: 'b', c: 'c', bad: 'bad' },
    commitParents: {
      good: [], a: ['good'], b: ['a'], c: ['b'], bad: ['c'],
    },
    targets: [
      target('visual', 'visreg', 'tests/home.abtest.ts', 'Homepage'),
      target('perf', 'perf', 'tests/product.abtest.ts', 'Product'),
    ],
    attempts: [],
  };
}

function observation(
  targetId: string,
  commitSha: string,
  present: boolean,
): TargetObservation {
  return { targetId, commitSha, present, values: {}, artifacts: [] };
}

function result(
  sha: string,
  observations: TargetObservation[],
): CandidateResult {
  return {
    commitRun: {
      sha,
      compareCompleted: true,
      requestedCategories: [],
      requestedTests: [],
      refreshMode: 'commands',
      usedFallback: false,
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:00:01.000Z',
    },
    testResults: [],
    observations,
    refresh: { mode: 'commands', usedFallback: false },
  };
}

describe('runSearchPhase', () => {
  it('shares candidate work while preserving independent target intervals', async () => {
    const measured: Array<{
      sha: string;
      categories: string[];
      tests: Array<{ testFile: string; testName: string }>;
    }> = [];
    const completed = await runSearchPhase({
      phase: phase(),
      preferredRefreshMode: 'commands',
      nextAttemptId: (() => {
        let id = 0;
        return () => `attempt-${++id}`;
      })(),
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint: () => undefined,
      async measure(work) {
        measured.push({
          sha: work.sha,
          categories: [...work.categories],
          tests: [...work.tests],
        });
        if (work.sha === 'b') {
          return result('b', [
            observation('visual', 'b', true),
            observation('perf', 'b', false),
          ]);
        }
        if (work.sha === 'a') return result('a', [observation('visual', 'a', false)]);
        return result('c', [observation('perf', 'c', true)]);
      },
    });

    expect(measured).toEqual([
      {
        sha: 'b',
        categories: ['visreg', 'perf'],
        tests: [
          { testFile: 'tests/home.abtest.ts', testName: 'Homepage' },
          { testFile: 'tests/product.abtest.ts', testName: 'Product' },
        ],
      },
      {
        sha: 'a',
        categories: ['visreg'],
        tests: [{ testFile: 'tests/home.abtest.ts', testName: 'Homepage' }],
      },
      {
        sha: 'c',
        categories: ['perf'],
        tests: [{ testFile: 'tests/product.abtest.ts', testName: 'Product' }],
      },
    ]);
    expect(completed.status).toBe('complete');
    expect(completed.targets).toMatchObject([
      { id: 'visual', firstBadSha: 'b', status: 'found' },
      { id: 'perf', firstBadSha: 'c', status: 'found' },
    ]);
    expect(completed.attempts).toHaveLength(3);
    expect(completed.attempts.every((attempt) => attempt.status === 'complete')).toBe(true);
  });

  it('checkpoints incomplete work without advancing bounds and retries it', async () => {
    const initial = phase();
    initial.targets = [initial.targets[0]];
    let checkpoint = initial;
    let calls = 0;
    const options = {
      preferredRefreshMode: 'commands' as const,
      nextAttemptId: () => `attempt-${calls + 1}`,
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint(value: BisectSearchPhase) {
        checkpoint = value;
      },
      async measure(work: { sha: string }) {
        calls++;
        if (calls === 1) throw new Error('compare failed');
        return result(work.sha, [observation('visual', work.sha, true)]);
      },
    };

    await expect(runSearchPhase({ ...options, phase: initial })).rejects.toThrow('compare failed');

    expect(checkpoint.targets[0]).toMatchObject({ goodIndex: 0, badIndex: 4 });
    expect(checkpoint.targets[0].observations.b).toBeUndefined();
    expect(checkpoint.attempts).toMatchObject([{
      sha: 'b',
      status: 'incomplete',
      error: 'compare failed',
    }]);

    const completed = await runSearchPhase({ ...options, phase: checkpoint });

    expect(calls).toBe(3);
    expect(completed.attempts.map(({ sha, status }) => ({ sha, status }))).toEqual([
      { sha: 'b', status: 'incomplete' },
      { sha: 'b', status: 'complete' },
      { sha: 'a', status: 'complete' },
    ]);
  });

  it('does not advance bounds when the completed checkpoint fails', async () => {
    const initial = phase();
    initial.targets = [initial.targets[0]];
    let persisted = initial;
    let failCompletedCheckpoint = true;
    const measured: string[] = [];
    let attemptId = 0;
    const common = {
      preferredRefreshMode: 'commands' as const,
      nextAttemptId: () => `attempt-${++attemptId}`,
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint(value: BisectSearchPhase) {
        if (failCompletedCheckpoint
          && value.attempts.some((attempt) => attempt.status === 'complete')) {
          failCompletedCheckpoint = false;
          throw new Error('session checkpoint failed');
        }
        persisted = value;
      },
      async measure(work: { sha: string }) {
        measured.push(work.sha);
        return result(work.sha, [observation('visual', work.sha, true)]);
      },
    };

    await expect(runSearchPhase({ ...common, phase: initial }))
      .rejects.toThrow('session checkpoint failed');

    expect(persisted.targets[0]).toMatchObject({ goodIndex: 0, badIndex: 4 });
    expect(persisted.targets[0].observations.b).toBeUndefined();
    expect(persisted.attempts).toMatchObject([{ sha: 'b', status: 'incomplete' }]);

    await runSearchPhase({ ...common, phase: persisted });

    expect(measured.slice(0, 2)).toEqual(['b', 'b']);
  });

  it('keeps a durable completed attempt when report rendering fails afterward', async () => {
    const initial = phase();
    initial.targets = [initial.targets[0]];
    let persisted = initial;

    await expect(runSearchPhase({
      phase: initial,
      preferredRefreshMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint(value) {
        persisted = value;
      },
      afterCheckpoint(value) {
        if (value.attempts.some((attempt) => attempt.status === 'complete')) {
          throw new Error('report rendering failed');
        }
      },
      async measure(work) {
        return result(work.sha, [observation('visual', work.sha, true)]);
      },
    })).rejects.toThrow('report rendering failed');

    expect(persisted.targets[0]).toMatchObject({ goodIndex: 0, badIndex: 2 });
    expect(persisted.targets[0].observations.b).toMatchObject({ present: true });
    expect(persisted.attempts).toMatchObject([{ sha: 'b', status: 'complete' }]);
  });
});
