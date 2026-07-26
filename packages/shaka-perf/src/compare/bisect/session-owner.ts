/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PhaseTransition } from './phase-transition';
import type { BisectSession } from './types';

export interface BisectSessionPersistence {
  write(session: BisectSession): Promise<void>;
}

export interface BisectReportWriter {
  write(session: BisectSession): Promise<void>;
}

export interface BisectTransitionLogger {
  record(transition: PhaseTransition, session: BisectSession): Promise<void>;
}

export interface CompareBisectSessionCollaborators {
  persistence: BisectSessionPersistence;
  reports: BisectReportWriter;
  transitions: BisectTransitionLogger;
}

/**
 * Owns the authoritative in-memory session and the ordering of every durable
 * phase transition. Phase runners never receive these collaborators directly.
 */
export class CompareBisectSession {
  constructor(
    private session: BisectSession,
    private readonly collaborators: CompareBisectSessionCollaborators,
  ) {}

  current(): BisectSession {
    return this.session;
  }

  /** Installs orchestration state that will be committed by its owning workflow. */
  replace(next: BisectSession): void {
    this.session = next;
  }

  async commit(transition: PhaseTransition, next: BisectSession): Promise<void> {
    this.session = next;
    await this.collaborators.persistence.write(next);
    await this.collaborators.transitions.record(transition, next);
    await this.collaborators.reports.write(next);
  }
}
