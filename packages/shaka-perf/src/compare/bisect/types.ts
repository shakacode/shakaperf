/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type BisectCategory = 'visreg' | 'perf' | 'accessibility';

export type TargetStatus = 'active' | 'found' | 'invalid';

export interface BisectTestSelection {
  testFile: string;
  testName: string;
}

export interface TargetKey {
  id: string;
  category: BisectCategory;
  testFile: string;
  testName: string;
  viewport: string;
  subject: string;
}

export interface TargetObservation {
  targetId: string;
  commitSha: string;
  present: boolean;
  values: Record<string, string | number | boolean | null>;
  artifacts: string[];
}

export interface BisectTarget extends TargetKey {
  status: TargetStatus;
  goodIndex: number;
  badIndex: number;
  firstBadSha?: string;
  invalidReason?: string;
  observations: Record<string, TargetObservation>;
}

export interface CommitRun {
  sha: string;
  compareCompleted?: boolean;
  requestedCategories: BisectCategory[];
  requestedTests?: BisectTestSelection[];
  requestedTestFiles?: string[];
  refreshMode: 'commands' | 'container';
  usedFallback: boolean;
  compareResultsPath?: string;
  startedAt: string;
  finishedAt?: string;
  infrastructureError?: string;
  reusedResults?: boolean;
}

interface BisectNextActionBase {
  sha: string;
  categories: BisectCategory[];
  tests?: BisectTestSelection[];
  testFiles?: string[];
  targetIds: string[];
}

export type BisectNextAction = BisectNextActionBase & (
  | { kind: 'validate-good-ref' }
  | { kind: 'measure-candidate' }
);

export interface BisectSession {
  version: 1 | 2;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  goodSha: string;
  badSha: string;
  originalExperiment: {
    sha: string;
    branch: string | null;
  };
  commitSubjects?: Record<string, string>;
  selectedCategories: BisectCategory[];
  orderedCommits: string[];
  targets: BisectTarget[];
  primary?: BisectSearchPhase;
  mode?: 'primary' | 'merge-investigation' | 'complete';
  identity?: BisectRepositoryIdentity;
  compatibility?: BisectCompatibility;
  control?: { sha: string; branch: string | null };
  rebuildStrategy?: PersistedRebuildStrategy;
  reportInput?: { filename: string; sha256: string };
  mergeQueue?: string[];
  mergeInvestigations?: Record<string, MergeInvestigation>;
  commitRuns: Record<string, CommitRun>;
  dryRun?: boolean;
  validateGoodRef?: boolean;
  nextAction?: BisectNextAction;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
}

declare const normalizedBisectSessionBrand: unique symbol;

/**
 * Marks search input whose cached observations have already been folded into
 * each target's good/bad interval, which `nextCandidate` requires.
 */
export type Normalized<T> = T & {
  readonly [normalizedBisectSessionBrand]: true;
};

export type NormalizedBisectSession = Normalized<BisectSession>;

export type PersistedAttemptStatus = 'running' | 'complete' | 'incomplete';

export interface CommitAttempt {
  id: string;
  sha: string;
  status: PersistedAttemptStatus;
  requestedCategories: BisectCategory[];
  requestedTests: BisectTestSelection[];
  refreshMode: 'commands' | 'container';
  usedFallback: boolean;
  startedAt: string;
  finishedAt?: string;
  compareResultsPath?: string;
  error?: string;
}

export interface BisectSearchPhase {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  goodSha: string;
  badSha: string;
  orderedCommits: string[];
  commitSubjects: Record<string, string>;
  commitParents: Record<string, string[]>;
  targets: BisectTarget[];
  attempts: CommitAttempt[];
  startedAt?: string;
  finishedAt?: string;
}

export interface BisectRepositoryIdentity {
  controlRoot: string;
  experimentRoot: string;
  controlGitCommonDir: string;
  experimentGitCommonDir: string;
  controlOrigin: string | null;
  experimentOrigin: string | null;
}

export interface PersistedRebuildStrategy {
  mode: 'commands' | 'container';
  commands: string[];
}

export interface BisectCompatibility {
  configFingerprint: string;
  categoriesFingerprint: string;
  testsFingerprint: string;
  rebuildFingerprint: string;
  rangeFingerprint: string;
  effective: {
    config: unknown;
    categories: BisectCategory[];
    tests: BisectTestSelection[];
    rebuildStrategy: PersistedRebuildStrategy;
    range: { goodSha: string; badSha: string };
  };
}

export type MergeTargetResult =
  | { kind: 'merge-uninvestigated' }
  | { kind: 'merge-introduced' }
  | { kind: 'source-found'; sourceSha: string }
  | { kind: 'nested-merge'; sourceSha: string }
  | { kind: 'octopus-unsupported' };

export interface MergeInvestigation {
  mergeSha: string;
  parents: string[];
  status: 'merge-uninvestigated' | 'running' | 'complete' | 'octopus-unsupported' | 'failed';
  targetIds: string[];
  phase?: BisectSearchPhase;
  targetResults: Record<string, MergeTargetResult>;
  failure?: string;
}

export interface BisectSessionV2 {
  version: 2;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  mode: 'primary' | 'merge-investigation' | 'complete';
  identity: BisectRepositoryIdentity;
  compatibility: BisectCompatibility;
  originalExperiment: { sha: string; branch: string | null };
  control: { sha: string; branch: string | null };
  rebuildStrategy: PersistedRebuildStrategy;
  reportInput: { filename: string; sha256: string };
  primary: BisectSearchPhase;
  mergeQueue: string[];
  mergeInvestigations: Record<string, MergeInvestigation>;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
  goodSha?: string;
  badSha?: string;
  commitSubjects?: Record<string, string>;
  selectedCategories?: BisectCategory[];
  orderedCommits?: string[];
  targets?: BisectTarget[];
  commitRuns?: Record<string, CommitRun>;
  dryRun?: boolean;
  validateGoodRef?: boolean;
  nextAction?: BisectNextAction;
}
