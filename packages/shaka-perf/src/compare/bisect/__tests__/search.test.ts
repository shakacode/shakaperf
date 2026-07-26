/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  candidatePlanForGroup,
  coalesceTargetGroups,
  createInitialTargetGroup,
  narrowTargetSearchRangesUsingRecordedEvaluations,
  recordTargetEvaluationsAndNarrowSearchRanges,
  nextCandidate,
  partitionTargetGroup,
  type BisectSearchInput,
} from '../search';
import type {
  BisectCategory,
  BisectTarget,
  TargetEvaluationAtCommit,
} from '../types';

const orderedCommits = ['g', 'a', 'b', 'c', 'bad'];

function evaluation(targetId: string, regressionDetected: boolean, commitSha = 'b'): TargetEvaluationAtCommit {
  return {
    targetId,
    commitSha,
    regressionDetected,
    evidence: {},
    evidenceArtifacts: [],
  };
}

function bisectTarget(
  id: string,
  category: BisectCategory,
  options: Partial<BisectTarget> = {},
): BisectTarget {
  return {
    id,
    category,
    testFile: `${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: id,
    status: 'active',
    goodIndex: 0,
    badIndex: 4,
    recordedTargetEvaluations: {},
    ...options,
  };
}

function session(targets: BisectTarget[]): BisectSearchInput {
  return {
    orderedCommits,
    targets,
    commitRuns: {},
  };
}

function target(value: BisectSearchInput, id: string): BisectTarget {
  return value.targets.find((item) => item.id === id)!;
}

describe('bisect scheduler', () => {
  it('rejects a degenerate active interval instead of scheduling empty work', () => {
    const searchStateWithCurrentBoundaries = narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 0,
        badIndex: 0,
        recordedTargetEvaluations: { g: evaluation('visual', true, 'g') },
      }),
    ]));

    expect(() => nextCandidate(searchStateWithCurrentBoundaries)).toThrow(/invalid bisect interval/i);
  });

  it('rejects a candidate with no active targets requiring evaluation', () => {
    const searchStateWithCurrentBoundaries = narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg'),
    ]));
    searchStateWithCurrentBoundaries.targets[0].recordedTargetEvaluations.b = evaluation('visual', true, 'b');

    expect(() => nextCandidate(searchStateWithCurrentBoundaries)).toThrow(/no active targets requiring evaluation/i);
  });

  it('updates divergent target intervals independently', () => {
    const updated = recordTargetEvaluationsAndNarrowSearchRanges(session([
      bisectTarget('visual', 'visreg'),
      bisectTarget('tbt', 'perf'),
      bisectTarget('button-name', 'accessibility'),
    ]), 'b', new Map([
      ['visual', evaluation('visual', true)],
      ['tbt', evaluation('tbt', false)],
    ]));

    expect(target(updated, 'visual').badIndex).toBe(2);
    expect(target(updated, 'tbt').goodIndex).toBe(2);
  });

  it('selects the first target by category priority and stable id', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('zebra', 'visreg', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('alpha', 'visreg', { goodIndex: 0, badIndex: 2 }),
      bisectTarget('tbt', 'perf'),
      bisectTarget('button-name', 'accessibility'),
    ])));

    expect(work?.sha).toBe('a');
    expect(work?.targetIds).toEqual(['zebra', 'alpha', 'tbt', 'button-name']);
    expect(work?.categories).toEqual(['visreg', 'perf', 'accessibility']);
    expect(work?.tests).toEqual([
      { testFile: 'zebra.abtest.ts', testName: 'zebra' },
      { testFile: 'alpha.abtest.ts', testName: 'alpha' },
      { testFile: 'tbt.abtest.ts', testName: 'tbt' },
      { testFile: 'button-name.abtest.ts', testName: 'button-name' },
    ]);
  });

  it('selects only the active test from a file containing multiple tests', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('account-overview', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Account overview',
      }),
      bisectTarget('account-settings', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Account settings',
        status: 'invalid',
        invalidReason: 'Present at known-good commit',
      }),
    ])));

    expect(work?.tests).toEqual([
      { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
    ]);
  });

  it('selects multiple active tests from the same file once each', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('account-overview-document', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Account overview',
        subject: 'document',
      }),
      bisectTarget('account-overview-header', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Account overview',
        subject: 'header',
      }),
      bisectTarget('account-settings', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Account settings',
      }),
    ])));

    expect(work?.tests).toEqual([
      { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
      { testFile: 'tests/account.abtest.ts', testName: 'Account settings' },
    ]);
  });

  it('keeps identical test names in different files distinct', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('account-overview', 'visreg', {
        testFile: 'tests/account.abtest.ts',
        testName: 'Overview',
      }),
      bisectTarget('admin-overview', 'visreg', {
        testFile: 'tests/admin.abtest.ts',
        testName: 'Overview',
      }),
    ])));

    expect(work?.tests).toEqual([
      { testFile: 'tests/account.abtest.ts', testName: 'Overview' },
      { testFile: 'tests/admin.abtest.ts', testName: 'Overview' },
    ]);
  });

  it('groups every active target whose interval contains the candidate', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg', { goodIndex: 0, badIndex: 4 }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('button-name', 'accessibility', { goodIndex: 2, badIndex: 4 }),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['visual', 'tbt', 'button-name'] });
  });

  it('subtracts targets with recorded evaluations at the candidate', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 1,
        badIndex: 3,
        recordedTargetEvaluations: { b: evaluation('visual', true) },
      }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('button-name', 'accessibility', { goodIndex: 1, badIndex: 3 }),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt', 'button-name'] });
    expect(work?.categories).toEqual(['perf', 'accessibility']);
  });

  it('applies recorded evaluations before scheduling partially evaluated candidate work', () => {
    const initial = session([
      bisectTarget('visual', 'visreg', {
        recordedTargetEvaluations: {
          g: evaluation('visual', false, 'g'),
          a: evaluation('visual', false, 'a'),
          b: evaluation('visual', true, 'b'),
          bad: evaluation('visual', true, 'bad'),
        },
      }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
    ]);

    const searchStateWithCurrentBoundaries = narrowTargetSearchRangesUsingRecordedEvaluations(initial);

    expect(target(initial, 'visual')).toMatchObject({ status: 'active', goodIndex: 0, badIndex: 4 });
    expect(target(searchStateWithCurrentBoundaries, 'visual')).toMatchObject({
      status: 'found',
      goodIndex: 1,
      badIndex: 2,
      firstBadSha: 'b',
    });
    expect(nextCandidate(searchStateWithCurrentBoundaries)).toMatchObject({
      sha: 'b',
      targetIds: ['tbt'],
      categories: ['perf'],
      tests: [{ testFile: 'tbt.abtest.ts', testName: 'tbt' }],
    });
  });

  it('requires no rerun and exposes persistable found boundaries when every candidate is cached', () => {
    const searchStateWithCurrentBoundaries = narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 1,
        badIndex: 3,
        recordedTargetEvaluations: { b: evaluation('visual', true, 'b') },
      }),
      bisectTarget('tbt', 'perf', {
        goodIndex: 1,
        badIndex: 3,
        recordedTargetEvaluations: { b: evaluation('tbt', false, 'b') },
      }),
    ]));

    const persisted = JSON.parse(JSON.stringify(searchStateWithCurrentBoundaries)) as BisectSearchInput;

    expect(target(persisted, 'visual')).toMatchObject({
      status: 'found',
      goodIndex: 1,
      badIndex: 2,
      firstBadSha: 'b',
    });
    expect(target(persisted, 'tbt')).toMatchObject({
      status: 'found',
      goodIndex: 2,
      badIndex: 3,
      firstBadSha: 'c',
    });
    expect(nextCandidate(searchStateWithCurrentBoundaries)).toBeNull();
  });

  it('requires current target boundaries before scheduling at compile time', () => {
    const rawSession = session([bisectTarget('visual', 'visreg')]);

    if (false) {
      // @ts-expect-error nextCandidate requires recorded evaluations to update boundaries first
      nextCandidate(rawSession);
    }

    expect(nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(rawSession))?.sha).toBe('b');
  });

  it('finds the first bad commit when boundaries become adjacent', () => {
    const updated = recordTargetEvaluationsAndNarrowSearchRanges(session([
      bisectTarget('visual', 'visreg', { goodIndex: 0, badIndex: 2 }),
    ]), 'a', new Map([
      ['visual', evaluation('visual', true, 'a')],
    ]));

    expect(target(updated, 'visual')).toMatchObject({
      badIndex: 1,
      status: 'found',
      firstBadSha: 'a',
    });
  });

  it('rejects target evaluations after an infrastructure error without mutating boundaries', () => {
    const initial = session([bisectTarget('visual', 'visreg')]);
    initial.commitRuns.b = {
      sha: 'b',
      requestedCategories: ['visreg'],
      requestedTestFiles: ['visual.abtest.ts'],
      experimentReloadMode: 'commands',
      usedFallback: false,
      startedAt: '2026-07-12T00:01:00.000Z',
      finishedAt: '2026-07-12T00:02:00.000Z',
      infrastructureError: 'compare timed out',
    };
    const originalTarget = target(initial, 'visual');

    expect(() => recordTargetEvaluationsAndNarrowSearchRanges(initial, 'b', new Map([
      ['visual', evaluation('visual', true)],
    ]))).toThrow('Cannot record target evaluations for b: compare timed out');
    expect(target(initial, 'visual')).toBe(originalTarget);
    expect(originalTarget).toMatchObject({ goodIndex: 0, badIndex: 4, recordedTargetEvaluations: {} });
  });

  it('skips invalid targets', () => {
    const work = nextCandidate(narrowTargetSearchRangesUsingRecordedEvaluations(session([
      bisectTarget('visual', 'visreg', {
        status: 'invalid',
        invalidReason: 'Present at known-good commit',
      }),
      bisectTarget('tbt', 'perf'),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt'], categories: ['perf'] });
  });
});

describe('native bisect target groups', () => {
  it('starts every active target in one deterministic group', () => {
    const targets = [
      bisectTarget('tbt', 'perf'),
      bisectTarget('visual', 'visreg'),
      bisectTarget('button-name', 'accessibility'),
    ];

    expect(createInitialTargetGroup('group-1', 'good', 'bad', targets)).toEqual({
      id: 'group-1',
      status: 'pending',
      goodSha: 'good',
      badSha: 'bad',
      targetIds: ['visual', 'tbt', 'button-name'],
      decisions: [],
    });
  });

  it('requests only group targets without cached evidence', () => {
    const visual = bisectTarget('visual', 'visreg', {
      recordedTargetEvaluations: { candidate: evaluation('visual', true, 'candidate') },
    });
    const tbt = bisectTarget('tbt', 'perf');
    const group = createInitialTargetGroup('group-1', 'good', 'bad', [visual, tbt]);

    expect(candidatePlanForGroup(group, [visual, tbt], 'candidate')).toEqual({
      sha: 'candidate',
      targetIds: ['tbt'],
      categories: ['perf'],
      tests: [{ testFile: 'tbt.abtest.ts', testName: 'tbt' }],
    });
  });

  it('continues the largest verdict partition and queues the remainder', () => {
    const targets = [
      bisectTarget('visual', 'visreg'),
      bisectTarget('layout', 'visreg'),
      bisectTarget('tbt', 'perf'),
    ];
    const group = createInitialTargetGroup('group-1', 'good', 'bad', targets);
    const result = partitionTargetGroup({
      group,
      targets,
      sha: 'candidate',
      evaluations: [
        evaluation('visual', true, 'candidate'),
        evaluation('layout', true, 'candidate'),
        evaluation('tbt', false, 'candidate'),
      ],
      nextGroupId: () => 'group-2',
    });

    expect(result.verdict).toBe('bad');
    expect(result.continuingGroup).toMatchObject({
      id: 'group-1',
      goodSha: 'good',
      badSha: 'candidate',
      targetIds: ['layout', 'visual'],
    });
    expect(result.queuedGroups).toEqual([expect.objectContaining({
      id: 'group-2',
      goodSha: 'candidate',
      badSha: 'bad',
      targetIds: ['tbt'],
    })]);
  });

  it('uses category and target identity as a stable equal-size tie-break', () => {
    const targets = [
      bisectTarget('visual', 'visreg'),
      bisectTarget('tbt', 'perf'),
    ];
    const result = partitionTargetGroup({
      group: createInitialTargetGroup('group-1', 'good', 'bad', targets),
      targets,
      sha: 'candidate',
      evaluations: [
        evaluation('visual', false, 'candidate'),
        evaluation('tbt', true, 'candidate'),
      ],
      nextGroupId: () => 'group-2',
    });

    expect(result.continuingGroup.targetIds).toEqual(['visual']);
    expect(result.verdict).toBe('good');
    expect(result.queuedGroups[0].targetIds).toEqual(['tbt']);
  });

  it('coalesces queued groups with identical boundaries', () => {
    const visual = createInitialTargetGroup('group-1', 'a', 'b', [bisectTarget('visual', 'visreg')]);
    const tbt = createInitialTargetGroup('group-2', 'a', 'b', [bisectTarget('tbt', 'perf')]);

    expect(coalesceTargetGroups([visual, tbt])).toEqual([expect.objectContaining({
      id: 'group-1',
      goodSha: 'a',
      badSha: 'b',
      targetIds: ['tbt', 'visual'],
    })]);
  });
});
