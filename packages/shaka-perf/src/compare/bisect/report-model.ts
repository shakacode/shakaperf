/*
 * Copyright (c) 2026 ShakaCode LLC.
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
  TargetEvaluationAtCommit,
  TargetStatus,
} from './types';

export interface BisectReportCounts {
  visreg: number;
  perf: number;
  accessibility: number;
}

export interface BisectReportMergeSourceCommit {
  sha: string;
  subject: string;
  measured: boolean;
  isMerge: boolean;
  targetIds: string[];
  counts: BisectReportCounts;
}

export interface BisectReportMergeInvestigation {
  status: MergeInvestigation['status'];
  failure?: string;
  mergeBase?: string;
  secondParent?: string;
  sourceCommits: BisectReportMergeSourceCommit[];
  mergeIntroducedTargetIds: string[];
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
  mergeInvestigation?: BisectReportMergeInvestigation;
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
  badRefEvaluation?: TargetEvaluationAtCommit;
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
  const { primary } = session;
  const testIdsByKey = new Map(badRefTests.map((test) => [testKey(test.filePath, test.name), test.id]));
  const targets = primary.targets.map((target) => {
    const parents = target.firstBadSha
      ? primary.commitParents[target.firstBadSha] ?? []
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
      badRefEvaluation: target.recordedTargetEvaluations[primary.badSha],
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
  const commits = primary.orderedCommits.map((sha, position) => {
    const targetIds = targets
      .filter((target) => target.status === 'found' && target.firstBadSha === sha)
      .map((target) => target.id);
    const investigation = session.mergeInvestigations?.[sha];
    return {
      sha,
      subject: primary.commitSubjects[sha] || sha.slice(0, 7),
      position,
      measured: commitWasMeasured(session.commitRuns[sha]),
      counts: countsFor(targetIds, targetsById),
      targetIds,
      isMerge: (primary.commitParents[sha] ?? []).length > 1,
      mergeInvestigationStatus: investigation?.status,
      mergeInvestigation: buildMergeInvestigationReport(investigation, targetsById),
    };
  });

  return {
    status: session.status,
    goodSha: primary.goodSha,
    badSha: primary.badSha,
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

function buildMergeInvestigationReport(
  investigation: MergeInvestigation | undefined,
  targetsById: Record<string, BisectReportTarget>,
): BisectReportMergeInvestigation | undefined {
  if (!investigation) return undefined;
  const targetIdsBySourceSha = new Map<string, string[]>();
  const mergeIntroducedTargetIds: string[] = [];
  for (const targetId of investigation.targetIds) {
    const result = investigation.targetResults[targetId];
    if (result?.kind === 'merge-introduced') {
      mergeIntroducedTargetIds.push(targetId);
    } else if (result?.kind === 'source-found' || result?.kind === 'nested-merge') {
      const targetIds = targetIdsBySourceSha.get(result.sourceSha) ?? [];
      targetIds.push(targetId);
      targetIdsBySourceSha.set(result.sourceSha, targetIds);
    }
  }

  const phase = investigation.phase;
  const measuredShas = new Set(
    (phase?.attempts ?? [])
      .filter((attempt) => attempt.status === 'complete')
      .map((attempt) => attempt.sha),
  );
  const sourceCommits = (phase?.orderedCommits ?? [])
    .filter((sha) => sha !== phase?.goodSha)
    .map((sha) => {
      const targetIds = targetIdsBySourceSha.get(sha) ?? [];
      return {
        sha,
        subject: phase?.commitSubjects[sha] || sha.slice(0, 7),
        measured: measuredShas.has(sha),
        isMerge: (phase?.commitParents[sha] ?? []).length > 1,
        targetIds,
        counts: countsFor(targetIds, targetsById),
      };
    });

  return {
    status: investigation.status,
    failure: investigation.failure,
    mergeBase: phase?.goodSha,
    secondParent: phase?.badSha,
    sourceCommits,
    mergeIntroducedTargetIds,
  };
}

function commitWasMeasured(commitRun: CommitRun | undefined): boolean {
  return commitRun?.compareCompleted === true;
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
