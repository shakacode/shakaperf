/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseSettleAfterTestOption } from '../settle-after-test';

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
