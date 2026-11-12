/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import { parseOutcome } from '../src/pipeline/outcome';

it('reads the canonical execution record without converting old fields', () => {
  const saved = {
    kind: 'ok', stage: 'visreg',
    executionDetails: { viewport: DESKTOP_VIEWPORT, testSourcePath: null, runId: 'fixture-run', taskRetries: 1, taskRetryLimit: 2, recoveredAfterRetries: true },
  };
  expect(parseOutcome(JSON.stringify(saved))).toEqual(saved);
});
