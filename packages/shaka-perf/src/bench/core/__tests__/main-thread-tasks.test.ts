/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describe, it, expect } from '@jest/globals';
import { countMainThreadTasks, rendererMainThreadEvents } from '../main-thread-tasks';

const MAIN = { pid: 1, tid: 10 };
const navigationStart = { name: 'navigationStart', ph: 'R', ts: 0, cat: 'blink.user_timing', ...MAIN };
// Durations are microseconds, as in Chrome traces.
const task = (ts: number, durUs: number, name = 'RunTask', where = MAIN) =>
  ({ name, ph: 'X', ts, dur: durUs, cat: 'disabled-by-default-devtools.timeline', ...where });

describe('countMainThreadTasks', () => {
  it('counts top-level tasks on the renderer main thread', () => {
    expect(countMainThreadTasks([navigationStart, task(0, 5_000), task(10_000, 2_000), task(20_000, 80_000)])).toBe(3);
  });

  it('does not count work nested inside a task', () => {
    const events = [
      navigationStart,
      task(0, 10_000),
      task(1_000, 4_000, 'FunctionCall'),
      task(2_000, 1_000), // a RunTask nested inside another task
    ];
    expect(countMainThreadTasks(events)).toBe(1);
    expect(rendererMainThreadEvents(events).map(({ event, depth }) => [event.name, depth]))
      .toEqual([['RunTask', 0], ['FunctionCall', 1], ['RunTask', 2]]);
  });

  it('ignores other threads, sub-millisecond noise, and non-timeline categories', () => {
    expect(countMainThreadTasks([
      navigationStart,
      task(0, 5_000, 'RunTask', { pid: 1, tid: 99 }), // compositor/worker thread
      task(10_000, 500), // 0.5ms
      { ...task(20_000, 5_000), cat: 'toplevel' },
      task(30_000, 5_000),
    ])).toBe(1);
  });

  it('is 0 when the trace has no navigationStart', () => {
    expect(countMainThreadTasks([task(0, 5_000)])).toBe(0);
  });
});
