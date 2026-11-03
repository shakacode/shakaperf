/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/** The trace-event fields needed to find renderer main-thread work. */
export interface MainThreadTraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid?: number;
  tid?: number;
  cat?: string;
}

/** Main-thread events shorter than this are dropped as noise. */
export const MIN_MAIN_TASK_MS = 1;

/**
 * Every `devtools.timeline` complete event on the renderer main thread — the
 * process/thread that emitted navigationStart (CrRendererMain) — with its
 * nesting depth: Task, Evaluate Script, Function Call, Layout, Paint, GC, …
 * They nest by time containment, so a stack of ancestor end times gives each
 * one its depth. Sub-MIN_MAIN_TASK_MS events are dropped as noise; a child
 * can't outlast its parent, so the filter never strands a descendant above a
 * dropped ancestor and depths stay gap-free. UserTiming marks/measures are
 * excluded. Returned in start order, parents before their children.
 */
export function rendererMainThreadEvents<E extends MainThreadTraceEvent>(
  events: readonly E[],
): { event: E; depth: number }[] {
  const navStart = events.find((e) => e.name === 'navigationStart');
  if (!navStart) return [];

  const raw = events.filter((e) =>
    e.ph === 'X' && e.dur != null && e.dur / 1000 >= MIN_MAIN_TASK_MS &&
    e.pid === navStart.pid && e.tid === navStart.tid &&
    (e.cat ?? '').includes('devtools.timeline') &&
    !e.name.startsWith('UserTiming'));
  // Start asc, then end desc so a parent is processed before the children it
  // contains (and thus sits on the stack when they compute their depth).
  raw.sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);

  const nested: { event: E; depth: number }[] = [];
  const ancestorEnds: number[] = [];
  for (const event of raw) {
    while (ancestorEnds.length && ancestorEnds[ancestorEnds.length - 1] <= event.ts) ancestorEnds.pop();
    nested.push({ event, depth: ancestorEnds.length });
    ancestorEnds.push(event.ts + event.dur!);
  }
  return nested;
}

/**
 * Top-level tasks on the renderer main thread over the whole trace — the
 * `js-tasks` metric, and what the timeline comparison's "JS tasks" chip counts.
 */
export function countMainThreadTasks(events: readonly MainThreadTraceEvent[]): number {
  return rendererMainThreadEvents(events)
    .filter(({ event, depth }) => event.name === 'RunTask' && depth === 0)
    .length;
}
