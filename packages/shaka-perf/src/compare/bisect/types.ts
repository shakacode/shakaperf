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
  requestedCategories: BisectCategory[];
  requestedTestFiles: string[];
  refreshMode: 'commands' | 'container';
  usedFallback: boolean;
  compareResultsPath?: string;
  startedAt: string;
  finishedAt?: string;
  infrastructureError?: string;
}

export interface BisectSession {
  version: 1;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  goodSha: string;
  badSha: string;
  originalExperiment: {
    sha: string;
    branch: string | null;
  };
  selectedCategories: BisectCategory[];
  orderedCommits: string[];
  targets: BisectTarget[];
  commitRuns: Record<string, CommitRun>;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
}
