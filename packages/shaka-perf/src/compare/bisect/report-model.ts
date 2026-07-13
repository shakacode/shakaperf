/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import type { ReportData, TestResult } from '../../pipeline/report';
import type {
  BisectCategory,
  BisectSession,
  CommitRun,
  MergeInvestigation,
  MergeTargetResult,
  TargetObservation,
  TargetStatus,
} from './types';

export interface BisectReportCounts {
  visreg: number;
  perf: number;
  accessibility: number;
}

export interface BisectReportCommit {
  sha: string;
  subject: string;
  position: number;
  measured: boolean;
  counts: BisectReportCounts;
  targetIds: string[];
  isMerge?: boolean;
  mergeInvestigationStatus?: MergeInvestigation['status'];
}

export interface BisectReportTarget {
  id: string;
  category: BisectCategory;
  testId: string | null;
  testFile: string;
  testName: string;
  viewport: string;
  subject: string;
  status: TargetStatus;
  firstBadSha?: string;
  invalidReason?: string;
  badRefObservation?: TargetObservation;
  mainlineFirstBadSha?: string;
  mainlineIsMerge?: boolean;
  mergeInvestigationStatus?: MergeInvestigation['status'];
  mergeSourceSha?: string;
  mergeResult?: MergeTargetResult['kind'];
}

export interface BisectReportView {
  targetIds: string[];
}

export interface BisectReportModel {
  status: BisectSession['status'];
  goodSha: string;
  badSha: string;
  generatedAt: string;
  commits: BisectReportCommit[];
  targets: BisectReportTarget[];
  targetsById: Record<string, BisectReportTarget>;
  views: {
    unresolved: BisectReportView;
    invalid: BisectReportView;
  };
}

export type BisectReportData = ReportData & { bisect: BisectReportModel };

export function buildBisectReportModel(
  session: BisectSession,
  badRefTests: readonly TestResult[],
  generatedAt: string,
): BisectReportModel {
  const testIdsByKey = new Map(badRefTests.map((test) => [testKey(test.filePath, test.name), test.id]));
  const targets = session.targets.map((target) => {
    const parents = target.firstBadSha
      ? session.primary?.commitParents[target.firstBadSha] ?? []
      : [];
    const investigation = target.firstBadSha
      ? session.mergeInvestigations?.[target.firstBadSha]
      : undefined;
    const mergeResult = investigation?.targetResults[target.id];
    return {
      id: target.id,
      category: target.category,
      testId: testIdsByKey.get(testKey(target.testFile, target.testName)) ?? null,
      testFile: target.testFile,
      testName: target.testName,
      viewport: target.viewport,
      subject: target.subject,
      status: target.status,
      firstBadSha: target.firstBadSha,
      invalidReason: target.invalidReason,
      badRefObservation: target.observations[session.badSha],
      mainlineFirstBadSha: target.firstBadSha,
      mainlineIsMerge: parents.length > 1,
      mergeInvestigationStatus: investigation?.status,
      mergeResult: mergeResult?.kind,
      mergeSourceSha: mergeResult && 'sourceSha' in mergeResult
        ? mergeResult.sourceSha
        : undefined,
    };
  });
  const targetsById = Object.fromEntries(targets.map((target) => [target.id, target]));
  const commits = session.orderedCommits.map((sha, position) => {
    const targetIds = targets
      .filter((target) => target.status === 'found' && target.firstBadSha === sha)
      .map((target) => target.id);
    const investigation = session.mergeInvestigations?.[sha];
    return {
      sha,
      subject: session.commitSubjects?.[sha] || sha.slice(0, 7),
      position,
      measured: commitWasMeasured(session.commitRuns[sha]),
      counts: countsFor(targetIds, targetsById),
      targetIds,
      isMerge: (session.primary?.commitParents[sha] ?? []).length > 1,
      mergeInvestigationStatus: investigation?.status,
    };
  });

  return {
    status: session.status,
    goodSha: session.goodSha,
    badSha: session.badSha,
    generatedAt,
    commits,
    targets,
    targetsById,
    views: {
      unresolved: { targetIds: targets.filter((target) => target.status === 'active').map((target) => target.id) },
      invalid: { targetIds: targets.filter((target) => target.status === 'invalid').map((target) => target.id) },
    },
  };
}

function commitWasMeasured(commitRun: CommitRun | undefined): boolean {
  if (!commitRun) return false;
  if (commitRun.compareCompleted !== undefined) return commitRun.compareCompleted;
  return commitRun.compareResultsPath !== undefined || commitRun.reusedResults === true;
}

function countsFor(
  targetIds: readonly string[],
  targetsById: Record<string, BisectReportTarget>,
): BisectReportCounts {
  const counts: BisectReportCounts = { visreg: 0, perf: 0, accessibility: 0 };
  for (const targetId of targetIds) {
    const target = targetsById[targetId];
    if (target) counts[target.category] += 1;
  }
  return counts;
}

function testKey(filePath: string, name: string): string {
  return `${path.normalize(filePath).replaceAll('\\', '/')}/${name}`;
}
