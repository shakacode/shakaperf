/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseSettleAfterTestOption, settleAfterTest } from '../settle-after-test';

describe('parseSettleAfterTestOption', () => {
  it('is off when the flag is absent', () => {
    expect(parseSettleAfterTestOption(undefined)).toBeUndefined();
  });

  it('turns seconds into milliseconds, fractions included', () => {
    expect(parseSettleAfterTestOption('0')).toBe(0);
    expect(parseSettleAfterTestOption('2')).toBe(2000);
    expect(parseSettleAfterTestOption('1.5')).toBe(1500);
  });

  it('rejects a value that would silently mean no settling', () => {
    for (const bad of ['', 'abc', '-1', 'Infinity']) {
      expect(() => parseSettleAfterTestOption(bad)).toThrow('--seconds-to-settle-after-test');
    }
  });
});

describe('settleAfterTest', () => {
  afterEach(() => jest.useRealTimers());

  it('annotates the settle period, then waits it out', async () => {
    jest.useFakeTimers();
    const annotate = jest.fn(async () => {});
    let done = false;
    const settling = settleAfterTest(1500, annotate).then(() => { done = true; });

    await jest.advanceTimersByTimeAsync(0);
    expect(annotate).toHaveBeenCalledWith('settling 1.5s after the test');
    expect(done).toBe(false);

    await jest.advanceTimersByTimeAsync(1500);
    await settling;
    expect(done).toBe(true);
  });

  it('neither annotates nor waits when there is no settle period', async () => {
    const annotate = jest.fn(async () => {});
    await settleAfterTest(undefined, annotate);
    await settleAfterTest(0, annotate);
    expect(annotate).not.toHaveBeenCalled();
  });
});
