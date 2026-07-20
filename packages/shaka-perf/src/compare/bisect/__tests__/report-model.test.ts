/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { buildBisectReportModel } from '../report-model';
import type { TestResult } from '../../../pipeline/report';
import type { BisectSession, BisectTarget, TargetEvaluationAtCommit } from '../types';

const commits = ['good', 'visual', 'clean', 'bad'];

function testResult(id: string, filePath: string, name: string): TestResult {
  return {
    id,
    name,
    filePath,
    startingPath: '/',
    controlUrl: 'http://control.test/',
    experimentUrl: 'http://experiment.test/',
    code: null,
    chips: [],
    sorts: [],
    durationMs: 0,
    measuredAt: null,
    runId: null,
    outcomes: [],
    viewportArtifactPaths: [{ viewport: DESKTOP_VIEWPORT.label, path: `/tmp/${id}` }],
  };
}

function evaluation(targetId: string, evidence: TargetEvaluationAtCommit['evidence']): TargetEvaluationAtCommit {
  return {
    targetId,
    commitSha: 'bad',
    regressionDetected: true,
    evidence,
    evidenceArtifacts: [`/tmp/${targetId}.json`],
  };
}

function target(
  id: string,
  category: BisectTarget['category'],
  testFile: string,
  testName: string,
  options: Partial<BisectTarget> = {},
): BisectTarget {
  return {
    id,
    category,
    testFile,
    testName,
    viewport: 'desktop',
    subject: id,
    status: 'found',
    goodIndex: 0,
    badIndex: 3,
    firstBadSha: 'bad',
    recordedTargetEvaluations: {},
    ...options,
  };
}

