/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  candidatePlanForGroup,
  createInitialTargetGroup,
  partitionTargetGroup,
} from '../search';
import type {
  BisectCategory,
  BisectTarget,
  TargetEvaluationAtCommit,
} from '../types';

function evaluation(
  targetId: string,
  regressionDetected: boolean,
  commitSha = 'candidate',
): TargetEvaluationAtCommit {
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
    recordedTargetEvaluations: {},
    ...options,
  };
}

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
      recordedTargetEvaluations: { candidate: evaluation('visual', true) },
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

  it('deduplicates tests shared by multiple target subjects', () => {
    const targets = [
      bisectTarget('header', 'visreg', {
        testFile: 'account.abtest.ts',
        testName: 'Account',
      }),
      bisectTarget('document', 'visreg', {
        testFile: 'account.abtest.ts',
        testName: 'Account',
      }),
    ];

    expect(candidatePlanForGroup(
      createInitialTargetGroup('group-1', 'good', 'bad', targets),
      targets,
      'candidate',
    ).tests).toEqual([{ testFile: 'account.abtest.ts', testName: 'Account' }]);
  });

  it('continues the largest verdict partition and queues the remainder', () => {
    const targets = [
      bisectTarget('visual', 'visreg'),
      bisectTarget('layout', 'visreg'),
      bisectTarget('tbt', 'perf'),
    ];
    const result = partitionTargetGroup({
      group: createInitialTargetGroup('group-1', 'good', 'bad', targets),
      targets,
      sha: 'candidate',
      evaluations: [
        evaluation('visual', true),
        evaluation('layout', true),
        evaluation('tbt', false),
      ],
      queuedGroupId: 'group-2',
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
      evaluations: [evaluation('visual', false), evaluation('tbt', true)],
      queuedGroupId: 'group-2',
    });

    expect(result.continuingGroup.targetIds).toEqual(['visual']);
    expect(result.verdict).toBe('good');
    expect(result.queuedGroups[0].targetIds).toEqual(['tbt']);
  });

  it('can split a previously divergent group again', () => {
    const targets = [
      bisectTarget('visual', 'visreg'),
      bisectTarget('layout', 'visreg'),
      bisectTarget('tbt', 'perf'),
    ];
    const first = partitionTargetGroup({
      group: createInitialTargetGroup('group-1', 'good', 'bad', targets),
      targets,
      sha: 'middle',
      evaluations: [
        evaluation('visual', true, 'middle'),
        evaluation('layout', true, 'middle'),
        evaluation('tbt', false, 'middle'),
      ],
      queuedGroupId: 'group-2',
    });
    const second = partitionTargetGroup({
      group: first.continuingGroup,
      targets,
      sha: 'earlier',
      evaluations: [
        evaluation('visual', true, 'earlier'),
        evaluation('layout', false, 'earlier'),
      ],
      queuedGroupId: 'group-3',
    });

    expect(second.continuingGroup).toMatchObject({
      goodSha: 'earlier',
      badSha: 'middle',
      targetIds: ['layout'],
    });
    expect(second.queuedGroups[0]).toMatchObject({
      id: 'group-3',
      goodSha: 'good',
      badSha: 'earlier',
      targetIds: ['visual'],
    });
  });

});
