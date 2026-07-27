/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  ExactCheckout,
  NativeGitBisectDriver,
  type CheckoutState,
  type NativeBisectStep,
  type PreparedChildGitRange,
} from '../git';
import { buildMergeQueue, MergeInvestigationRunner } from '../merge-investigation';
import { EndpointRestoreError, EndpointValidator } from '../endpoint-validator';
import {
  CandidateEvaluationError,
  CandidateEvaluator,
  type CandidateEvaluationPlan,
  type CandidateResult,
} from '../run-candidate';
import { BisectRunEnvironment } from '../run-environment';
import { CompareBisectSession } from '../session-owner';
import type { BisectSession, BisectTarget, TargetEvaluationAtCommit } from '../types';

function target(id: string, firstBadSha = 'merge'): BisectTarget {
  return {
    id,
    category: 'visreg',
    testFile: `tests/${id}.abtest.ts`,
    testName: id,
    viewport: 'desktop',
    subject: 'document',
    status: 'found',
    firstBadSha,
    recordedTargetEvaluations: {},
  };
}

function session(parents: string[], targets = [target('one')]): BisectSession {
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
      testsFingerprint: 'tests', rebuildFingerprint: 'rebuild',
      repairsFingerprint: 'repairs', rangeFingerprint: 'range',
      effective: {
        config: {}, categories: ['visreg'], tests: [],
        rebuildStrategy: { mode: 'commands', commands: [] },
        repairs: [],
        range: { goodSha: 'good', badSha: 'merge' },
      },
    },
    originalExperiment: { branch: 'main', sha: 'merge' },
    control: { branch: null, sha: 'good' },
    rebuildStrategy: { mode: 'commands', commands: [] },
    repairs: [],
    reportInput: { filename: 'bad-ref-tests.json', sha256: 'fixture' },
    commitRuns: {},
    primary: {
      id: 'primary', status: 'complete', goodSha: 'good', badSha: 'merge',
      orderedCommits: ['good', 'merge'],
      commitSubjects: { good: 'good', merge: 'merge' },
      commitParents: { good: [], merge: parents },
      targets,
      groups: [],
      attempts: [],
    },
    mergeQueue: [],
    mergeInvestigations: {},
    startedAt: 'start',
  };
}

