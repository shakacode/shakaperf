/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementOptions, MeasurementThrottling, RunMetadata } from './run-metadata';

function copyThrottling(settings: MeasurementThrottling): MeasurementThrottling {
  return { ...settings, network: { ...settings.network } };
}

export class MeasurementRecorder {
  private readonly options: MeasurementOptions = {};
  private throttling?: MeasurementThrottling;

  recordOptions(options: MeasurementOptions): void {
    Object.assign(this.options, options);
  }

  recordThrottling(settings: MeasurementThrottling): void {
    this.throttling = copyThrottling(settings);
  }

  snapshot(measurementStart: RunMetadata): RunMetadata {
    return {
      ...measurementStart,
      ...this.options,
      ...(this.throttling ? { throttling: [copyThrottling(this.throttling)] } : {}),
    };
  }
}
