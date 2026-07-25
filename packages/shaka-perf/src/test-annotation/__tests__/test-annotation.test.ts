/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  createTestAnnotate,
  getLatestTestAnnotation,
  messageWithLatestTestAnnotation,
  runWithLastAnnotation,
  runWithTestAnnotationContext,
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

describe('runWithTestAnnotationContext isolation', () => {
  // Mirrors the visreg engine: a stage-level context wraps two sibling bodies
  // (control + experiment) prepared concurrently, each with its own annotate.
  // A shared single-slot store would let the side that runs its annotate() last
  // stamp the other side's failure — the exact cross-side bleed this guards.
  const runSide = (steps: string[], shouldThrow: boolean): Promise<void> =>
    runWithTestAnnotationContext(async () => {
      const annotate = createTestAnnotate();
      for (const step of steps) {
        await annotate(step);
        await Promise.resolve(); // yield so the sibling interleaves
      }
      if (shouldThrow) throw new Error('experiment side failed');
    });

  it('attaches each concurrent body its own last annotation, not its sibling’s', async () => {
    const [failing] = await runWithTestAnnotationContext(() =>
      Promise.allSettled([
        runSide(['adding Curly Fries', 'clicking Add to order'], true),
        runSide(['edit special request', 'clicking Update to write back'], false),
      ]),
    );

    expect(failing.status).toBe('rejected');
    const { reason } = failing as PromiseRejectedResult;
    expect(getLatestTestAnnotation(reason)).toBe('clicking Add to order');
  });

  it('attaches the right last annotation when both concurrent bodies throw', async () => {
    let annotated = 0;
    let releaseBothAnnotated!: () => void;
    const bothAnnotated = new Promise<void>((resolve) => {
      releaseBothAnnotated = resolve;
    });
    const runThrowingSide = (label: string, message: string): Promise<void> =>
      runWithTestAnnotationContext(async () => {
        const annotate = createTestAnnotate();
        await annotate(label);
        annotated++;
        if (annotated === 2) releaseBothAnnotated();
        await bothAnnotated;
        throw new Error(message);
      });

    const [control, experiment] = await runWithTestAnnotationContext(() =>
      Promise.allSettled([
        runThrowingSide('control final step', 'control side failed'),
        runThrowingSide('experiment final step', 'experiment side failed'),
      ]),
    );

    expect(control.status).toBe('rejected');
    expect(experiment.status).toBe('rejected');
    expect(getLatestTestAnnotation((control as PromiseRejectedResult).reason)).toBe('control final step');
    expect(getLatestTestAnnotation((experiment as PromiseRejectedResult).reason)).toBe('experiment final step');
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
