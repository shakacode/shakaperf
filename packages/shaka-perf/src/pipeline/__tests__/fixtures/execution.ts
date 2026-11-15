/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT } from 'shaka-shared';
import type { ExecutionDetails } from '../../outcome';

export function executionFixture(overrides: Partial<ExecutionDetails> = {}): { executionDetails: ExecutionDetails } {
  return {
    executionDetails: {
      runId: 'fixture-run',
      viewport: DESKTOP_VIEWPORT,
      testSourceHref: null,
      recoveredAfterRetries: false,
      ...overrides,
    },
  };
}
