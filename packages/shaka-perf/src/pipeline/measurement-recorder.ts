/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementOptions, RunMetadata } from './run-metadata';

export class MeasurementRecorder {
  private readonly options: MeasurementOptions = {};
  private taskRetryCount = 0;

  get taskRetries(): number {
    return this.taskRetryCount;
  }

  recordTaskRetry(): void {
    this.taskRetryCount += 1;
  }

  recordOptions(options: MeasurementOptions): void {
    Object.assign(this.options, structuredClone(options));
  }

  snapshot(measurementStart: RunMetadata): { runMetadata: RunMetadata } {
    return { runMetadata: { ...measurementStart, ...structuredClone(this.options) } };
  }
}
