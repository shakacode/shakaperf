/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, type Viewport } from 'shaka-shared';
import type { Outcome } from '../../outcome';

type ExecutionOverrides = Pick<Outcome, 'runId' | 'recoveredAfterRetries'> & { viewport?: Viewport };

export function executionFixture(overrides: ExecutionOverrides = {}) {
  return { viewport: DESKTOP_VIEWPORT, ...overrides };
}
