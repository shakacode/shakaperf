/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { attachLatestTestAnnotation } from '../../test-annotation';
import { findLastAnnotation, StageFailureError } from '../stage-failure';

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
