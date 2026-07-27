/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  findVisregSideFailure,
  VisregSideFailure,
} from '../side-failure';

describe('VisregSideFailure', () => {
  it('preserves the original error as its cause and records side metadata', () => {
    const cause = new Error('experiment prepare failed');
    const failure = new VisregSideFailure(
      'experiment',
      cause,
      '/tmp/failure-experiment.png',
    );

    expect(failure).toMatchObject({
      name: 'VisregSideFailure',
      message: 'experiment prepare failed',
      side: 'experiment',
      screenshotPath: '/tmp/failure-experiment.png',
      cause,
    });
  });

  it('finds a side failure through wrapper causes', () => {
    const failure = new VisregSideFailure('control', new Error('boom'));
    const wrapper = new Error('outer', { cause: failure });

    expect(findVisregSideFailure(wrapper)).toBe(failure);
  });

  it('keeps the original stack for report formatting', () => {
    const cause = new Error('test body failed');
    cause.stack = [
      'Error: test body failed',
      '    at scenario._testFn (ab-tests/cart.abtest.ts:42:7)',
    ].join('\n');

    const failure = new VisregSideFailure('experiment', cause);

    expect(failure.stack).toBe(cause.stack);
  });

  it('returns undefined for cyclic cause chains without side metadata', () => {
    const error = new Error('cycle') as Error & { cause?: unknown };
    error.cause = error;

    expect(findVisregSideFailure(error)).toBeUndefined();
  });
});
