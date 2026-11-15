/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { ArtifactScope } from '../artifact-store';
import type { RunMetadata } from '../run-metadata';
import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { MeasurementRecorder } from '../measurement-recorder';

it('keeps start metadata, reported samples, and returned snapshots independent', () => {
  const start: RunMetadata = {
    runId: 'run', viewport: DESKTOP_VIEWPORT,
    testSourcePath: new ArtifactScope('/report/unit', '/report').pathFor('test.ts'),
    command: 'compare', measuredAt: 'start', stages: [], categories: [], targets: [],
  };
  const settings = { engine: 'Lighthouse', method: 'simulate', network: { rttMs: 80 } };
  const recorder = new MeasurementRecorder();
  recorder.recordOptions({ compareRetries: 3, compareAttempts: 1 });
  recorder.recordOptions({ throttling: settings });
  const first = recorder.snapshot(start);

  settings.network.rttMs = 90;
  recorder.recordOptions({ compareAttempts: 2 });
  expect(first.compareAttempts).toBe(1);
  expect(first.throttling!.network.rttMs).toBe(80);
  first.throttling!.network.rttMs = 100;
  expect(recorder.snapshot(start)).toEqual({
    ...start, compareRetries: 3, compareAttempts: 2,
    throttling: { engine: 'Lighthouse', method: 'simulate', network: { rttMs: 80 } },
  });
  expect(start).not.toHaveProperty('compareAttempts');
  expect(start).not.toHaveProperty('throttling');
});
