/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { runCheckpointedAttempt } from '../attempt';
import type { CandidateResult } from '../run-candidate';
import type { CandidateMeasurementPlan } from '../search';
import type { CommitAttempt } from '../types';

const work: CandidateMeasurementPlan = {
  sha: 'candidate',
  targetIds: ['target'],
  categories: ['visreg'],
  tests: [{ testFile: 'tests/home.abtest.ts', testName: 'Homepage' }],
};

function result(): CandidateResult {
  return {
    commitRun: {
      sha: work.sha,
      compareCompleted: true,
      requestedCategories: [...work.categories],
      requestedTests: [...work.tests],
      experimentReloadMode: 'container',
      usedFallback: true,
      compareResultsPath: '/results/candidate',
      startedAt: 'run-started',
      finishedAt: 'run-finished',
    },
    testResults: [],
    targetEvaluations: [],
    experimentReload: { mode: 'container', usedFallback: true },
  };
}

describe('runCheckpointedAttempt', () => {
  it('owns the running-to-complete checkpoint lifecycle', async () => {
    const events: string[] = [];
    let checkpointStatus = '';
    let completedAttempts: CommitAttempt[] = [];
    const candidateResult = result();

    await expect(runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: () => 'attempt-started',
      checkpointRunning(attempts) {
        checkpointStatus = attempts.at(-1)!.status;
        events.push(`checkpoint:${checkpointStatus}`);
      },
      checkpointComplete(attempts, received) {
        expect(received).toBe(candidateResult);
        completedAttempts = attempts;
        checkpointStatus = attempts.at(-1)!.status;
        events.push(`checkpoint:${checkpointStatus}`);
      },
      checkpointIncomplete() {
        throw new Error('must not checkpoint incomplete');
      },
      afterCheckpoint() {
        events.push(`after:${checkpointStatus}`);
      },
      async measure() {
        events.push('measure');
        return candidateResult;
      },
    })).resolves.toBe(candidateResult);

    expect(events).toEqual([
      'checkpoint:running',
      'after:running',
      'measure',
      'checkpoint:complete',
      'after:complete',
    ]);
    expect(completedAttempts).toEqual([{
      id: 'attempt-1',
      sha: 'candidate',
      status: 'complete',
      requestedCategories: ['visreg'],
      requestedTests: [{ testFile: 'tests/home.abtest.ts', testName: 'Homepage' }],
      experimentReloadMode: 'container',
      usedFallback: true,
      startedAt: 'attempt-started',
      finishedAt: 'run-finished',
      compareResultsPath: '/results/candidate',
    }]);
  });

  it('checkpoints an incomplete attempt when measurement fails', async () => {
    const checkpoints: CommitAttempt[][] = [];
    const afterStatuses: string[] = [];

    await expect(runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: (() => {
        const values = ['attempt-started', 'attempt-finished'];
        return () => values.shift()!;
      })(),
      checkpointRunning(attempts) { checkpoints.push(attempts); },
      checkpointComplete() { throw new Error('must not checkpoint complete'); },
      checkpointIncomplete(attempts) { checkpoints.push(attempts); },
      afterCheckpoint() { afterStatuses.push(checkpoints.at(-1)!.at(-1)!.status); },
      async measure() { throw new Error('compare failed'); },
    })).rejects.toThrow('compare failed');

    expect(checkpoints.map((attempts) => attempts.at(-1))).toMatchObject([
      { status: 'running' },
      { status: 'incomplete', finishedAt: 'attempt-finished', error: 'compare failed' },
    ]);
    expect(afterStatuses).toEqual(['running', 'incomplete']);
  });

  it('turns a completed-checkpoint failure into an incomplete attempt', async () => {
    const statuses: string[] = [];
    const afterStatuses: string[] = [];
    let incompleteAttempt: CommitAttempt | undefined;

    await expect(runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: () => 'now',
      checkpointRunning(attempts) { statuses.push(attempts.at(-1)!.status); },
      checkpointComplete() { throw new Error('session checkpoint failed'); },
      checkpointIncomplete(attempts) {
        incompleteAttempt = attempts.at(-1);
        statuses.push(incompleteAttempt!.status);
      },
      afterCheckpoint() { afterStatuses.push(statuses.at(-1)!); },
      async measure() { return result(); },
    })).rejects.toThrow('session checkpoint failed');

    expect(statuses).toEqual(['running', 'incomplete']);
    expect(incompleteAttempt).toMatchObject({
      status: 'incomplete',
      error: 'session checkpoint failed',
    });
    expect(afterStatuses).toEqual(['running', 'incomplete']);
  });

  it('does not measure or rewrite the attempt when running afterCheckpoint fails', async () => {
    const statuses: string[] = [];
    let measured = false;

    await expect(runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: () => 'now',
      checkpointRunning(attempts) { statuses.push(attempts.at(-1)!.status); },
      checkpointComplete(attempts) { statuses.push(attempts.at(-1)!.status); },
      checkpointIncomplete(attempts) { statuses.push(attempts.at(-1)!.status); },
      afterCheckpoint() { throw new Error('running report failed'); },
      async measure() {
        measured = true;
        return result();
      },
    })).rejects.toThrow('running report failed');

    expect(measured).toBe(false);
    expect(statuses).toEqual(['running']);
  });

  it('uses now when the candidate run has no finished timestamp', async () => {
    const candidateResult = result();
    delete candidateResult.commitRun.finishedAt;
    let completedAttempt: CommitAttempt | undefined;

    await runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: (() => {
        const values = ['attempt-started', 'attempt-finished'];
        return () => values.shift()!;
      })(),
      checkpointRunning: () => undefined,
      checkpointComplete(attempts) { completedAttempt = attempts.at(-1); },
      checkpointIncomplete: () => undefined,
      async measure() { return candidateResult; },
    });

    expect(completedAttempt?.finishedAt).toBe('attempt-finished');
  });

  it('keeps a completed attempt durable when afterCheckpoint fails', async () => {
    const statuses: string[] = [];
    let afterCalls = 0;

    await expect(runCheckpointedAttempt({
      attempts: [],
      work,
      preferredExperimentReloadMode: 'commands',
      nextAttemptId: () => 'attempt-1',
      now: () => 'now',
      checkpointRunning(attempts) { statuses.push(attempts.at(-1)!.status); },
      checkpointComplete(attempts) { statuses.push(attempts.at(-1)!.status); },
      checkpointIncomplete(attempts) { statuses.push(attempts.at(-1)!.status); },
      afterCheckpoint() {
        afterCalls++;
        if (afterCalls === 2) throw new Error('report rendering failed');
      },
      async measure() { return result(); },
    })).rejects.toThrow('report rendering failed');

    expect(statuses).toEqual(['running', 'complete']);
  });
});
