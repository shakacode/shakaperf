/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { measuredCommit, type MeasurementSide, type MeasurementMetadata } from './run-metadata';

export async function captureMeasurementStartMetadata(
  sides: readonly MeasurementSide[],
  urls: Readonly<Record<MeasurementSide, string>>,
): Promise<MeasurementMetadata> {
  const measuredAt = new Date().toISOString();
  const targets = await Promise.all(sides.map(async (side) => {
    const url = urls[side];
    return { side, url, commit: await measuredCommit(url) };
  }));
  return { measuredAt, targets };
}
