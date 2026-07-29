/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  getLatestTestAnnotation,
  messageWithLatestTestAnnotation,
  runWithLastAnnotation,
  MAX_ANNOTATION_LENGTH,
  stackWithLatestTestAnnotation,
} from '../index';

describe('runWithLastAnnotation', () => {
  it('rejects an annotation longer than the limit, citing the UX report', async () => {
    const tooLong = 'x'.repeat(MAX_ANNOTATION_LENGTH + 1);
    await expect(
      runWithLastAnnotation(async (annotate) => {
        await annotate(tooLong);
      }),
    ).rejects.toThrow(/UX report/);
  });

  it('reports the offending length and the limit in the error message', async () => {
    const tooLong = 'x'.repeat(MAX_ANNOTATION_LENGTH + 5);
    await expect(
      runWithLastAnnotation(async (annotate) => {
        await annotate(tooLong);
      }),
    ).rejects.toThrow(
      `is ${MAX_ANNOTATION_LENGTH + 5} characters; the limit is ${MAX_ANNOTATION_LENGTH}`,
    );
  });

  it('accepts a label exactly at the limit', async () => {
    const atLimit = 'x'.repeat(MAX_ANNOTATION_LENGTH);
    const result = await runWithLastAnnotation(async (annotate) => {
      await annotate(atLimit);
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('does not invoke onAnnotate for an over-long label', async () => {
    const onAnnotate = jest.fn(async () => {});
    await expect(
      runWithLastAnnotation(
        async (annotate) => {
          await annotate('y'.repeat(MAX_ANNOTATION_LENGTH + 1));
        },
        onAnnotate,
      ),
    ).rejects.toThrow();
    expect(onAnnotate).not.toHaveBeenCalled();
  });

  it('attaches the last valid label to a body failure', async () => {
    await expect(
      runWithLastAnnotation(async (annotate) => {
        await annotate('clicking checkout');
        throw new Error('boom');
      }),
    ).rejects.toMatchObject({
      name: 'Error',
      message: 'boom',
      lastAnnotation: 'clicking checkout',
    });
  });

  it('returns the body result when no annotation is over the limit', async () => {
    const result = await runWithLastAnnotation(async (annotate) => {
      await annotate('step one');
      await annotate('step two');
      return 42;
    });
    expect(result).toBe(42);
  });
});

describe('test annotation formatting', () => {
  it('adds the latest annotation to formatted messages and stacks only once', () => {
    const err = new Error('original');
    err.stack = [
      'Error: original',
      '    at testStep (ab-tests/cart.abtest.ts:42:7)',
    ].join('\n');
    Object.defineProperty(err, 'lastAnnotation', {
      value: 'last step',
      configurable: true,
    });

    const label = getLatestTestAnnotation(err);
    const wrapped = new Error('wrapper');
    Object.defineProperty(wrapped, 'cause', {
      value: err,
      configurable: true,
    });

    expect(messageWithLatestTestAnnotation(err.message, label)).toBe('original (latest test annotation: "last step")');
    expect(stackWithLatestTestAnnotation(err, label)).toBe([
      'Error: original (latest test annotation: "last step")',
      '    at testStep (ab-tests/cart.abtest.ts:42:7)',
    ].join('\n'));
    expect(
      messageWithLatestTestAnnotation('original (latest test annotation: "last step")', label),
    ).toBe('original (latest test annotation: "last step")');
    expect(getLatestTestAnnotation(wrapped)).toBe('last step');
  });

  it('does not duplicate multi-line Playwright call logs when annotating a stack', () => {
    const err = new Error([
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
    ].join('\n'));
    err.stack = [
      'page.waitForSelector: Timeout 30000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'[role="dialog"]\') to be visible',
      '',
      '    at Object._testFn (ab-tests/cart.abtest.ts:54:16)',
    ].join('\n');

    const formatted = stackWithLatestTestAnnotation(err, 'adding Curly Fries')!;

    expect(formatted).toContain('page.waitForSelector: Timeout 30000ms exceeded. (latest test annotation: "adding Curly Fries")');
    expect(formatted.match(/Call log:/g)).toHaveLength(1);
    expect(formatted).toContain('at Object._testFn (ab-tests/cart.abtest.ts:54:16)');
  });
});
