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
    status: 'running',
    mode: 'primary',
    identity: {
      controlRoot: '/repo/control', experimentRoot: '/repo/experiment',
      controlGitCommonDir: '/repo/control/.git', experimentGitCommonDir: '/repo/experiment/.git',
      controlOrigin: null, experimentOrigin: null,
    },
    compatibility: {
      configFingerprint: 'config', categoriesFingerprint: 'categories',
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        range: { goodSha: 'good', badSha: 'merge' },
      },
    },
    originalExperiment: { branch: 'main', sha: 'merge' },
    control: { branch: null, sha: 'good' },
    rebuildStrategy: { mode: 'commands', commands: [] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
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
    mergeQueue: [],
    mergeInvestigations: {},
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
      commitRuns: () => ({}),
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
      commitRuns: () => ({}),
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
      commitRuns: () => ({}),
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

  it('records child-range preparation failures without discarding the primary result', async () => {
    const queued = buildMergeQueue(session(['main', 'topic']));
    let checkpoint = queued;
    let measured = false;

    const completed = await runMergeInvestigations({
      session: queued,
      preferredRefreshMode: 'commands',
      commitRuns: () => ({}),
      now: () => 'now',
      nextAttemptId: () => 'attempt',
      checkpoint(value) { checkpoint = value; },
      async prepareRange() {
        throw new Error('second parent is not reachable from merge base');
      },
      async measure() {
        measured = true;
        return result('topic', []);
      },
    });

    expect(measured).toBe(false);
    expect(completed.primary?.status).toBe('complete');
    expect(completed.mergeInvestigations?.merge).toMatchObject({
      status: 'failed',
      failure: 'second parent is not reachable from merge base',
      targetResults: { one: { kind: 'merge-uninvestigated' } },
    });
    expect(checkpoint).toEqual(completed);
  });

  it('retries second-parent validation when its completed checkpoint fails', async () => {
    let persisted = buildMergeQueue(session(['main', 'topic']));
    let failCompletedCheckpoint = true;
    let attemptId = 0;
    const measured: string[] = [];
    const common = {
      preferredRefreshMode: 'commands' as const,
      commitRuns: () => ({}),
      now: () => 'now',
      nextAttemptId: () => `attempt-${++attemptId}`,
      checkpoint(value: BisectSession) {
        persisted = value;
        const completedValidation = value.mergeInvestigations?.merge.phase?.attempts.some(
          (attempt) => attempt.sha === 'topic' && attempt.status === 'complete',
        );
        if (failCompletedCheckpoint && completedValidation) {
          failCompletedCheckpoint = false;
          throw new Error('session checkpoint failed');
        }
      },
      async prepareRange() {
        return {
          mergeBase: 'base',
          secondParent: 'topic',
          orderedCommits: ['base', 'source', 'topic'],
          commitSubjects: { base: 'base', source: 'source', topic: 'topic' },
          commitParents: { base: [], source: ['base'], topic: ['source'] },
        };
      },
      async measure(work: { sha: string }) {
        measured.push(work.sha);
        return result(work.sha, [observation('one', work.sha, true)]);
      },
    };

    await expect(runMergeInvestigations({ ...common, session: persisted }))
      .rejects.toThrow('session checkpoint failed');

    expect(persisted.mergeInvestigations?.merge).toMatchObject({
      targetResults: { one: { kind: 'merge-uninvestigated' } },
      phase: {
        targets: [{ id: 'one', status: 'found', firstBadSha: 'merge' }],
        attempts: [{ sha: 'topic', status: 'incomplete' }],
      },
    });

    await runMergeInvestigations({ ...common, session: persisted });

    expect(measured.slice(0, 2)).toEqual(['topic', 'topic']);
  });

  it('clears a stale range-preparation failure after a successful retry', async () => {
    const failed = buildMergeQueue(session(['main', 'topic']));
    failed.mergeInvestigations!.merge = {
      ...failed.mergeInvestigations!.merge,
      status: 'failed',
      failure: 'old topology failure',
    };

    const completed = await runMergeInvestigations({
      session: failed,
      preferredRefreshMode: 'commands',
      commitRuns: () => ({}),
      now: () => 'now',
      nextAttemptId: (() => { let id = 0; return () => `attempt-${++id}`; })(),
      checkpoint: () => undefined,
      async prepareRange() {
        return {
          mergeBase: 'base',
          secondParent: 'topic',
          orderedCommits: ['base', 'source', 'topic'],
          commitSubjects: { base: 'base', source: 'source', topic: 'topic' },
          commitParents: { base: [], source: ['base'], topic: ['source'] },
        };
      },
      async measure(work) {
        return result(work.sha, [observation('one', work.sha, true)]);
      },
    });

    expect(completed.mergeInvestigations?.merge).toMatchObject({ status: 'complete' });
    expect(completed.mergeInvestigations?.merge.failure).toBeUndefined();
  });
});
