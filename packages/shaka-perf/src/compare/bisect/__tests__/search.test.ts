/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { applyObservations, nextCandidate } from '../search';
import type {
  BisectCategory,
  BisectSession,
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

function session(targets: BisectTarget[]): BisectSession {
  return {
    version: 1,
    status: 'running',
    goodSha: 'g',
    badSha: 'bad',
    originalExperiment: { sha: 'bad', branch: 'feature' },
    selectedCategories: ['visreg', 'perf', 'accessibility'],
    orderedCommits,
    targets,
    commitRuns: {},
    startedAt: '2026-07-12T00:00:00.000Z',
  };
}

function target(value: BisectSession, id: string): BisectTarget {
  return value.targets.find((item) => item.id === id)!;
}

describe('bisect scheduler', () => {
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
    const work = nextCandidate(session([
      bisectTarget('zebra', 'visreg', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('alpha', 'visreg', { goodIndex: 0, badIndex: 2 }),
      bisectTarget('tbt', 'perf'),
      bisectTarget('button-name', 'accessibility'),
    ]));

    expect(work?.sha).toBe('a');
    expect(work?.targetIds).toEqual(['zebra', 'alpha', 'tbt', 'button-name']);
    expect(work?.categories).toEqual(['visreg', 'perf', 'accessibility']);
    expect(work?.testFiles).toEqual([
      'zebra.abtest.ts',
      'alpha.abtest.ts',
      'tbt.abtest.ts',
      'button-name.abtest.ts',
    ]);
  });

  it('groups every active target whose interval contains the candidate', () => {
    const work = nextCandidate(session([
      bisectTarget('visual', 'visreg', { goodIndex: 0, badIndex: 4 }),
      bisectTarget('tbt', 'perf', { goodIndex: 1, badIndex: 3 }),
      bisectTarget('button-name', 'accessibility', { goodIndex: 2, badIndex: 4 }),
    ]));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['visual', 'tbt', 'button-name'] });
  });

  it('subtracts targets with cached observations at the candidate', () => {
    const work = nextCandidate(session([
      bisectTarget('visual', 'visreg', { observations: { b: observation('visual', true) } }),
      bisectTarget('tbt', 'perf'),
      bisectTarget('button-name', 'accessibility'),
    ]));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt', 'button-name'] });
    expect(work?.categories).toEqual(['perf', 'accessibility']);
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

  it('skips invalid targets', () => {
    const work = nextCandidate(session([
      bisectTarget('visual', 'visreg', {
        status: 'invalid',
        invalidReason: 'Present at known-good commit',
      }),
      bisectTarget('tbt', 'perf'),
    ]));

    expect(work).toMatchObject({ sha: 'b', targetIds: ['tbt'], categories: ['perf'] });
  });
});
