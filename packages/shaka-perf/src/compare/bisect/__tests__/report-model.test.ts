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
import type { BisectSession, BisectTarget, TargetObservation } from '../types';

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

function observation(targetId: string, values: TargetObservation['values']): TargetObservation {
  return {
    targetId,
    commitSha: 'bad',
    present: true,
    values,
    artifacts: [`/tmp/${targetId}.json`],
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
    observations: {},
    ...options,
  };
}

describe('buildBisectReportModel', () => {
  it('maps found targets to commits and keeps unresolved target details', () => {
    const visualObservation = observation('visual-found', { diffPixels: 42 });
    const session = {
      version: 1,
      status: 'complete',
      goodSha: 'good',
      badSha: 'bad',
      commitSubjects: {
        good: 'establish baseline',
        visual: 'change hero image',
        clean: 'refresh copy',
        bad: 'ship regressions',
      },
      originalExperiment: { sha: 'bad', branch: 'feature' },
      selectedCategories: ['visreg', 'perf', 'accessibility'],
      orderedCommits: commits,
      targets: [
        target('visual-found', 'visreg', 'tests/../tests/homepage.abtest.ts', 'Homepage', {
          firstBadSha: 'visual',
          observations: { bad: visualObservation },
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
      ],
      commitRuns: { visual: {} },
      startedAt: '2026-07-13T00:00:00.000Z',
    } as unknown as BisectSession;

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
    expect(model.targetsById['visual-found']).toMatchObject({
      testId: 'homepage-card',
      badRefObservation: visualObservation,
    });
  });
});
