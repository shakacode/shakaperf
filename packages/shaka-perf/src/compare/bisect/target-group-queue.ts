/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectTargetGroup } from './types';

/** Owns deterministic target-group ordering and the unique pending-range invariant. */
export class TargetGroupQueue {
  private readonly groups: BisectTargetGroup[];

  constructor(groups: readonly BisectTargetGroup[]) {
    this.groups = groups.map((group) => ({
      ...group,
      targetIds: [...group.targetIds],
      decisions: [...group.decisions],
    }));
    this.assertUniquePendingRanges();
  }

  add(group: BisectTargetGroup): void {
    if (group.status === 'pending' && this.hasPendingRange(group)) {
      throw duplicateRangeError(group);
    }
    this.groups.push({
      ...group,
      targetIds: [...group.targetIds],
      decisions: [...group.decisions],
    });
  }

  addAll(groups: readonly BisectTargetGroup[]): void {
    for (const group of groups) this.add(group);
  }

  next(): BisectTargetGroup | undefined {
    return this.groups.find((group) => group.status === 'running')
      ?? this.groups.find((group) => group.status === 'pending');
  }

  values(): BisectTargetGroup[] {
    return this.groups.map((group) => ({
      ...group,
      targetIds: [...group.targetIds],
      decisions: [...group.decisions],
    }));
  }

  private hasPendingRange(group: BisectTargetGroup): boolean {
    return this.groups.some((candidate) => (
      candidate.status === 'pending'
      && candidate.goodSha === group.goodSha
      && candidate.badSha === group.badSha
    ));
  }

  private assertUniquePendingRanges(): void {
    const ranges = new Set<string>();
    for (const group of this.groups.filter(({ status }) => status === 'pending')) {
      const key = JSON.stringify([group.goodSha, group.badSha]);
      if (ranges.has(key)) throw duplicateRangeError(group);
      ranges.add(key);
    }
  }
}

function duplicateRangeError(group: BisectTargetGroup): Error {
  return new Error(
    `Bisect scheduler invariant violated: duplicate pending range `
    + `${group.goodSha}..${group.badSha}`,
  );
}
