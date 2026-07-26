/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  BisectCategory,
  BisectTestSelection,
  BisectTarget,
  BisectTargetGroup,
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

export interface PartitionTargetGroupResult {
  continuingGroup: BisectTargetGroup;
  queuedGroups: BisectTargetGroup[];
  targets: BisectTarget[];
  verdict: 'good' | 'bad';
}

export function createInitialTargetGroup(
  id: string,
  goodSha: string,
  badSha: string,
  targets: readonly BisectTarget[],
): BisectTargetGroup {
  return {
    id,
    status: 'pending',
    goodSha,
    badSha,
    targetIds: stableTargetOrder(targets).map((target) => target.id),
    decisions: [],
  };
}

export function candidatePlanForGroup(
  group: BisectTargetGroup,
  targets: readonly BisectTarget[],
  sha: string,
): CandidateMeasurementPlan {
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const missingTargets = group.targetIds.map((targetId) => {
    const target = targetsById.get(targetId);
    if (!target) throw new Error(`Unknown bisect target in group ${group.id}: ${targetId}`);
    return target;
  }).filter((target) => (
    target.status === 'active' && target.recordedTargetEvaluations[sha] === undefined
  ));
  return {
    sha,
    targetIds: missingTargets.map((target) => target.id),
    categories: unique(missingTargets.map((target) => target.category)),
    tests: testsForTargets(missingTargets),
  };
}

export function partitionTargetGroup(options: {
  group: BisectTargetGroup;
  targets: readonly BisectTarget[];
  sha: string;
  evaluations: readonly TargetEvaluationAtCommit[];
  nextGroupId(): string;
}): PartitionTargetGroupResult {
  const incoming = new Map(options.evaluations.map((evaluation) => [evaluation.targetId, evaluation]));
  const targets = options.targets.map((target) => {
    const evaluation = incoming.get(target.id);
    if (!evaluation) return target;
    if (evaluation.commitSha !== options.sha) {
      throw new Error(`Target ${target.id} evaluation is for ${evaluation.commitSha}, expected ${options.sha}`);
    }
    return {
      ...target,
      recordedTargetEvaluations: {
        ...target.recordedTargetEvaluations,
        [options.sha]: evaluation,
      },
    };
  });
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const partitions = new Map<'good' | 'bad', BisectTarget[]>();
  for (const targetId of options.group.targetIds) {
    const target = targetsById.get(targetId);
    if (!target) throw new Error(`Unknown bisect target in group ${options.group.id}: ${targetId}`);
    const evaluation = target.recordedTargetEvaluations[options.sha];
    if (!evaluation) {
      throw new Error(`Missing target evaluation for ${target.id} at ${options.sha}`);
    }
    const verdict = evaluation.regressionDetected ? 'bad' : 'good';
    partitions.set(verdict, [...(partitions.get(verdict) ?? []), target]);
  }
  const rankedPartitions = [...partitions.entries()].sort((left, right) => (
    right[1].length - left[1].length
      || targetPartitionKey(left[1]).localeCompare(targetPartitionKey(right[1]))
  ));
  const continuingPartition = rankedPartitions[0];
  if (!continuingPartition) throw new Error(`Bisect target group ${options.group.id} is empty`);
  const [verdict, continuingTargets] = continuingPartition;
  const groupFor = (
    id: string,
    status: BisectTargetGroup['status'],
    partitionVerdict: 'good' | 'bad',
    partitionTargets: BisectTarget[],
  ): BisectTargetGroup => ({
    id,
    status,
    goodSha: partitionVerdict === 'good' ? options.sha : options.group.goodSha,
    badSha: partitionVerdict === 'bad' ? options.sha : options.group.badSha,
    targetIds: stableTargetOrder(partitionTargets).map((target) => target.id),
    decisions: [...options.group.decisions, { sha: options.sha, verdict: partitionVerdict }],
  });
  return {
    continuingGroup: groupFor(options.group.id, 'running', verdict, continuingTargets),
    queuedGroups: rankedPartitions.slice(1).map(([partitionVerdict, partitionTargets]) => (
      groupFor(options.nextGroupId(), 'pending', partitionVerdict, partitionTargets)
    )),
    targets,
    verdict,
  };
}

export function coalesceTargetGroups(groups: readonly BisectTargetGroup[]): BisectTargetGroup[] {
  const result: BisectTargetGroup[] = [];
  for (const group of groups) {
    const existingIndex = result.findIndex((candidate) => (
      candidate.status === 'pending'
      && group.status === 'pending'
      && candidate.goodSha === group.goodSha
      && candidate.badSha === group.badSha
    ));
    if (existingIndex === -1) {
      result.push({ ...group, targetIds: [...group.targetIds], decisions: [...group.decisions] });
      continue;
    }
    const existing = result[existingIndex];
    result[existingIndex] = {
      ...existing,
      targetIds: [...new Set([...existing.targetIds, ...group.targetIds])].sort(),
      decisions: [...existing.decisions, ...group.decisions],
    };
  }
  return result;
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

function stableTargetOrder(targets: readonly BisectTarget[]): BisectTarget[] {
  return [...targets].sort((left, right) => (
    categoryPriority[left.category] - categoryPriority[right.category]
      || left.id.localeCompare(right.id)
  ));
}

function targetPartitionKey(targets: readonly BisectTarget[]): string {
  return stableTargetOrder(targets)
    .map((target) => `${categoryPriority[target.category]}:${target.id}`)
    .join('\0');
}
