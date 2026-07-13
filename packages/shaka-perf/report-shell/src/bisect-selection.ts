/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectCategory, BisectReportModel } from './types';
import type { ReportStage } from '../../src/pipeline/pipeline-artifacts';

export type BisectSelection =
  | { kind: 'all' }
  | { kind: 'commit'; sha: string }
  | { kind: 'unresolved' }
  | { kind: 'invalid' };

export function selectionTargetIds(
  model: BisectReportModel,
  selection: BisectSelection,
): Set<string> {
  if (selection.kind === 'all') {
    return new Set(
      model.targets.filter((target) => target.status === 'found').map((target) => target.id),
    );
  }
  if (selection.kind === 'commit') {
    return new Set(
      model.commits.find((commit) => commit.sha === selection.sha)?.targetIds ?? [],
    );
  }
  return new Set(model.views[selection.kind].targetIds);
}

export function selectionTestIds(
  model: BisectReportModel,
  selection: BisectSelection,
): Set<string> {
  const testIds = new Set<string>();
  for (const targetId of selectionTargetIds(model, selection)) {
    const testId = model.targetsById[targetId]?.testId;
    if (testId != null) testIds.add(testId);
  }
  return testIds;
}

export function selectionCategories(
  model: BisectReportModel,
  selection: BisectSelection,
): Set<BisectCategory> {
  const categories = new Set<BisectCategory>();
  for (const targetId of selectionTargetIds(model, selection)) {
    const category = model.targetsById[targetId]?.category;
    if (category != null) categories.add(category);
  }
  return categories;
}

export function stageNamesForCategories(
  stages: readonly ReportStage[],
  visibleStageNames: ReadonlySet<string>,
  categories: ReadonlySet<BisectCategory>,
): Set<string> {
  const reportCategories = new Set<ReportStage['category']>(categories);
  return new Set(
    stages
      .filter((stage) => visibleStageNames.has(stage.name) && reportCategories.has(stage.category))
      .map((stage) => stage.name),
  );
}
