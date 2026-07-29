/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  BisectCategory,
  BisectTestSelection,
  BisectTarget,
  CommitRun,
  SearchStateWithCurrentBoundaries,
  TargetEvaluationAtCommit,
} from './types';
import { BisectTargetModel } from './models';

const categoryPriority: Record<BisectCategory, number> = {
  visreg: 0,
  perf: 1,
  accessibility: 2,
};

export interface CandidateMeasurementPlan {
  sha: string;
  targetIds: string[];
  categories: BisectCategory[];
  tests: BisectTestSelection[];
}

/**
 * The only state the search needs. Both `BisectSession` and a
 * `BisectSearchPhase` paired with the session's commit runs satisfy it, so a
 * phase never has to fabricate a session to drive the search.
 */
export interface BisectSearchInput {
  orderedCommits: string[];
  targets: BisectTarget[];
  commitRuns: Record<string, CommitRun>;
}

export function nextCandidate(
  session: SearchStateWithCurrentBoundaries<BisectSearchInput>,
): CandidateMeasurementPlan | null {
  const targetModels = session.targets.map((target) => (
    BisectTargetModel.from(target, session.orderedCommits)
  ));
  const selectedTargetModel = targetModels
    .filter((target) => target.isActive())
    .sort((left, right) => {
      const leftTarget = left.toTarget();
      const rightTarget = right.toTarget();
      return categoryPriority[leftTarget.category] - categoryPriority[rightTarget.category]
        || leftTarget.id.localeCompare(rightTarget.id);
    })[0];

  if (!selectedTargetModel) return null;
  const selectedTarget = selectedTargetModel.toTarget();

  if (!selectedTargetModel.hasValidSearchRange()) {
    throw new Error(
      `Invalid bisect interval for target ${selectedTarget.id}: good index `
      + `${selectedTarget.goodIndex} must be less than bad index ${selectedTarget.badIndex}`,
    );
  }

  const candidateIndex = selectedTargetModel.middleCommitIndex();
  const sha = session.orderedCommits[candidateIndex];
  if (!sha) return null;

  const targets = targetModels
    .filter((target) => target.needsEvaluationAt(sha, candidateIndex))
    .map((target) => target.toTarget());

  if (targets.length === 0) {
    throw new Error(`Bisect candidate ${sha} has no active targets requiring evaluation`);
  }

  return {
    sha,
    targetIds: targets.map((target) => target.id),
    categories: unique(targets.map((target) => target.category)),
    tests: testsForTargets(targets),
  };
}

export function testsForTargets(targets: readonly BisectTarget[]): BisectTestSelection[] {
  const selections = new Map<string, BisectTestSelection>();
  for (const target of targets) {
    const selection = {
      testFile: target.testFile,
      testName: target.testName,
    };
    selections.set(JSON.stringify([selection.testFile, selection.testName]), selection);
  }
  return [...selections.values()];
}

export function narrowTargetSearchRangesUsingRecordedEvaluations<T extends BisectSearchInput>(
  session: T,
): SearchStateWithCurrentBoundaries<T> {
  const commitIndexes = new Map(session.orderedCommits.map((sha, index) => [sha, index]));

  return {
    ...session,
    targets: session.targets.map((target) => BisectTargetModel
      .from(target, session.orderedCommits)
      .narrowSearchRangeUsingRecordedEvaluations(commitIndexes)
      .toTarget()),
  } as SearchStateWithCurrentBoundaries<T>;
}

export function recordTargetEvaluationsAndNarrowSearchRanges<T extends BisectSearchInput>(
  session: T,
  sha: string,
  targetEvaluations: Map<string, TargetEvaluationAtCommit>,
): T {
  const infrastructureError = session.commitRuns[sha]?.infrastructureError;
  if (infrastructureError) {
    throw new Error(`Cannot record target evaluations for ${sha}: ${infrastructureError}`);
  }

  const commitIndex = session.orderedCommits.indexOf(sha);
  if (commitIndex === -1) throw new Error(`Unknown bisect commit: ${sha}`);

  return {
    ...session,
    targets: session.targets.map((target) => {
      const evaluation = targetEvaluations.get(target.id);
      if (!evaluation) return target;

      return BisectTargetModel.from(target, session.orderedCommits)
        .recordEvaluationAndNarrowSearchRange(evaluation, commitIndex)
        .toTarget();
    }),
  } as T;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
