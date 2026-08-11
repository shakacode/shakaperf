/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { NativeGitBisectDriver, type NativeBisectStep } from '../git';
import { NativeBisectPhaseRunner } from '../native-phase-runner';
import { PrimaryPhaseStore } from '../phase-store';
import type { PhaseTransition, PhaseTransitionEvent } from '../phase-transition';
import {
  BisectInterruptedError,
  CandidateEvaluationError,
  CandidateEvaluator,
  type CandidateEvaluationPlan,
  type CandidateResult,
} from '../run-candidate';
import { BisectRunEnvironment } from '../run-environment';
import { CompareBisectSession } from '../session-owner';
import type {
  BisectSearchPhase,
  BisectSession,
  BisectTarget,
  TargetEvaluationAtCommit,
} from '../types';

class FixedEnvironment extends BisectRunEnvironment {
  private tick = 0;

  override now(): string {
    return `2026-07-26T00:00:${String(this.tick++).padStart(2, '0')}.000Z`;
  }
}

class FakeGit extends NativeGitBisectDriver {
  readonly events: string[] = [];
  private active = '';

  constructor() {
    super({ repoDir: '/unused' });
  }

  override async start(group: { targetIds: string[]; badSha: string }): Promise<NativeBisectStep> {
    this.active = group.targetIds.includes('visual') ? 'visual' : 'perf';
    this.events.push(`start:${group.targetIds.join(',')}`);
    if (group.badSha === 'b') return step('a');
    return step(this.active === 'visual' ? 'b' : 'c');
  }

  override async mark(verdict: 'good' | 'bad'): Promise<NativeBisectStep> {
    this.events.push(`mark:${verdict}`);
    if (this.active === 'visual' && verdict === 'bad') return step('a');
    return {
      candidateSha: null,
      firstBadSha: this.active === 'visual' ? 'b' : 'c',
      complete: true,
      output: '',
    };
  }

  override async reset(): Promise<void> {
    this.events.push('reset');
  }
}

class StubEvaluator extends CandidateEvaluator {
  readonly measured: string[] = [];

  constructor(
    environment: BisectRunEnvironment,
    private readonly results: Record<string, CandidateResult | Error>,
  ) {
    super(
      { async assertAt() {} },
      { async refreshExperiment() { return { mode: 'commands', usedFallback: false }; } },
      { async run() { return { testResults: [] }; } },
      environment,
      'commands',
    );
  }

  override async evaluate(plan: CandidateEvaluationPlan): Promise<CandidateResult> {
    this.measured.push(plan.sha);
    const result = this.results[plan.sha];
    if (result instanceof Error) {
      throw new CandidateEvaluationError({
        sha: plan.sha,
        compareCompleted: false,
        requestedCategories: [...plan.categories],
        requestedTests: [...plan.tests],
        experimentReloadMode: 'commands',
        usedFallback: false,
        startedAt: 'start',
        finishedAt: 'finish',
        infrastructureError: result.message,
      }, result);
    }
    if (!result) throw new Error(`No result for ${plan.sha}`);
    return result;
  }
}

function step(candidateSha: string): NativeBisectStep {
  return { candidateSha, firstBadSha: null, complete: false, output: '' };
}

