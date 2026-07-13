/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectReportModel, BisectReportTarget } from '../report-model';

type BisectSelection =
  | { kind: 'all' }
  | { kind: 'commit'; sha: string }
  | { kind: 'unresolved' }
  | { kind: 'invalid' };

interface SelectionHelpers {
  selectionTargetIds: (model: BisectReportModel, selection: BisectSelection) => Set<string>;
  selectionTestIds: (model: BisectReportModel, selection: BisectSelection) => Set<string>;
  selectionCategories: (
    model: BisectReportModel,
    selection: BisectSelection,
  ) => Set<BisectReportTarget['category']>;
}

const {
  selectionCategories,
  selectionTargetIds,
  selectionTestIds,
} = require('../../../../report-shell/src/bisect-selection') as SelectionHelpers;

function target(
  id: string,
  category: BisectReportTarget['category'],
  testId: string | null,
  status: BisectReportTarget['status'] = 'found',
): BisectReportTarget {
  return {
    id,
    category,
    testId,
    testFile: `tests/${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: id,
    status,
  };
}

const targets = [
  target('visual-target', 'visreg', 'homepage-card'),
  target('perf-target', 'perf', 'product-card'),
  target('unmapped-target', 'accessibility', null),
  target('unresolved-target', 'perf', 'homepage-card', 'active'),
  target('invalid-target', 'accessibility', 'homepage-card', 'invalid'),
];

const model: BisectReportModel = {
  status: 'complete',
  goodSha: 'good',
  badSha: 'bad',
  generatedAt: '2026-07-13T00:00:00.000Z',
  commits: [
    {
      sha: 'visual',
      subject: 'change hero image',
      position: 0,
      measured: true,
      counts: { visreg: 1, perf: 0, accessibility: 0 },
      targetIds: ['visual-target'],
    },
    {
      sha: 'clean',
      subject: 'refresh copy',
      position: 1,
      measured: false,
      counts: { visreg: 0, perf: 0, accessibility: 0 },
      targetIds: [],
    },
    {
      sha: 'bad',
      subject: 'ship regressions',
      position: 2,
      measured: true,
      counts: { visreg: 0, perf: 1, accessibility: 1 },
      targetIds: ['perf-target', 'unmapped-target'],
    },
  ],
  targets,
  targetsById: Object.fromEntries(targets.map((item) => [item.id, item])),
  views: {
    unresolved: { targetIds: ['unresolved-target'] },
    invalid: { targetIds: ['invalid-target'] },
  },
};

function expectSelection(
  selection: BisectSelection,
  expected: {
    targetIds: string[];
    testIds: string[];
    categories: BisectReportTarget['category'][];
  },
): void {
  expect([...selectionTargetIds(model, selection)]).toEqual(expected.targetIds);
  expect([...selectionTestIds(model, selection)]).toEqual(expected.testIds);
  expect([...selectionCategories(model, selection)]).toEqual(expected.categories);
}

describe('bisect report selection', () => {
  it('derives every found target, mapped card, and category for all regressions', () => {
    expectSelection(
      { kind: 'all' },
      {
        targetIds: ['visual-target', 'perf-target', 'unmapped-target'],
        testIds: ['homepage-card', 'product-card'],
        categories: ['visreg', 'perf', 'accessibility'],
      },
    );
  });

  it('selects only the visual target, card, and category for a visual commit', () => {
    expectSelection(
      { kind: 'commit', sha: 'visual' },
      {
        targetIds: ['visual-target'],
        testIds: ['homepage-card'],
        categories: ['visreg'],
      },
    );
  });

  it('keeps a clean commit selection explicitly empty', () => {
    expectSelection(
      { kind: 'commit', sha: 'clean' },
      { targetIds: [], testIds: [], categories: [] },
    );
  });

  it.each([
    {
      selection: { kind: 'unresolved' } as const,
      targetIds: ['unresolved-target'],
      testIds: ['homepage-card'],
      categories: ['perf'] as BisectReportTarget['category'][],
    },
    {
      selection: { kind: 'invalid' } as const,
      targetIds: ['invalid-target'],
      testIds: ['homepage-card'],
      categories: ['accessibility'] as BisectReportTarget['category'][],
    },
  ])('returns the exact target set for $selection.kind', ({ selection, targetIds, testIds, categories }) => {
    expectSelection(selection, { targetIds, testIds, categories });
  });
});
