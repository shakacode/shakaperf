/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { MergePhaseStore, PrimaryPhaseStore } from '../phase-store';
import type { PhaseTransition } from '../phase-transition';
import { CompareBisectSession } from '../session-owner';
import type { BisectSearchPhase, BisectSession } from '../types';

function phase(id: string, status: BisectSearchPhase['status'] = 'pending'): BisectSearchPhase {
  return {
    id,
    status,
    goodSha: 'good',
    badSha: 'bad',
    orderedCommits: ['good', 'bad'],
    commitSubjects: { good: 'good', bad: 'bad' },
    commitParents: { good: [], bad: ['good'] },
    targets: [],
    groups: [],
    attempts: [],
  };
}

function session(): BisectSession {
  const mergePhase = phase('merge:merge');
  return {
    status: 'running',
    mode: 'primary',
    identity: {
      controlRoot: '/control',
      experimentRoot: '/experiment',
      controlGitCommonDir: '/control/.git',
      experimentGitCommonDir: '/experiment/.git',
      controlOrigin: null,
      experimentOrigin: null,
    },
    compatibility: {
      configFingerprint: 'config',
      categoriesFingerprint: 'categories',
      testsFingerprint: 'tests',
      rebuildFingerprint: 'rebuild',
      repairsFingerprint: 'repairs',
      rangeFingerprint: 'range',
      effective: {
        config: {},
        categories: ['visreg'],
        tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        repairs: [],
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: 'main' },
    rebuildStrategy: { mode: 'commands', commands: [] },
    repairs: [],
    repairApplications: [],
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'digest' },
    primary: phase('primary'),
    mergeQueue: ['merge'],
    mergeInvestigations: {
      merge: {
        mergeSha: 'merge',
        status: 'running',
        parents: ['main', 'topic'],
        targetIds: [],
        targetResults: {},
        phase: mergePhase,
      },
    },
    commitRuns: {},
    startedAt: '2026-07-26T00:00:00.000Z',
  };
}

function transition(nextPhase: BisectSearchPhase): PhaseTransition {
  return { event: 'phase-started', phase: nextPhase };
}

function owner(options: {
  persistenceError?: Error;
  reportError?: Error;
} = {}) {
  const events: string[] = [];
  const value = new CompareBisectSession(session(), {
    persistence: {
      async write() {
        events.push('persist');
        if (options.persistenceError) throw options.persistenceError;
      },
    },
    transitions: {
      async record() {
        events.push('log');
      },
    },
    reports: {
      async write() {
        events.push('report');
        if (options.reportError) throw options.reportError;
      },
    },
  });
  return { events, value };
}

describe('phase stores', () => {
  it('installs a primary phase and commits persistence, logging, then reporting', async () => {
    const { events, value } = owner();
    const store = new PrimaryPhaseStore(value);
    const next = phase('primary', 'running');

    await store.commit(transition(next));

    expect(value.current().primary).toBe(next);
    expect(events).toEqual(['persist', 'log', 'report']);
  });

  it('installs a merge phase without changing the primary phase', async () => {
    const { value } = owner();
    const originalPrimary = value.current().primary;
    const store = new MergePhaseStore('merge', value);
    const next = phase('merge:merge', 'running');

    await store.commit(transition(next));

    expect(store.current()).toBe(next);
    expect(value.current().primary).toBe(originalPrimary);
  });

  it('does not report or log a phase that durable persistence rejected', async () => {
    const { events, value } = owner({ persistenceError: new Error('disk full') });
    const store = new PrimaryPhaseStore(value);
    const next = phase('primary', 'running');

    await expect(store.commit(transition(next))).rejects.toThrow('disk full');

    expect(value.current().primary).toBe(next);
    expect(events).toEqual(['persist']);
  });

  it('retains durable in-memory state when report rendering fails', async () => {
    const { events, value } = owner({ reportError: new Error('render failed') });
    const store = new PrimaryPhaseStore(value);
    const next = phase('primary', 'running');

    await expect(store.commit(transition(next))).rejects.toThrow('render failed');

    expect(value.current().primary).toBe(next);
    expect(events).toEqual(['persist', 'log', 'report']);
  });

  it('rejects missing merge phase ownership', () => {
    const { value } = owner();

    expect(() => new MergePhaseStore('unknown', value).current())
      .toThrow('Merge investigation unknown has no phase');
  });
});
