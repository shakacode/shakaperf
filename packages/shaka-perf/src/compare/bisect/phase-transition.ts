/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectSearchPhase } from './types';

export type PhaseTransitionEvent =
  | 'phase-started'
  | 'group-started'
  | 'attempt-started'
  | 'candidate-classified'
  | 'group-split'
  | 'group-completed'
  | 'attempt-incomplete'
  | 'phase-completed';

export interface PhaseTransition {
  event: PhaseTransitionEvent;
  phase: BisectSearchPhase;
  details?: Record<string, unknown>;
}
