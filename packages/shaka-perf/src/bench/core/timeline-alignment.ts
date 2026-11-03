/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface AnnotationPoint {
  label: string;
  timeMs: number;
}

export interface AlignmentShift {
  /** Raw time from which `offsetMs` applies (until the next shift). */
  fromMs: number;
  offsetMs: number;
}

export interface AlignmentGap {
  /** Aligned-time span this side spends waiting for the other side. */
  startMs: number;
  endMs: number;
}

export interface SideAlignment {
  shifts: AlignmentShift[];
  gaps: AlignmentGap[];
}

export interface TimelineAlignment {
  control: SideAlignment;
  experiment: SideAlignment;
  /** Number of annotations matched on both sides. */
  pairCount: number;
}

/**
 * Line the two sides up at every test annotation both of them hit. Annotations
 * are paired by label in time order. At each pair the side that arrived earlier
 * is delayed so the annotation lands at the same aligned time as on the other
 * side; everything after it on that side shifts by the same amount, and the
 * empty stretch it waited through is recorded as a gap. Offsets only ever grow,
 * so the aligned time of any side is monotonic in its raw time.
 */
export function alignAnnotations(
  control: readonly AnnotationPoint[],
  experiment: readonly AnnotationPoint[],
): TimelineAlignment {
  const c: SideAlignment = { shifts: [], gaps: [] };
  const e: SideAlignment = { shifts: [], gaps: [] };
  let offsetC = 0;
  let offsetE = 0;
  let pairCount = 0;
  let nextE = 0;
  for (const point of control) {
    const match = experiment.findIndex((p, i) => i >= nextE && p.label === point.label);
    if (match === -1) continue;
    nextE = match + 1;
    pairCount++;
    const alignedC = point.timeMs + offsetC;
    const alignedE = experiment[match].timeMs + offsetE;
    if (alignedC < alignedE) {
      c.gaps.push({ startMs: alignedC, endMs: alignedE });
      offsetC += alignedE - alignedC;
      c.shifts.push({ fromMs: point.timeMs, offsetMs: offsetC });
    } else if (alignedE < alignedC) {
      e.gaps.push({ startMs: alignedE, endMs: alignedC });
      offsetE += alignedC - alignedE;
      e.shifts.push({ fromMs: experiment[match].timeMs, offsetMs: offsetE });
    }
  }
  return { control: c, experiment: e, pairCount };
}

export function alignedMs(side: SideAlignment, rawMs: number): number {
  let offset = 0;
  for (const shift of side.shifts) {
    if (shift.fromMs > rawMs) break;
    offset = shift.offsetMs;
  }
  return rawMs + offset;
}

export function hasAlignmentGaps(alignment: TimelineAlignment): boolean {
  return alignment.control.gaps.length > 0 || alignment.experiment.gaps.length > 0;
}
