/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { runNativeSearchPhase } from '../phase';
import type { CandidateResult } from '../run-candidate';
import type {
  BisectSearchPhase,
  BisectTarget,
  TargetEvaluationAtCommit,
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
    recordedTargetEvaluations: {},
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
    commitParents: { good: [], a: ['good'], b: ['a'], c: ['b'], bad: ['c'] },
    targets: [
      target('visual', 'visreg', 'tests/home.abtest.ts', 'Homepage'),
      target('perf', 'perf', 'tests/product.abtest.ts', 'Product'),
    ],
    attempts: [],
  };
}

function evaluation(
  targetId: string,
  commitSha: string,
  regressionDetected: boolean,
): TargetEvaluationAtCommit {
  return { targetId, commitSha, regressionDetected, evidence: {}, evidenceArtifacts: [] };
}

function result(
  sha: string,
  targetEvaluations: TargetEvaluationAtCommit[],
): CandidateResult {
  return {
    commitRun: {
      sha,
      compareCompleted: true,
      requestedCategories: [],
      requestedTests: [],
      experimentReloadMode: 'commands',
      usedFallback: false,
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:00:01.000Z',
    },
    testResults: [],
    targetEvaluations,
    experimentReload: { mode: 'commands', usedFallback: false },
  };
}

describe('runNativeSearchPhase', () => {
  it('keeps the largest partition active and schedules the divergent group later', async () => {
    const starts: Array<{ goodSha: string; badSha: string; targetIds: string[] }> = [];
    const resets: number[] = [];
    const measured: string[] = [];
    let active = '';
    const completed = await runNativeSearchPhase({
      phase: phase(),
      preferredExperimentReloadMode: 'commands',
      commitRuns: () => ({}),
      nextAttemptId: (() => {
        let id = 0;
        return () => `attempt-${++id}`;
      })(),
      nextGroupId: (() => {
        let id = 1;
        return () => `primary-group-${++id}`;
      })(),
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint: () => undefined,
      nativeBisect: {
        async start(group) {
          starts.push({
            goodSha: group.goodSha,
            badSha: group.badSha,
            targetIds: [...group.targetIds],
          });
          active = group.targetIds.includes('visual') ? 'visual' : 'perf';
          return {
            candidateSha: active === 'visual' ? 'b' : 'c',
            firstBadSha: null,
            complete: false,
            output: '',
          };
        },
        async mark(verdict) {
          if (active === 'visual' && verdict === 'bad') {
            return { candidateSha: 'a', firstBadSha: null, complete: false, output: '' };
          }
          return {
            candidateSha: null,
            firstBadSha: active === 'visual' ? 'b' : 'c',
            complete: true,
            output: '',
          };
        },
        async reset() {
          resets.push(1);
        },
      },
      async measure(work) {
        measured.push(work.sha);
        if (work.sha === 'b') {
          return result('b', [
            evaluation('visual', 'b', true),
            evaluation('perf', 'b', false),
          ]);
        }
        if (work.sha === 'a') return result('a', [evaluation('visual', 'a', false)]);
        return result('c', [evaluation('perf', 'c', true)]);
      },
    });

    expect(measured).toEqual(['b', 'a', 'c']);
    expect(starts).toEqual([
      { goodSha: 'good', badSha: 'bad', targetIds: ['visual', 'perf'] },
      { goodSha: 'b', badSha: 'bad', targetIds: ['perf'] },
    ]);
    expect(resets).toHaveLength(2);
    expect(completed.targets).toMatchObject([
      { id: 'visual', status: 'found', firstBadSha: 'b' },
      { id: 'perf', status: 'found', firstBadSha: 'c' },
    ]);
    expect(completed.groups).toHaveLength(2);
    expect(completed.groups?.every((group) => group.status === 'complete')).toBe(true);
  });

  it('checkpoints an incomplete attempt and resets native Git after measurement failure', async () => {
    let checkpoint = phase();
    let resets = 0;

    await expect(runNativeSearchPhase({
      phase: phase(),
      preferredExperimentReloadMode: 'commands',
      commitRuns: () => ({}),
      nextAttemptId: () => 'attempt-1',
      nextGroupId: () => 'group-2',
      now: () => '2026-07-13T00:00:00.000Z',
      checkpoint(value) {
        checkpoint = value;
      },
      nativeBisect: {
        async start() {
          return { candidateSha: 'b', firstBadSha: null, complete: false, output: '' };
        },
        async mark() {
          throw new Error('mark should not run');
        },
        async reset() {
          resets++;
        },
      },
      async measure() {
        throw new Error('compare failed');
      },
    })).rejects.toThrow('compare failed');

    expect(checkpoint.attempts).toMatchObject([{ sha: 'b', status: 'incomplete' }]);
    expect(checkpoint.groups).toMatchObject([{ goodSha: 'good', badSha: 'bad' }]);
    expect(resets).toBe(1);
  });
});
