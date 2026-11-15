/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { isDeepStrictEqual } from 'node:util';
import type { MeasurementOptions, MeasurementThrottling, RunMetadata } from './run-metadata';

function copyThrottling(settings: MeasurementThrottling): MeasurementThrottling {
  return { ...settings, network: { ...settings.network } };
}

export class MeasurementRecorder {
  private readonly options: MeasurementOptions = {};
  private readonly throttling: MeasurementThrottling[] = [];

  recordOptions(options: MeasurementOptions): void {
    Object.assign(this.options, options);
  }

  recordThrottling(settings: MeasurementThrottling): void {
    if (settings.engine === 'Lighthouse' && settings.side) {
      const { side, ...effective } = settings;
      for (const { side: recordedSide, ...recorded } of this.throttling) {
        if (recorded.engine === 'Lighthouse' && recordedSide && recordedSide !== side && !isDeepStrictEqual(recorded, effective)) {
          throw new Error('Lighthouse throttling must match between control and experiment. The performance comparison is invalid.');
        }
      }
    }
    if (!this.throttling.some((entry) => JSON.stringify(entry) === JSON.stringify(settings))) {
      this.throttling.push(copyThrottling(settings));
    }
  }

  snapshot(measurementStart: RunMetadata): RunMetadata {
    return {
      ...measurementStart,
      ...this.options,
      ...(this.throttling.length ? { throttling: this.throttling.map(copyThrottling) } : {}),
    };
  }
}
