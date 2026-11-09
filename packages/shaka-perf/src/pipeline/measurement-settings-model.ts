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

export interface MeasurementSettingsModel {
  readonly counts: readonly { count: number; perSide: boolean }[];
  readonly throttling?: Omit<MeasurementThrottling, 'side'>;
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
  // The runner rejects mismatched control/experiment settings. One saved
  // configuration describes this artifact; side-specific report rows are invalid.
  const throttling = metadata.flatMap((saved) => saved.throttling ?? [])
    .find((setting) => setting.engine === 'Lighthouse');
  return {
    counts: distinct(countMetadata.flatMap((saved) => saved.numberOfMeasurements === undefined ? [] : [{
      count: saved.numberOfMeasurements,
      perSide: saved.targets.length > 1,
    }])),
    throttling: throttling ? {
      engine: throttling.engine,
      method: throttling.method,
      cpuSlowdownMultiplier: throttling.method === 'provided' ? undefined : throttling.cpuSlowdownMultiplier,
      network: throttling.network,
    } : undefined,
    sampleCount,
  };
}
