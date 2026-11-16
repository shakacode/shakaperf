/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { MeasurementRecorder } from '../measurement-recorder';

it('keeps start metadata, reported samples, and returned snapshots independent', () => {
  const start = { command: 'compare', measuredAt: 'start', targets: [] };
  const settings = { engine: 'Lighthouse', method: 'simulate', network: { rttMs: 80 } };
  const recorder = new MeasurementRecorder();
  recorder.recordOptions({ throttling: settings, numberOfMeasurements: 2 });
  const first = recorder.snapshot(start);
  settings.network.rttMs = 90;
  recorder.recordOptions({ numberOfMeasurements: 3 });
  expect(first.numberOfMeasurements).toBe(2);
  expect(first.throttling!.network.rttMs).toBe(80);
  first.throttling!.network.rttMs = 100;
  expect(recorder.snapshot(start)).toEqual({
    ...start, numberOfMeasurements: 3,
    throttling: { engine: 'Lighthouse', method: 'simulate', network: { rttMs: 80 } },
  });
  expect(start).not.toHaveProperty('throttling');
});
