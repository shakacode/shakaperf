/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { attachLatestTestAnnotation } from '../../test-annotation';
import { findFailureArtifacts, findLastAnnotation, StageFailureError } from '../stage-failure';

describe('StageFailureError', () => {
  it('surfaces the underlying cause stack without wrapper frames', () => {
    const cause = new Error('Failed while waiting for cart drawer');
    cause.stack = [
      'Error: Failed while waiting for cart drawer',
      '    at waitForCartDrawer (ab-tests/popmenu-order-checkout.abtest.ts:47:11)',
      '    at async addToCart (ab-tests/popmenu-order-checkout.abtest.ts:32:3)',
    ].join('\n');

    const err = new StageFailureError(cause, { media: 'data:image/png;base64,abc' });

    expect(err.message).toBe('Failed while waiting for cart drawer');
    expect(err.stack).toBe(`StageFailureError: Failed while waiting for cart drawer\nCaused by: ${cause.stack}`);
    expect(err.stack).toContain('at waitForCartDrawer (ab-tests/popmenu-order-checkout.abtest.ts:47:11)');
    expect(err.stack).not.toContain('at StageFailureError');
  });

  it('finds the latest test annotation attached by the framework through wrapper errors', () => {
    const cause = new Error('Failed while waiting for the validation result');
    cause.stack = [
      'Error: Failed while waiting for the validation result',
      '    at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)',
    ].join('\n');
    attachLatestTestAnnotation(cause, 'Submit cart');

    const err = new StageFailureError(cause, { media: 'data:image/png;base64,abc' });

    expect(err.message).toBe('Failed while waiting for the validation result');
    expect(findLastAnnotation(err)).toBe('Submit cart');
    expect(err.stack).toContain('at waitForValidation (ab-tests/popmenu-order-cart.abtest.ts:101:9)');
  });

  it('finds the failure artifacts on a bare StageFailureError', () => {
    const err = new StageFailureError(new Error('boom'), { media: 'data:image/png;base64,abc' });

    expect(findFailureArtifacts(err)?.media).toBe('data:image/png;base64,abc');
  });

  it('finds the failure artifacts through the worker pool\'s poison wrapper', () => {
    // A stage that throws from inside a pool task has its StageFailureError
    // wrapped once the retry budget is spent. An `instanceof` check on the
    // outer error drops the media — which is how visreg failures reached the
    // report with no error screenshot.
    const stageFailure = new StageFailureError(new Error('page.waitForSelector: Timeout'), {
      media: 'data:image/png;base64,abc',
    });
    const poison = new Error('worker 0 exhausted 1 consecutive attempts; cancelling test+viewport', {
      cause: stageFailure,
    });

    expect(poison instanceof StageFailureError).toBe(false);
    expect(findFailureArtifacts(poison)?.media).toBe('data:image/png;base64,abc');
  });

  it('returns undefined when nothing in the chain carries artifacts', () => {
    expect(findFailureArtifacts(new Error('plain'))).toBeUndefined();
    expect(findFailureArtifacts(new Error('outer', { cause: new Error('inner') }))).toBeUndefined();
  });

  it('keeps multi-line Playwright call logs only in the cause stack', () => {
    const cause = new Error([
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
    ].join('\n'));
    cause.stack = [
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
      '',
      '    at Object._testFn (ab-tests/cart.abtest.ts:54:16)',
    ].join('\n');

    const err = new StageFailureError(cause, { media: 'data:image/png;base64,abc' });

    expect(err.stack).toContain('StageFailureError: page.waitForSelector: Timeout 30000ms exceeded.');
    expect(err.stack?.match(/Call log:/g)).toHaveLength(1);
    expect(err.stack).toContain('at Object._testFn (ab-tests/cart.abtest.ts:54:16)');
  });
});
