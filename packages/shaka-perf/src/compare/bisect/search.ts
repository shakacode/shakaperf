/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectCategory, BisectSession, TargetObservation } from './types';

const categoryPriority: Record<BisectCategory, number> = {
  visreg: 0,
  perf: 1,
  accessibility: 2,
};

export interface CandidateWork {
  sha: string;
  targetIds: string[];
  categories: BisectCategory[];
  testFiles: string[];
}

export function nextCandidate(session: BisectSession): CandidateWork | null {
  const selectedTarget = session.targets
    .filter((target) => target.status === 'active')
    .sort((left, right) => categoryPriority[left.category] - categoryPriority[right.category]
      || left.id.localeCompare(right.id))[0];

  if (!selectedTarget) return null;

  const candidateIndex = Math.floor((selectedTarget.goodIndex + selectedTarget.badIndex) / 2);
  const sha = session.orderedCommits[candidateIndex];
  if (!sha) return null;

  const targets = session.targets.filter((target) => (
    target.status === 'active'
    && target.goodIndex <= candidateIndex
    && candidateIndex <= target.badIndex
    && !target.observations[sha]
  ));

  return {
    sha,
    targetIds: targets.map((target) => target.id),
    categories: unique(targets.map((target) => target.category)),
    testFiles: unique(targets.map((target) => target.testFile)),
  };
}

export function applyObservations(
  session: BisectSession,
  sha: string,
  observations: Map<string, TargetObservation>,
): BisectSession {
  const commitIndex = session.orderedCommits.indexOf(sha);
  if (commitIndex === -1) throw new Error(`Unknown bisect commit: ${sha}`);

  return {
    ...session,
    targets: session.targets.map((target) => {
      const observation = observations.get(target.id);
      if (!observation || target.status !== 'active') return target;

      const updatedTarget = {
        ...target,
        observations: {
          ...target.observations,
          [sha]: observation,
        },
        ...(observation.present ? { badIndex: commitIndex } : { goodIndex: commitIndex }),
      };

      if (updatedTarget.badIndex - updatedTarget.goodIndex !== 1) return updatedTarget;

      return {
        ...updatedTarget,
        status: 'found' as const,
        firstBadSha: session.orderedCommits[updatedTarget.badIndex],
      };
    }),
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
