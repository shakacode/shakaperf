/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { measuredCommit, type MeasurementSide, type RunMetadata } from './run-metadata';

export type MeasurementInvocation = Pick<RunMetadata, 'command' | 'stages' | 'categories'> & {
  readonly sides: readonly MeasurementSide[];
};

export async function captureMeasurementStartMetadata(
  { command, stages, categories, sides }: MeasurementInvocation,
  urls: Readonly<Record<MeasurementSide, string>>,
) {
  const measuredAt = new Date().toISOString();
  const targets = await Promise.all(sides.map(async (side) => {
    const url = urls[side];
    return { side, url, commit: await measuredCommit(url) };
  }));
  return { command, stages, categories, measuredAt, targets };
}
