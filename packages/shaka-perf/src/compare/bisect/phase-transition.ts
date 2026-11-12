/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaStack-1.0-ShakaPerf
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import type { BisectSearchPhase, CommitRun } from './types';

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
  commitRun?: CommitRun;
  details?: Record<string, unknown>;
}
