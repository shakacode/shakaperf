/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { TargetGroupQueue } from '../target-group-queue';
import type { BisectTargetGroup } from '../types';

function group(
  id: string,
  goodSha: string,
  badSha: string,
  status: BisectTargetGroup['status'] = 'pending',
): BisectTargetGroup {
  return { id, goodSha, badSha, status, targetIds: [id], decisions: [] };
}

describe('TargetGroupQueue', () => {
  it('selects a running group before pending work while preserving order', () => {
    const queue = new TargetGroupQueue([
      group('pending-1', 'a', 'b'),
      group('running', 'c', 'd', 'running'),
      group('pending-2', 'e', 'f'),
    ]);

    expect(queue.next()?.id).toBe('running');
    expect(queue.values().map(({ id }) => id)).toEqual(['pending-1', 'running', 'pending-2']);
  });

  it('rejects duplicate pending ranges during construction', () => {
    expect(() => new TargetGroupQueue([
      group('one', 'good', 'bad'),
      group('two', 'good', 'bad'),
    ])).toThrow(/duplicate pending range good\.\.bad/i);
  });

  it('rejects duplicate pending ranges during insertion', () => {
    const queue = new TargetGroupQueue([group('one', 'good', 'bad')]);

    expect(() => queue.add(group('two', 'good', 'bad')))
      .toThrow(/duplicate pending range good\.\.bad/i);
  });

  it('allows completed and running groups to retain historical identical ranges', () => {
    expect(() => new TargetGroupQueue([
      group('complete', 'good', 'bad', 'complete'),
      group('running', 'good', 'bad', 'running'),
      group('pending', 'good', 'bad', 'pending'),
    ])).not.toThrow();
  });
});
