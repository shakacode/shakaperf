/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementThrottling } from './run-metadata';

/** Older reports saved a list, sometimes with a separate entry for each side. */
export function savedThrottlingProfiles(
  saved: MeasurementThrottling | MeasurementThrottling[] | undefined,
): MeasurementThrottling[] {
  if (saved === undefined) return [];
  return Array.isArray(saved) ? saved : [saved];
}
