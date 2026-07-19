/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  applyCachedObservations,
  applyObservations,
  nextCandidate,
  type BisectSearchInput,
} from '../search';
import type {
  BisectCategory,
  BisectTarget,
  TargetObservation,
} from '../types';

const orderedCommits = ['g', 'a', 'b', 'c', 'bad'];

function observation(targetId: string, present: boolean, commitSha = 'b'): TargetObservation {
  return {
    targetId,
    commitSha,
    present,
    values: {},
    artifacts: [],
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
    observations: {},
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
    const normalized = applyCachedObservations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 0,
        badIndex: 0,
        observations: { g: observation('visual', true, 'g') },
      }),
    ]));

    expect(() => nextCandidate(normalized)).toThrow(/invalid bisect interval/i);
  });

  it('rejects a candidate with no unobserved active targets', () => {
    const normalized = applyCachedObservations(session([
      bisectTarget('visual', 'visreg'),
    ]));
    normalized.targets[0].observations.b = observation('visual', true, 'b');

    expect(() => nextCandidate(normalized)).toThrow(/no unobserved active targets/i);
  });

  it('updates divergent target intervals independently', () => {
    const updated = applyObservations(session([
      bisectTarget('visual', 'visreg'),
      bisectTarget('tbt', 'perf'),
      bisectTarget('button-name', 'accessibility'),
    ]), 'b', new Map([
      ['visual', observation('visual', true)],
      ['tbt', observation('tbt', false)],
    ]));

    expect(target(updated, 'visual').badIndex).toBe(2);
    expect(target(updated, 'tbt').goodIndex).toBe(2);
  });

  it('selects the first target by category priority and stable id', () => {
    const work = nextCandidate(applyCachedObservations(session([
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
    const work = nextCandidate(applyCachedObservations(session([
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
    const work = nextCandidate(applyCachedObservations(session([
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
    const work = nextCandidate(applyCachedObservations(session([
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
    const work = nextCandidate(applyCachedObservations(session([
      bisectTarget('visual', 'visreg', { goodIndex: 0, badIndex: 4 }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('button-name', 'accessibility', { goodIndex: 2, badIndex: 4 }),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['visual', 'tbt', 'button-name'] });
  });

  it('subtracts targets with cached observations at the candidate', () => {
    const work = nextCandidate(applyCachedObservations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 1,
        badIndex: 3,
        observations: { b: observation('visual', true) },
      }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('button-name', 'accessibility', { goodIndex: 1, badIndex: 3 }),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt', 'button-name'] });
    expect(work?.categories).toEqual(['perf', 'accessibility']);
  });

  it('applies cached observations before scheduling partially cached candidate work', () => {
    const initial = session([
      bisectTarget('visual', 'visreg', {
        observations: {
          g: observation('visual', false, 'g'),
          a: observation('visual', false, 'a'),
          b: observation('visual', true, 'b'),
          bad: observation('visual', true, 'bad'),
        },
      }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
    ]);

    const normalized = applyCachedObservations(initial);

    expect(target(initial, 'visual')).toMatchObject({ status: 'active', goodIndex: 0, badIndex: 4 });
    expect(target(normalized, 'visual')).toMatchObject({
      status: 'found',
      goodIndex: 1,
      badIndex: 2,
      firstBadSha: 'b',
    });
    expect(nextCandidate(normalized)).toMatchObject({
      sha: 'b',
      targetIds: ['tbt'],
      categories: ['perf'],
      tests: [{ testFile: 'tbt.abtest.ts', testName: 'tbt' }],
    });
  });

  it('requires no rerun and exposes persistable found boundaries when every candidate is cached', () => {
    const normalized = applyCachedObservations(session([
      bisectTarget('visual', 'visreg', {
        goodIndex: 1,
        badIndex: 3,
        observations: { b: observation('visual', true, 'b') },
      }),
      bisectTarget('tbt', 'perf', {
        goodIndex: 1,
        badIndex: 3,
        observations: { b: observation('tbt', false, 'b') },
      }),
    ]));

    const persisted = JSON.parse(JSON.stringify(normalized)) as BisectSearchInput;

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
    expect(nextCandidate(normalized)).toBeNull();
  });

  it('requires a normalized session before scheduling at compile time', () => {
    const rawSession = session([bisectTarget('visual', 'visreg')]);

    if (false) {
      // @ts-expect-error nextCandidate requires cached observations to be normalized first
      nextCandidate(rawSession);
    }

    expect(nextCandidate(applyCachedObservations(rawSession))?.sha).toBe('b');
  });

  it('finds the first bad commit when boundaries become adjacent', () => {
    const updated = applyObservations(session([
      bisectTarget('visual', 'visreg', { goodIndex: 0, badIndex: 2 }),
    ]), 'a', new Map([
      ['visual', observation('visual', true, 'a')],
    ]));

    expect(target(updated, 'visual')).toMatchObject({
      badIndex: 1,
      status: 'found',
      firstBadSha: 'a',
    });
  });

  it('rejects observations after an infrastructure error without mutating boundaries', () => {
    const initial = session([bisectTarget('visual', 'visreg')]);
    initial.commitRuns.b = {
      sha: 'b',
      requestedCategories: ['visreg'],
      requestedTestFiles: ['visual.abtest.ts'],
      refreshMode: 'commands',
      usedFallback: false,
      startedAt: '2026-07-12T00:01:00.000Z',
      finishedAt: '2026-07-12T00:02:00.000Z',
      infrastructureError: 'compare timed out',
    };
    const originalTarget = target(initial, 'visual');

    expect(() => applyObservations(initial, 'b', new Map([
      ['visual', observation('visual', true)],
    ]))).toThrow('Cannot apply observations for b: compare timed out');
    expect(target(initial, 'visual')).toBe(originalTarget);
    expect(originalTarget).toMatchObject({ goodIndex: 0, badIndex: 4, observations: {} });
  });

  it('skips invalid targets', () => {
    const work = nextCandidate(applyCachedObservations(session([
      bisectTarget('visual', 'visreg', {
        status: 'invalid',
        invalidReason: 'Present at known-good commit',
      }),
      bisectTarget('tbt', 'perf'),
    ])));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt'], categories: ['perf'] });
  });
});
