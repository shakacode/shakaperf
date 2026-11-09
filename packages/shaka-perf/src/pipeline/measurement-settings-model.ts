/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Outcome } from './outcome';
import type { MeasurementThrottling } from './run-metadata';

function distinct<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function groupThrottling(settings: readonly MeasurementThrottling[]) {
  const groups = new Map<string, { setting: MeasurementThrottling; sides: Set<string> }>();
  for (const saved of settings) {
    if (saved.engine !== 'Lighthouse') continue;
    const setting = {
      engine: saved.engine,
      method: saved.method,
      cpuSlowdownMultiplier: saved.method === 'provided' ? undefined : saved.cpuSlowdownMultiplier,
      network: Object.fromEntries(Object.entries(saved.network).sort(([a], [b]) => a.localeCompare(b))),
    };
    const key = JSON.stringify(setting);
    const group = groups.get(key) ?? { setting, sides: new Set<string>() };
    if (saved.side) group.sides.add(saved.side);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface MeasurementSettingsModel {
  readonly counts: readonly { count: number; perSide: boolean }[];
  readonly throttling: ReturnType<typeof groupThrottling>;
  readonly sampleCount?: number;
}

/** Project saved settings without inferring values from today's config. */
export function buildMeasurementSettings(
  outcomes: readonly Outcome[],
  countOutcomes: readonly Outcome[] = outcomes,
  sampleCount?: number,
): MeasurementSettingsModel {
  const metadata = outcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : []);
  const countMetadata = countOutcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : []);
  return {
    counts: distinct(countMetadata.flatMap((saved) => saved.numberOfMeasurements === undefined ? [] : [{
      count: saved.numberOfMeasurements,
      perSide: saved.targets.length > 1,
    }])),
    throttling: groupThrottling(metadata.flatMap((saved) => saved.throttling ?? [])),
    sampleCount,
  };
}
