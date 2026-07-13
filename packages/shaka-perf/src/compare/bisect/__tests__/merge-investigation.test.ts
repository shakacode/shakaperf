/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildMergeQueue,
  runMergeInvestigations,
} from '../merge-investigation';
import type { CandidateResult } from '../run-candidate';
import type { BisectSession, BisectTarget, TargetObservation } from '../types';

function target(id: string, firstBadSha: string): BisectTarget {
  return {
    id,
    category: 'visreg',
    testFile: `tests/${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: 'document',
    status: 'found',
    goodIndex: 0,
    badIndex: 1,
    firstBadSha,
    observations: {},
  };
}

function session(parents: string[], targets = [target('one', 'merge')]): BisectSession {
  return {
    version: 2,
    status: 'running',
    goodSha: 'good',
    badSha: 'merge',
    originalExperiment: { branch: 'main', sha: 'merge' },
    commitSubjects: { good: 'good', merge: 'merge' },
    selectedCategories: ['visreg'],
    orderedCommits: ['good', 'merge'],
    targets,
    commitRuns: {},
    primary: {
      id: 'primary',
      status: 'complete',
      goodSha: 'good',
      badSha: 'merge',
      orderedCommits: ['good', 'merge'],
      commitSubjects: { good: 'good', merge: 'merge' },
      commitParents: { good: [], merge: parents },
      targets,
      attempts: [],
    },
    startedAt: '2026-07-13T00:00:00.000Z',
  };
}

function observation(targetId: string, sha: string, present: boolean): TargetObservation {
  return { targetId, commitSha: sha, present, values: {}, artifacts: [] };
}

function result(sha: string, observations: TargetObservation[]): CandidateResult {
  return {
    commitRun: {
      sha,
      compareCompleted: true,
      requestedCategories: ['visreg'],
      requestedTests: [],
      refreshMode: 'commands',
      usedFallback: false,
      startedAt: 'start',
      finishedAt: 'finish',
    },
    testResults: [],
    observations,
    refresh: { mode: 'commands', usedFallback: false },
  };
}

describe('merge investigation', () => {
  it('builds a stable primary merge queue and classifies octopus merges without work', async () => {
    const queued = buildMergeQueue(session(['main', 'topic-one', 'topic-two']));
    const measured: string[] = [];
    const completed = await runMergeInvestigations({
      session: queued,
      preferredRefreshMode: 'commands',
      now: () => 'now',
      nextAttemptId: () => 'attempt',
      checkpoint: () => undefined,
      async prepareRange() {
        throw new Error('must not prepare an octopus range');
      },
      async measure(work) {
        measured.push(work.sha);
        return result(work.sha, []);
      },
    });

    expect(queued.mergeQueue).toEqual(['merge']);
    expect(measured).toEqual([]);
    expect(completed.mergeInvestigations?.merge).toMatchObject({
      status: 'octopus-unsupported',
      targetResults: { one: { kind: 'octopus-unsupported' } },
    });
  });

  it('classifies merge-introduced, source commits, and nested source merges per target', async () => {
    const queued = buildMergeQueue(session(
      ['main', 'topic'],
      [target('introduced', 'merge'), target('source', 'merge'), target('nested', 'merge')],
    ));
    const measured: string[] = [];
    const completed = await runMergeInvestigations({
      session: queued,
      preferredRefreshMode: 'commands',
      now: () => 'now',
      nextAttemptId: (() => { let id = 0; return () => `attempt-${++id}`; })(),
      checkpoint: () => undefined,
      async prepareRange() {
        return {
          mergeBase: 'base',
          secondParent: 'topic',
          orderedCommits: ['base', 'source-commit', 'nested-merge', 'topic'],
          commitSubjects: {
            base: 'base', 'source-commit': 'source', 'nested-merge': 'nested', topic: 'topic',
          },
          commitParents: {
            base: [],
            'source-commit': ['base'],
            'nested-merge': ['source-commit', 'nested-topic'],
            topic: ['nested-merge'],
          },
        };
      },
      async measure(work) {
        measured.push(work.sha);
        if (work.sha === 'topic') return result('topic', [
          observation('introduced', 'topic', false),
          observation('source', 'topic', true),
          observation('nested', 'topic', true),
        ]);
        if (work.sha === 'source-commit') return result(work.sha, [
          observation('source', work.sha, true),
          observation('nested', work.sha, false),
        ]);
        return result(work.sha, [observation('nested', work.sha, true)]);
      },
    });

    expect(measured).toEqual(['topic', 'source-commit', 'nested-merge']);
    expect(completed.mergeInvestigations?.merge).toMatchObject({
      status: 'complete',
      targetResults: {
        introduced: { kind: 'merge-introduced' },
        source: { kind: 'source-found', sourceSha: 'source-commit' },
        nested: { kind: 'nested-merge', sourceSha: 'nested-merge' },
      },
    });
  });

  it('retries an incomplete second-parent validation before narrowing the child range', async () => {
    let checkpoint = buildMergeQueue(session(['main', 'topic']));
    const common = {
      preferredRefreshMode: 'commands' as const,
      now: () => 'now',
      nextAttemptId: (() => { let id = 0; return () => `attempt-${++id}`; })(),
      checkpoint(value: BisectSession) { checkpoint = value; },
      async prepareRange() {
        return {
          mergeBase: 'base',
          secondParent: 'topic',
          orderedCommits: ['base', 'source', 'topic'],
          commitSubjects: { base: 'base', source: 'source', topic: 'topic' },
          commitParents: { base: [], source: ['base'], topic: ['source'] },
        };
      },
    };
    await expect(runMergeInvestigations({
      ...common,
      session: checkpoint,
      async measure() { throw new Error('validation stopped'); },
    })).rejects.toThrow('validation stopped');

    const measured: string[] = [];
    const completed = await runMergeInvestigations({
      ...common,
      session: checkpoint,
      async measure(work) {
        measured.push(work.sha);
        return result(work.sha, [observation('one', work.sha, true)]);
      },
    });

    expect(measured).toEqual(['topic', 'source']);
    expect(completed.mergeInvestigations?.merge.targetResults.one)
      .toEqual({ kind: 'source-found', sourceSha: 'source' });
  });
});
