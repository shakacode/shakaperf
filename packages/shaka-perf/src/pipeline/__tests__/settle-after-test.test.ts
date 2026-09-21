/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { SETTLE_FINISHED_MARK, parseSettleAfterTestOption, settleAfterTest } from '../settle-after-test';

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

  it('annotates the settle period, waits it out, then marks the end', async () => {
    jest.useFakeTimers();
    const annotate = jest.fn(async () => {});
    const mark = jest.fn(async () => {});
    let done = false;
    const settling = settleAfterTest(1500, annotate, mark).then(() => { done = true; });

    await jest.advanceTimersByTimeAsync(0);
    expect(annotate).toHaveBeenCalledWith('settling 1.5s after the test');
    expect(mark).not.toHaveBeenCalled();
    expect(done).toBe(false);

    await jest.advanceTimersByTimeAsync(1500);
    await settling;
    expect(done).toBe(true);
    expect(mark.mock.calls).toEqual([[SETTLE_FINISHED_MARK]]);
    expect(annotate).toHaveBeenCalledTimes(1);
  });

  it('neither annotates nor waits when there is no settle period', async () => {
    const annotate = jest.fn(async () => {});
    const mark = jest.fn(async () => {});
    await settleAfterTest(undefined, annotate, mark);
    await settleAfterTest(0, annotate, mark);
    expect(annotate).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });
});
