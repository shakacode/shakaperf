/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { alignAnnotations, alignedMs, hasAlignmentGaps } from '../core/timeline-alignment';

describe('alignAnnotations', () => {
  it('delays the earlier side at each shared annotation and records the wait as a gap', () => {
    const control = [{ label: 'menu open', timeMs: 100 }, { label: 'checkout', timeMs: 300 }];
    const experiment = [{ label: 'menu open', timeMs: 150 }, { label: 'checkout', timeMs: 380 }];
    const a = alignAnnotations(control, experiment);

    expect(a.pairCount).toBe(2);
    expect(a.experiment.shifts).toEqual([]);
    expect(a.control.shifts).toEqual([{ fromMs: 100, offsetMs: 50 }, { fromMs: 300, offsetMs: 80 }]);
    expect(a.control.gaps).toEqual([{ startMs: 100, endMs: 150 }, { startMs: 350, endMs: 380 }]);

    expect(alignedMs(a.control, 100)).toBe(alignedMs(a.experiment, 150));
    expect(alignedMs(a.control, 300)).toBe(alignedMs(a.experiment, 380));
    expect(alignedMs(a.control, 99)).toBe(99);
    expect(alignedMs(a.control, 200)).toBe(250);
    expect(alignedMs(a.control, 1000)).toBe(1080);
    expect(hasAlignmentGaps(a)).toBe(true);
  });

  it('shifts whichever side is earlier per annotation', () => {
    const control = [{ label: 'a', timeMs: 100 }, { label: 'b', timeMs: 400 }];
    const experiment = [{ label: 'a', timeMs: 150 }, { label: 'b', timeMs: 300 }];
    const a = alignAnnotations(control, experiment);

    expect(a.control.shifts).toEqual([{ fromMs: 100, offsetMs: 50 }]);
    expect(a.experiment.shifts).toEqual([{ fromMs: 300, offsetMs: 150 }]);
    expect(a.experiment.gaps).toEqual([{ startMs: 300, endMs: 450 }]);
    expect(alignedMs(a.control, 400)).toBe(450);
    expect(alignedMs(a.experiment, 300)).toBe(450);
  });

  it('pairs annotations by label in order and skips the unmatched ones', () => {
    const control = [{ label: 'only-control', timeMs: 50 }, { label: 'shared', timeMs: 200 }];
    const experiment = [{ label: 'shared', timeMs: 260 }, { label: 'only-experiment', timeMs: 400 }];
    const a = alignAnnotations(control, experiment);

    expect(a.pairCount).toBe(1);
    expect(a.control.shifts).toEqual([{ fromMs: 200, offsetMs: 60 }]);
    expect(a.experiment.shifts).toEqual([]);
  });

  it('records no shift when both sides already line up', () => {
    const a = alignAnnotations([{ label: 'x', timeMs: 10 }], [{ label: 'x', timeMs: 10 }]);
    expect(a.pairCount).toBe(1);
    expect(hasAlignmentGaps(a)).toBe(false);
    expect(alignedMs(a.control, 500)).toBe(500);
  });
});