function target(id: string, category: BisectTarget['category']): BisectTarget {
  return {
    id,
    category,
    testFile: `${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: id,
    status: 'active',
    recordedTargetEvaluations: {},
  };
}

function phase(): BisectSearchPhase {
  return {
    id: 'primary',
    status: 'pending',
    goodSha: 'good',
    badSha: 'bad',
    orderedCommits: ['good', 'a', 'b', 'c', 'bad'],
    commitSubjects: { good: 'good', a: 'a', b: 'b', c: 'c', bad: 'bad' },
    commitParents: { good: [], a: ['good'], b: ['a'], c: ['b'], bad: ['c'] },
    targets: [target('visual', 'visreg'), target('perf', 'perf')],
    groups: [],
    attempts: [],
  };
}

function session(): BisectSession {
  return {
    status: 'running',
    mode: 'primary',
    identity: {
      controlRoot: '/control', experimentRoot: '/experiment',
      controlGitCommonDir: '/control/.git', experimentGitCommonDir: '/experiment/.git',
      controlOrigin: null, experimentOrigin: null,
    },
    compatibility: {
      configFingerprint: 'config', categoriesFingerprint: 'categories',
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg', 'perf'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        range: { goodSha: 'good', badSha: 'bad' },
      },
    },
    originalExperiment: { sha: 'bad', branch: 'feature' },
    control: { sha: 'good', branch: 'main' },
    rebuildStrategy: { mode: 'commands', commands: [] },
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'digest' },
    primary: phase(),
    mergeQueue: [],
    mergeInvestigations: {},
    commitRuns: {},
    startedAt: 'start',
  };
}

function evaluation(
  targetId: string,
  commitSha: string,
  regressionDetected: boolean,
): TargetEvaluationAtCommit {
  return { targetId, commitSha, regressionDetected, evidence: {}, evidenceArtifacts: [] };
}

function result(sha: string, evaluations: TargetEvaluationAtCommit[]): CandidateResult {
  return {
    commitRun: {
      sha,
      compareCompleted: true,
      requestedCategories: [],
      requestedTests: [],
      experimentReloadMode: 'commands',
      usedFallback: false,
      startedAt: 'start',
      finishedAt: 'finish',
    },
    testResults: [],
    targetEvaluations: evaluations,
    experimentReload: { mode: 'commands', usedFallback: false },
  };
}

function harness(options: {
  results: Record<string, CandidateResult | Error>;
  failReportAt?: PhaseTransitionEvent;
  initialSession?: BisectSession;
}) {
  const environment = new FixedEnvironment();
  const git = new FakeGit();
  const evaluator = new StubEvaluator(environment, options.results);
  const transitions: PhaseTransition[] = [];
  const durable: BisectSession[] = [];
  let lastEvent: PhaseTransitionEvent | undefined;
  const owner = new CompareBisectSession(options.initialSession ?? session(), {
    persistence: {
      async write(value) {
        durable.push(structuredClone(value));
      },
    },
    transitions: {
      async record(transition) {
        lastEvent = transition.event;
        transitions.push(structuredClone(transition));
      },
    },
    reports: {
      async write() {
        if (lastEvent === options.failReportAt) throw new Error('report failed');
      },
    },
  });
  const runner = new NativeBisectPhaseRunner(
    new PrimaryPhaseStore(owner),
    git,
    evaluator,
    environment,
  );
  return { durable, evaluator, git, owner, runner, transitions };
}

describe('NativeBisectPhaseRunner', () => {
  it('persists an atomic classification before marking Git and completes divergent groups', async () => {
    const value = harness({
      results: {
        b: result('b', [evaluation('visual', 'b', true), evaluation('perf', 'b', false)]),
        a: result('a', [evaluation('visual', 'a', false)]),
        c: result('c', [evaluation('perf', 'c', true)]),
      },
    });

    const completed = await value.runner.run();

    expect(value.evaluator.measured).toEqual(['b', 'a', 'c']);
    expect(completed.targets).toMatchObject([
      { id: 'visual', status: 'found', firstBadSha: 'b' },
      { id: 'perf', status: 'found', firstBadSha: 'c' },
    ]);
    expect(completed.attempts.map(({ id }) => id)).toEqual([
      'primary-attempt-1', 'primary-attempt-2', 'primary-attempt-3',
    ]);
    const split = value.transitions.find(({ event }) => event === 'group-split')!;
    expect(split).toMatchObject({
      commitRun: { sha: 'b' },
      phase: {
        attempts: [{ sha: 'b', status: 'complete' }],
        groups: expect.arrayContaining([
          expect.objectContaining({ targetIds: ['visual'], badSha: 'b' }),
          expect.objectContaining({ targetIds: ['perf'], goodSha: 'b' }),
        ]),
      },
    });
    expect(value.git.events).toEqual([
      'start:visual,perf', 'mark:bad', 'mark:good', 'reset',
      'start:perf', 'mark:bad', 'reset',
    ]);
  });

  it('persists an incomplete attempt and failed commit run after evaluation failure', async () => {
    const value = harness({ results: { b: new Error('compare failed') } });

    await expect(value.runner.run()).rejects.toThrow('compare failed');

    expect(value.owner.current()).toMatchObject({
      primary: { attempts: [{ sha: 'b', status: 'incomplete' }] },
      commitRuns: { b: { infrastructureError: 'compare failed' } },
    });
    expect(value.git.events).toEqual(['start:visual,perf', 'reset']);
  });

  it('does not mark Git when report rendering fails after durable classification', async () => {
    const value = harness({
      results: {
        b: result('b', [evaluation('visual', 'b', true), evaluation('perf', 'b', true)]),
      },
      failReportAt: 'candidate-classified',
    });

    await expect(value.runner.run()).rejects.toThrow('report failed');

    expect(value.durable.at(-1)).toMatchObject({
      primary: { attempts: [{ sha: 'b', status: 'complete' }] },
      commitRuns: { b: { compareCompleted: true } },
    });
    expect(value.git.events).toEqual(['start:visual,perf', 'reset']);
  });

  it('resumes a durable classification after report failure without measuring it again', async () => {
    const failed = harness({
      results: {
        b: result('b', [evaluation('visual', 'b', true), evaluation('perf', 'b', true)]),
      },
      failReportAt: 'candidate-classified',
    });
    await expect(failed.runner.run()).rejects.toThrow('report failed');
    const durable = failed.durable.at(-1)!;

    const resumed = harness({
      initialSession: structuredClone(durable),
      results: {
        a: result('a', [evaluation('visual', 'a', false), evaluation('perf', 'a', false)]),
      },
    });
    const completed = await resumed.runner.run();

    expect(resumed.evaluator.measured).toEqual(['a']);
    expect(completed.targets).toMatchObject([
      { id: 'visual', status: 'found', firstBadSha: 'b' },
      { id: 'perf', status: 'found', firstBadSha: 'b' },
    ]);
  });

  it('resets native Git when candidate evaluation is interrupted', async () => {
    const value = harness({
      results: { b: new BisectInterruptedError('SIGINT') },
    });

    await expect(value.runner.run()).rejects.toBeInstanceOf(BisectInterruptedError);
    expect(value.git.events).toEqual(['start:visual,perf', 'reset']);
  });

  it('retains both candidate and reset failures', async () => {
    const value = harness({ results: { b: new Error('compare failed') } });
    jest.spyOn(value.git, 'reset').mockRejectedValueOnce(new Error('reset failed'));

    await expect(value.runner.run()).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: expect.stringMatching(/compare failed/i) }),
        expect.objectContaining({ message: expect.stringMatching(/reset failed/i) }),
      ],
    });
  });
});
