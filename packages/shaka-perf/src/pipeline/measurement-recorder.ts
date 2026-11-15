/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementOptions, RunMetadata } from './run-metadata';

export class MeasurementRecorder {
  private readonly options: MeasurementOptions = {};

  recordOptions(options: MeasurementOptions): void {
    Object.assign(this.options, structuredClone(options));
  }

  snapshot(measurementStart: RunMetadata): RunMetadata {
    return { ...measurementStart, ...structuredClone(this.options) };
  }
}
