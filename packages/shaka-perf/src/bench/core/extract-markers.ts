/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RunnerResult } from 'lighthouse';

import type { Marker, PhaseSample } from './lighthouse-config';

function extractPerformanceMarkerTime(
  result: RunnerResult,
  markerName: string
): number | null {
  const traceEvents = result.artifacts.Trace.traceEvents;
  const event = traceEvents.find((event: any) => event.name === markerName);
  if (!event) {
    return null;
  }
  return event.args.data!.startTime!;
}

function extractPerformanceDuration(
  result: RunnerResult,
  startMarker: string,
  endMarker: string
): number | null {
  const startTime = extractPerformanceMarkerTime(result, startMarker);
  const endTime = extractPerformanceMarkerTime(result, endMarker);
  if (startTime === null || endTime === null) {
    return null;
  }
  return endTime - startTime;
}

/**
 * Returns the raw trace event `ts` (microseconds, monotonic clock) for a given
 * performance mark name. This is in the same clock domain as devtools log timestamps
 * (which are in seconds). Convert: ts / 1_000_000 = seconds.
 */
export function extractRawTraceTimestamp(
  result: RunnerResult,
  markerName: string
): number | null {
  const traceEvents = result.artifacts.Trace.traceEvents;
  const event = traceEvents.find((event: any) => event.name === markerName);
  if (!event) {
    return null;
  }
  return (event as any).ts ?? null;
}

/**
 * Returns the raw trace `ts` (microseconds, monotonic clock — same domain as
 * devtools-log seconds, i.e. `ts / 1_000_000`) of the page's Largest Contentful
 * Paint: the LAST `largestContentfulPaint::Candidate` trace event, since LCP is
 * the final candidate. Returns null if the page emitted no LCP candidate. Used
 * as the cutoff for the "before LCP" network metrics.
 */
export function extractLcpRawTraceTimestamp(
  result: RunnerResult
): number | null {
  const traceEvents = result.artifacts.Trace.traceEvents;
  let lcpTs: number | null = null;
  for (const event of traceEvents) {
    if ((event as any).name === 'largestContentfulPaint::Candidate' && (event as any).ts != null) {
      lcpTs = (event as any).ts;
    }
  }
  return lcpTs;
}

export function extractMarkers(
  result: RunnerResult,
  markers: Marker[],
  prefix: string
): PhaseSample[] {
  const results: PhaseSample[] = [];

  for (const marker of markers) {
    if (marker.start) {
      const duration = extractPerformanceDuration(result, marker.start, marker.end);
      if (duration != null) {
        results.push({
          phase: prefix + marker.label,
          duration: duration * 1000,
          sign: 1,
          start: 0,
          unit: 'ms'
        });
      }
    } else {
      const time = extractPerformanceMarkerTime(result, marker.end);
      if (time != null) {
        results.push({
          phase: prefix + marker.label,
          duration: time * 1000,
          sign: 1,
          start: 0,
          unit: 'ms'
        });
      }
    }
  }

  return results;
}
