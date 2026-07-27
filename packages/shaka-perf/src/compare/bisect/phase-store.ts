/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PhaseTransition } from './phase-transition';
import { CompareBisectSession } from './session-owner';
import type { BisectSearchPhase, BisectSession } from './types';
import { installCommitRun } from './commit-run-state';

export abstract class PhaseStore {
  constructor(protected readonly owner: CompareBisectSession) {}

  abstract current(): BisectSearchPhase;

  protected abstract install(
    session: BisectSession,
    phase: BisectSearchPhase,
  ): BisectSession;

  async commit(transition: PhaseTransition): Promise<void> {
    const installed = this.install(this.owner.current(), transition.phase);
    const next = transition.commitRun
      ? installCommitRun(installed, transition.commitRun)
      : installed;
    await this.owner.commit(transition, next);
  }
}

export class PrimaryPhaseStore extends PhaseStore {
  current(): BisectSearchPhase {
    return this.owner.current().primary;
  }

  protected install(session: BisectSession, phase: BisectSearchPhase): BisectSession {
    return { ...session, primary: phase };
  }
}

export class MergePhaseStore extends PhaseStore {
  constructor(
    private readonly mergeSha: string,
    owner: CompareBisectSession,
  ) {
    super(owner);
  }

  current(): BisectSearchPhase {
    const phase = this.owner.current().mergeInvestigations[this.mergeSha]?.phase;
    if (!phase) throw new Error(`Merge investigation ${this.mergeSha} has no phase`);
    return phase;
  }

  protected install(session: BisectSession, phase: BisectSearchPhase): BisectSession {
    const investigation = session.mergeInvestigations[this.mergeSha];
    if (!investigation) throw new Error(`Unknown merge investigation: ${this.mergeSha}`);
    return {
      ...session,
      mergeInvestigations: {
        ...session.mergeInvestigations,
        [this.mergeSha]: { ...investigation, phase },
      },
    };
  }
}