function range(
  commits = ['base', 'source', 'topic'],
  commitParents: Record<string, string[]> = {
    base: [], source: ['base'], topic: ['source'],
  },
): PreparedChildGitRange {
  return {
    mergeBase: commits[0]!,
    secondParent: commits.at(-1)!,
    orderedCommits: commits,
    commitSubjects: Object.fromEntries(commits.map((sha) => [sha, sha])),
    commitParents,
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
      requestedCategories: ['visreg'],
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

class FixedEnvironment extends BisectRunEnvironment {
  override now(): string {
    return 'now';
  }
}

class MergeGit extends NativeGitBisectDriver {
  private good: string;
  private bad: string;
  private candidate: string | null = null;

  constructor(private readonly history: string[]) {
    super({ repoDir: '/unused' });
    this.good = history[0]!;
    this.bad = history.at(-1)!;
  }

  override async start(group: { goodSha: string; badSha: string }): Promise<NativeBisectStep> {
    this.good = group.goodSha;
    this.bad = group.badSha;
    return this.step();
  }

  override async mark(verdict: 'good' | 'bad'): Promise<NativeBisectStep> {
    if (!this.candidate) throw new Error('No native merge candidate to mark');
    if (verdict === 'good') this.good = this.candidate;
    else this.bad = this.candidate;
    return this.step();
  }

  override async reset() {}

  override async assertAt(expectedSha: string) {
    if (this.candidate !== expectedSha) {
      throw new Error(`Selected ${this.candidate}; expected ${expectedSha}`);
    }
  }

  private step(): NativeBisectStep {
    const goodIndex = this.history.indexOf(this.good);
    const badIndex = this.history.indexOf(this.bad);
    if (badIndex - goodIndex === 1) {
      this.candidate = null;
      return { candidateSha: null, firstBadSha: this.bad, complete: true, output: '' };
    }
    this.candidate = this.history[Math.floor((goodIndex + badIndex) / 2)]!;
    return { candidateSha: this.candidate, firstBadSha: null, complete: false, output: '' };
  }
}

class MergeCandidateEvaluator extends CandidateEvaluator {
  constructor(
    environment: BisectRunEnvironment,
    private readonly measure: (plan: CandidateEvaluationPlan) => Promise<CandidateResult>,
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
    try {
      return await this.measure(plan);
    } catch (error) {
      throw new CandidateEvaluationError({
        sha: plan.sha,
        compareCompleted: false,
        requestedCategories: [...plan.categories],
        requestedTests: [...plan.tests],
        experimentReloadMode: 'commands',
        usedFallback: false,
        startedAt: 'start',
        finishedAt: 'finish',
        infrastructureError: error instanceof Error ? error.message : String(error),
      }, error);
    }
  }
}

class MemoryExactCheckout extends ExactCheckout {
  constructor(private readonly restoreError?: Error) {
    super({ repoDir: '/unused' });
  }

  override async current(): Promise<CheckoutState> {
    return { branch: 'main', sha: 'merge' };
  }

  override async position() {}
  override async assertAt() {}
  override async restore() {
    if (this.restoreError) throw this.restoreError;
  }
}

function harness(options: {
  initial: BisectSession;
  childRange?: PreparedChildGitRange;
  prepareError?: Error;
  restoreError?: Error;
  measure(plan: CandidateEvaluationPlan): Promise<CandidateResult>;
}) {
  const environment = new FixedEnvironment();
  let persisted = options.initial;
  const owner = new CompareBisectSession(options.initial, {
    persistence: {
      async write(value) {
        persisted = structuredClone(value);
      },
    },
    transitions: { async record() {} },
    reports: { async write() {} },
  });
  const childRange = options.childRange ?? range();
  return {
    get persisted() { return persisted; },
    async run() {
      return new MergeInvestigationRunner(
        owner,
        { async load() {
          if (options.prepareError) throw options.prepareError;
          return childRange;
        } },
        new EndpointValidator(new MemoryExactCheckout(options.restoreError), {
          evaluate: options.measure,
        }),
        new MergeGit([...childRange.orderedCommits]),
        new MergeCandidateEvaluator(environment, options.measure),
        environment,
      ).run();
    },
  };
}

describe('merge investigation', () => {
  it('builds a stable queue and classifies octopus merges without work', async () => {
    const queued = buildMergeQueue(session(['main', 'topic-one', 'topic-two']));
    const value = harness({
      initial: queued,
      async measure() { throw new Error('must not measure'); },
    });

    const completed = await value.run();

    expect(queued.mergeQueue).toEqual(['merge']);
    expect(completed.mergeInvestigations.merge).toMatchObject({
      status: 'octopus-unsupported',
      targetResults: { one: { kind: 'octopus-unsupported' } },
    });
  });

  it('classifies merge-introduced, source, and nested-source targets', async () => {
    const queued = buildMergeQueue(session(
      ['main', 'topic'],
      [target('introduced'), target('source'), target('nested')],
    ));
    const measured: string[] = [];
    const childRange = range(
      ['base', 'source-commit', 'nested-merge', 'topic'],
      {
        base: [],
        'source-commit': ['base'],
        'nested-merge': ['source-commit', 'nested-topic'],
        topic: ['nested-merge'],
      },
    );
    const value = harness({
      initial: queued,
      childRange,
      async measure(plan) {
        measured.push(plan.sha);
        if (plan.sha === 'topic') return result(plan.sha, [
          evaluation('introduced', plan.sha, false),
          evaluation('source', plan.sha, true),
          evaluation('nested', plan.sha, true),
        ]);
        if (plan.sha === 'source-commit') return result(plan.sha, [
          evaluation('source', plan.sha, true),
          evaluation('nested', plan.sha, false),
        ]);
        return result(plan.sha, [evaluation('nested', plan.sha, true)]);
      },
    });

    const completed = await value.run();

    expect(measured).toEqual(['topic', 'source-commit', 'nested-merge']);
    expect(completed.mergeInvestigations.merge).toMatchObject({
      status: 'complete',
      targetResults: {
        introduced: { kind: 'merge-introduced' },
        source: { kind: 'source-found', sourceSha: 'source-commit' },
        nested: { kind: 'nested-merge', sourceSha: 'nested-merge' },
      },
    });
  });

  it('persists child-range preparation failures without discarding primary results', async () => {
    const value = harness({
      initial: buildMergeQueue(session(['main', 'topic'])),
      prepareError: new Error('topology failed'),
      async measure() { throw new Error('must not measure'); },
    });

    const completed = await value.run();

    expect(completed.primary.status).toBe('complete');
    expect(completed.mergeInvestigations.merge).toMatchObject({
      status: 'failed',
      failure: 'topology failed',
      targetResults: { one: { kind: 'merge-uninvestigated' } },
    });
  });

  it('fails a zero-width reproducing source range after one endpoint measurement', async () => {
    const measured: string[] = [];
    const value = harness({
      initial: buildMergeQueue(session(['main', 'topic'])),
      childRange: range(['topic'], { topic: ['main'] }),
      async measure(plan) {
        measured.push(plan.sha);
        return result(plan.sha, [evaluation('one', plan.sha, true)]);
      },
    });

    const completed = await value.run();

    expect(measured).toEqual(['topic']);
    expect(completed.mergeInvestigations.merge).toMatchObject({
      status: 'failed',
      failure: expect.stringMatching(/distinct good and bad commits/i),
      phase: { status: 'failed' },
    });
  });

  it('persists incomplete second-parent validation for retry', async () => {
    const value = harness({
      initial: buildMergeQueue(session(['main', 'topic'])),
      async measure() { throw new Error('validation stopped'); },
    });

    await expect(value.run()).rejects.toThrow('validation stopped');

    expect(value.persisted.mergeInvestigations.merge.phase).toMatchObject({
      attempts: [{ sha: 'topic', status: 'incomplete' }],
    });
  });

  it('persists a completed endpoint attempt before surfacing restoration failure', async () => {
    const value = harness({
      initial: buildMergeQueue(session(['main', 'topic'])),
      restoreError: new Error('restore failed'),
      async measure(plan) {
        return result(plan.sha, [evaluation('one', plan.sha, true)]);
      },
    });

    await expect(value.run()).rejects.toBeInstanceOf(EndpointRestoreError);
    expect(value.persisted).toMatchObject({
      commitRuns: { topic: { compareCompleted: true } },
      mergeInvestigations: {
        merge: {
          phase: {
            attempts: [{
              id: 'merge:merge-endpoint-1',
              sha: 'topic',
              status: 'complete',
            }],
          },
        },
      },
    });
  });
});