describe('buildBisectReportModel', () => {
  it('maps found targets to commits and keeps unresolved target details', () => {
    const visualEvaluation = evaluation('visual-found', { diffPixels: 42 });
    const midpointEvaluation = {
      ...evaluation('visual-found', { diffPixels: 5 }),
      commitSha: 'visual',
    };
    const commitSubjects = {
      good: 'establish baseline',
      visual: 'change hero image',
      clean: 'refresh copy',
      bad: 'ship regressions',
    };
    const targets = [
      target('visual-found', 'visreg', 'tests/../tests/homepage.abtest.ts', 'Homepage', {
        firstBadSha: 'visual',
        recordedTargetEvaluations: { visual: midpointEvaluation, bad: visualEvaluation },
      }),
      target('perf-found', 'perf', 'tests/product.abtest.ts', 'Product'),
      target('accessibility-found', 'accessibility', 'tests/homepage.abtest.ts', 'Homepage'),
      target('missing-card', 'visreg', 'tests/missing.abtest.ts', 'Missing'),
      target('unresolved-target', 'perf', 'tests/homepage.abtest.ts', 'Homepage', {
        status: 'active',
        firstBadSha: undefined,
      }),
      target('invalid-target', 'accessibility', 'tests/homepage.abtest.ts', 'Homepage', {
        status: 'invalid',
        firstBadSha: undefined,
        invalidReason: 'target is already present at the good ref',
      }),
    ];
    const session = {
      status: 'complete',
      commitRuns: {
        visual: { compareCompleted: true },
        clean: {
          compareCompleted: false,
          infrastructureError: 'refresh failed',
        },
      },
      startedAt: '2026-07-13T00:00:00.000Z',
    } as unknown as BisectSession;
    session.primary = {
      id: 'primary',
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      orderedCommits: commits,
      commitSubjects,
      commitParents: {
        good: [], visual: ['good', 'topic'], clean: ['visual'], bad: ['clean'],
      },
      targets,
      attempts: [],
    };
    session.mergeQueue = ['visual'];
    session.mergeInvestigations = {
      visual: {
        mergeSha: 'visual',
        parents: ['good', 'topic'],
        status: 'complete',
        targetIds: ['visual-found'],
        targetResults: {
          'visual-found': { kind: 'source-found', sourceSha: 'topic-source' },
        },
      },
    };

    const model = buildBisectReportModel(session, [
      testResult('homepage-card', 'tests/homepage.abtest.ts', 'Homepage'),
      testResult('product-card', 'tests/product.abtest.ts', 'Product'),
    ], '2026-07-13T00:05:00.000Z');

    expect(model).toMatchObject({
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      generatedAt: '2026-07-13T00:05:00.000Z',
    });
    expect(model.commits.map((commit) => ({
      sha: commit.sha,
      subject: commit.subject,
      position: commit.position,
      measured: commit.measured,
      counts: commit.counts,
    }))).toEqual([
      {
        sha: 'good',
        subject: 'establish baseline',
        position: 0,
        measured: false,
        counts: { visreg: 0, perf: 0, accessibility: 0 },
      },
      {
        sha: 'visual',
        subject: 'change hero image',
        position: 1,
        measured: true,
        counts: { visreg: 1, perf: 0, accessibility: 0 },
      },
      {
        sha: 'clean',
        subject: 'refresh copy',
        position: 2,
        measured: false,
        counts: { visreg: 0, perf: 0, accessibility: 0 },
      },
      {
        sha: 'bad',
        subject: 'ship regressions',
        position: 3,
        measured: false,
        counts: { visreg: 1, perf: 1, accessibility: 1 },
      },
    ]);
    expect(model.commits[1].counts).toEqual({ visreg: 1, perf: 0, accessibility: 0 });
    expect(model.views.unresolved.targetIds).toEqual(['unresolved-target']);
    expect(model.views.invalid.targetIds).toEqual(['invalid-target']);
    expect(model.targetsById['missing-card'].testId).toBeNull();
    expect(model.targetsById['visual-found'].testId).toBe('homepage-card');
    expect(model.targetsById['visual-found'].badRefEvaluation).toBe(visualEvaluation);
    expect(model.commits[1]).toMatchObject({
      isMerge: true,
      mergeInvestigationStatus: 'complete',
    });
    expect(model.targetsById['visual-found']).toMatchObject({
      mainlineFirstBadSha: 'visual',
      mainlineIsMerge: true,
      mergeInvestigationStatus: 'complete',
      mergeResult: 'source-found',
      mergeSourceSha: 'topic-source',
    });
  });

  it('projects an investigated merge into ordered attributable source commits', () => {
    const sourceTarget = target('source-target', 'visreg', 'tests/source.abtest.ts', 'Source', {
      firstBadSha: 'merge',
    });
    const nestedTarget = target(
      'nested-target',
      'accessibility',
      'tests/nested.abtest.ts',
      'Nested',
      { firstBadSha: 'merge' },
    );
    const introducedTarget = target(
      'introduced-target',
      'perf',
      'tests/merge.abtest.ts',
      'Merge',
      { firstBadSha: 'merge' },
    );
    const session = {
      status: 'complete',
      mode: 'complete',
      originalExperiment: { sha: 'merge', branch: 'feature' },
      primary: {
        id: 'primary',
        status: 'complete',
        goodSha: 'main-base',
        badSha: 'merge',
        orderedCommits: ['main-base', 'merge'],
        commitSubjects: { 'main-base': 'main baseline', merge: 'merge topic' },
        commitParents: { 'main-base': [], merge: ['main-base', 'source-tip'] },
        targets: [sourceTarget, nestedTarget, introducedTarget],
        attempts: [],
      },
      mergeQueue: ['merge'],
      mergeInvestigations: {
        merge: {
          mergeSha: 'merge',
          parents: ['main-base', 'source-tip'],
          status: 'complete',
          targetIds: [sourceTarget.id, nestedTarget.id, introducedTarget.id],
          targetResults: {
            [sourceTarget.id]: { kind: 'source-found', sourceSha: 'source-bad' },
            [nestedTarget.id]: { kind: 'nested-merge', sourceSha: 'source-tip' },
            [introducedTarget.id]: { kind: 'merge-introduced' },
          },
          phase: {
            id: 'merge:merge',
            status: 'complete',
            goodSha: 'source-base',
            badSha: 'source-tip',
            orderedCommits: ['source-base', 'source-clean', 'source-bad', 'source-tip'],
            commitSubjects: {
              'source-base': 'shared baseline',
              'source-clean': 'prepare source branch',
              'source-bad': 'introduce visual regression',
              'source-tip': 'merge nested source',
            },
            commitParents: {
              'source-base': [],
              'source-clean': ['source-base'],
              'source-bad': ['source-clean'],
              'source-tip': ['source-bad', 'nested-parent'],
            },
            targets: [],
            attempts: [
              { id: 'clean', sha: 'source-clean', status: 'incomplete' },
              { id: 'bad', sha: 'source-bad', status: 'complete' },
              { id: 'tip', sha: 'source-tip', status: 'complete' },
            ],
          },
        },
      },
      commitRuns: { merge: { compareCompleted: true } },
      startedAt: '2026-07-16T00:00:00.000Z',
    } as unknown as BisectSession;

    const model = buildBisectReportModel(session, [
      testResult('source-card', 'tests/source.abtest.ts', 'Source'),
      testResult('nested-card', 'tests/nested.abtest.ts', 'Nested'),
      testResult('merge-card', 'tests/merge.abtest.ts', 'Merge'),
    ], '2026-07-16T00:01:00.000Z');

    expect(model.commits[1].mergeInvestigation).toEqual({
      status: 'complete',
      failure: undefined,
      mergeBase: 'source-base',
      secondParent: 'source-tip',
      sourceCommits: [
        {
          sha: 'source-clean',
          subject: 'prepare source branch',
          measured: false,
          isMerge: false,
          targetIds: [],
          counts: { visreg: 0, perf: 0, accessibility: 0 },
        },
        {
          sha: 'source-bad',
          subject: 'introduce visual regression',
          measured: true,
          isMerge: false,
          targetIds: ['source-target'],
          counts: { visreg: 1, perf: 0, accessibility: 0 },
        },
        {
          sha: 'source-tip',
          subject: 'merge nested source',
          measured: true,
          isMerge: true,
          targetIds: ['nested-target'],
          counts: { visreg: 0, perf: 0, accessibility: 1 },
        },
      ],
      mergeIntroducedTargetIds: ['introduced-target'],
    });
  });
});
