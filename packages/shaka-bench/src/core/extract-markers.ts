import type { LighthouseResult } from 'lighthouse';

import type { Marker, PhaseSample } from './lighthouse-config';

// Ligthouse applies some scaling factor to performance profiles.
// All performance.mark and performance.measure calls should be multiplied by this factor.
// Unfortunatly it's not exposed in the Lighthouse API.
// This is a manually determined value roughly representing the correct ratio.
const LIGHTHOUSE_SLOWDOWN_MULTIPLYER = 15;

function extractPerformanceMarkerTime(
  result: LighthouseResult,
  markerName: string
): number | null {
  const traceEvents = result.artifacts.traces.defaultPass.traceEvents;
  const event = traceEvents.find((event) => event.name === markerName);
  if (!event) {
    return null;
  }
  return event.args.data.startTime * LIGHTHOUSE_SLOWDOWN_MULTIPLYER;
}

function extractPerformanceDuration(
  result: LighthouseResult,
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

export function extractMarkers(
  result: LighthouseResult,
  markers: Marker[],
  prefix: string
): PhaseSample[] {
  const results: PhaseSample[] = [];

  for (const marker of markers) {
    if (marker.start) {
      const duration = extractPerformanceDuration(
        result,
        marker.start,
        marker.end
      );
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
