/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { formatPoolProgress } from '../sticky-status';

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

const stage = {
  name: 'build_annotated_timeline',
  description: 'Prepare Lighthouse trace screenshots for the annotated timeline.',
  index: 2,
  total: 3,
  skipOption: '--skip-stages build_annotated_timeline',
};

describe('formatPoolProgress', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not invent an ETA before the stage has submitted worker tasks', () => {
    const output = stripAnsi(formatPoolProgress({
      startedAt: Date.now() - 60 * 60 * 1000,
      completed: 0,
      expectedTotal: null,
      parallelism: 8,
      active: 0,
      errors: 0,
    }, stage));

    expect(output).toContain('0 done');
    expect(output).toContain('ETA --:--');
  });

  it('bases ETA on the start time supplied by the stage progress snapshot', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:10.000Z'));

    const output = stripAnsi(formatPoolProgress({
      startedAt: Date.now() - 1_000,
      completed: 1,
      expectedTotal: 3,
      parallelism: 8,
      active: 1,
      errors: 0,
    }, stage));

    expect(output).toContain('1/3 done');
    expect(output).toContain('ETA 00m:02s');
  });
});
