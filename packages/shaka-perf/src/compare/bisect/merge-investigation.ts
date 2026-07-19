/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PreparedChildGitRange } from './git';
import { runSearchPhase } from './phase';
import type { CandidateResult, RefreshMode } from './run-candidate';
import { testsForTargets, type CandidateWork } from './search';
import type {
  BisectCategory,
  BisectSearchPhase,
  BisectSession,
  BisectTarget,
  CommitAttempt,
  CommitRun,
  MergeInvestigation,
  MergeTargetResult,
} from './types';

export function buildMergeQueue(session: BisectSession): BisectSession {
  if (!session.primary) return session;
  const targetIdsByMerge = new Map<string, string[]>();
  for (const target of session.primary.targets) {
    if (target.status !== 'found' || !target.firstBadSha) continue;
    const parents = session.primary.commitParents[target.firstBadSha] ?? [];
    if (parents.length < 2) continue;
    const ids = targetIdsByMerge.get(target.firstBadSha) ?? [];
    ids.push(target.id);
    targetIdsByMerge.set(target.firstBadSha, ids);
  }
  const mergeQueue = session.primary.orderedCommits.filter((sha) => targetIdsByMerge.has(sha));
  const existing = session.mergeInvestigations ?? {};
  const mergeInvestigations = { ...existing };
  for (const mergeSha of mergeQueue) {
    if (mergeInvestigations[mergeSha]) continue;
    const parents = session.primary.commitParents[mergeSha] ?? [];
    const targetIds = targetIdsByMerge.get(mergeSha) ?? [];
    const octopus = parents.length > 2;
    mergeInvestigations[mergeSha] = {
      mergeSha,
      parents,
      status: octopus ? 'octopus-unsupported' : 'merge-uninvestigated',
      targetIds,
      targetResults: Object.fromEntries(targetIds.map((targetId) => [targetId, {
        kind: octopus ? 'octopus-unsupported' : 'merge-uninvestigated',
      } as MergeTargetResult])),
    };
  }
  return { ...session, mergeQueue, mergeInvestigations };
}

export interface RunMergeInvestigationsOptions {
  session: BisectSession;
  preferredRefreshMode: RefreshMode;
  nextAttemptId(): string;
  now(): string;
  commitRuns(): Record<string, CommitRun>;
  checkpoint(session: BisectSession): void;
  afterCheckpoint?(session: BisectSession): void;
  prepareRange(investigation: MergeInvestigation): Promise<PreparedChildGitRange>;
  measure(work: CandidateWork, targets: readonly BisectTarget[]): Promise<CandidateResult>;
}

export async function runMergeInvestigations(
  options: RunMergeInvestigationsOptions,
): Promise<BisectSession> {
  let session = options.session;
  for (const mergeSha of session.mergeQueue ?? []) {
    let investigation = session.mergeInvestigations?.[mergeSha];
    if (!investigation || investigation.status === 'complete'
      || investigation.status === 'octopus-unsupported') continue;

    const primaryTargets = session.primary?.targets.filter((target) => (
      investigation!.targetIds.includes(target.id)
    )) ?? [];
    let range: PreparedChildGitRange;
    try {
      range = await options.prepareRange(investigation);
    } catch (error) {
      investigation = {
        ...investigation,
        status: 'failed',
        failure: error instanceof Error ? error.message : String(error),
      };
      session = updateInvestigation(session, investigation);
      options.checkpoint(session);
      options.afterCheckpoint?.(session);
      continue;
    }
    investigation = { ...investigation, status: 'running', failure: undefined };
    session = updateInvestigation(session, investigation);
    options.checkpoint(session);
    options.afterCheckpoint?.(session);

    let phase = investigation.phase;
    const validationComplete = phase?.attempts.some((attempt) => (
      attempt.sha === range.secondParent && attempt.status === 'complete'
    )) === true;
    if (!validationComplete) {
      const validationWork = workForTargets(range.secondParent, primaryTargets);
      const attempt = runningAttempt(
        options.nextAttemptId(), validationWork, options.preferredRefreshMode, options.now(),
      );
      phase = phase
        ? {
          ...phase,
          status: 'pending',
          targets: [...primaryTargets],
          attempts: [...phase.attempts, attempt],
        }
        : childPhase(investigation, range, primaryTargets, [attempt]);
      investigation = { ...investigation, phase };
      session = updateInvestigation(session, investigation);
      options.checkpoint(session);
      options.afterCheckpoint?.(session);

      const preValidationPhase = phase;
      const preValidationInvestigation = investigation;
      const preValidationSession = session;
      try {
        const validation = await options.measure(validationWork, primaryTargets);
        const observations = new Map(
          validation.observations.map((value) => [value.targetId, value]),
        );
        const reproducing: BisectTarget[] = [];
        const targetResults = { ...preValidationInvestigation.targetResults };
        for (const target of primaryTargets) {
          const observation = observations.get(target.id);
          if (!observation?.present) {
            targetResults[target.id] = { kind: 'merge-introduced' };
            continue;
          }
          reproducing.push({
            ...target,
            status: 'active',
            goodIndex: 0,
            badIndex: range.orderedCommits.length - 1,
            firstBadSha: undefined,
            invalidReason: undefined,
            observations: { [range.secondParent]: observation },
          });
        }
        const completedPhase = {
          ...preValidationPhase,
          targets: reproducing,
          attempts: replaceAttempt(
            preValidationPhase.attempts,
            completeAttempt(attempt, validation, options.now()),
          ),
        };
        const completedInvestigation = {
          ...preValidationInvestigation,
          phase: completedPhase,
          targetResults,
        };
        const completedSession = updateInvestigation(
          preValidationSession,
          completedInvestigation,
        );
        options.checkpoint(completedSession);
        phase = completedPhase;
        investigation = completedInvestigation;
        session = completedSession;
      } catch (error) {
        phase = {
          ...preValidationPhase,
          attempts: replaceAttempt(preValidationPhase.attempts, {
            ...attempt,
            status: 'incomplete',
            finishedAt: options.now(),
            error: error instanceof Error ? error.message : String(error),
          }),
        };
        investigation = { ...preValidationInvestigation, phase };
        session = updateInvestigation(preValidationSession, investigation);
        options.checkpoint(session);
        options.afterCheckpoint?.(session);
        throw error;
      }
      options.afterCheckpoint?.(session);
    }

    if (!phase) throw new Error(`Merge investigation ${mergeSha} has no child phase`);

    const invalidTarget = phase.targets.find((target) => (
      target.status === 'active' && target.goodIndex >= target.badIndex
    ));
    if (invalidTarget) {
      const failure = `Cannot investigate merge source for ${mergeSha}: target `
        + `${invalidTarget.id} has no distinct good and bad commits`;
      phase = {
        ...phase,
        status: 'failed',
        finishedAt: options.now(),
      };
      investigation = { ...investigation, phase, status: 'failed', failure };
      session = updateInvestigation(session, investigation);
      options.checkpoint(session);
      options.afterCheckpoint?.(session);
      continue;
    }

    if (phase.targets.length > 0 && phase.status !== 'complete') {
      const completedPhase = await runSearchPhase({
        phase,
        preferredRefreshMode: options.preferredRefreshMode,
        nextAttemptId: options.nextAttemptId,
        now: options.now,
        commitRuns: options.commitRuns,
        checkpoint(updatedPhase) {
          phase = updatedPhase;
          investigation = { ...investigation!, phase: updatedPhase };
          session = updateInvestigation(session, investigation);
          options.checkpoint(session);
        },
        afterCheckpoint(updatedPhase) {
          phase = updatedPhase;
          investigation = { ...investigation!, phase: updatedPhase };
          session = updateInvestigation(session, investigation);
          options.afterCheckpoint?.(session);
        },
        measure: (work) => options.measure(
          work,
          phase!.targets.filter((target) => work.targetIds.includes(target.id)),
        ),
      });
      phase = completedPhase;
    }

    const targetResults = { ...investigation.targetResults };
    for (const target of phase.targets) {
      if (!target.firstBadSha) continue;
      const nested = (phase.commitParents[target.firstBadSha] ?? []).length > 1;
      targetResults[target.id] = nested
        ? { kind: 'nested-merge', sourceSha: target.firstBadSha }
        : { kind: 'source-found', sourceSha: target.firstBadSha };
    }
    investigation = { ...investigation, phase, status: 'complete', targetResults };
    session = updateInvestigation(session, investigation);
    options.checkpoint(session);
    options.afterCheckpoint?.(session);
  }
  return session;
}

function childPhase(
  investigation: MergeInvestigation,
  range: PreparedChildGitRange,
  targets: readonly BisectTarget[],
  attempts: CommitAttempt[],
): BisectSearchPhase {
  return {
    id: `merge:${investigation.mergeSha}`,
    status: 'pending',
    goodSha: range.mergeBase,
    badSha: range.secondParent,
    orderedCommits: range.orderedCommits,
    commitSubjects: range.commitSubjects,
    commitParents: range.commitParents,
    targets: [...targets],
    attempts,
  };
}

function workForTargets(sha: string, targets: readonly BisectTarget[]): CandidateWork {
  return {
    sha,
    targetIds: targets.map((target) => target.id),
    categories: unique(targets.map((target) => target.category)),
    tests: testsForTargets(targets),
  };
}

function runningAttempt(
  id: string,
  work: CandidateWork,
  refreshMode: RefreshMode,
  startedAt: string,
): CommitAttempt {
  return {
    id,
    sha: work.sha,
    status: 'running',
    requestedCategories: [...work.categories],
    requestedTests: [...work.tests],
    refreshMode,
    usedFallback: false,
    startedAt,
  };
}

function completeAttempt(
  attempt: CommitAttempt,
  result: CandidateResult,
  finishedAt: string,
): CommitAttempt {
  return {
    ...attempt,
    status: 'complete',
    refreshMode: result.refresh.mode,
    usedFallback: result.refresh.usedFallback,
    finishedAt: result.commitRun.finishedAt ?? finishedAt,
    ...(result.commitRun.compareResultsPath
      ? { compareResultsPath: result.commitRun.compareResultsPath }
      : {}),
  };
}

function replaceAttempt(attempts: readonly CommitAttempt[], replacement: CommitAttempt): CommitAttempt[] {
  return attempts.map((attempt) => attempt.id === replacement.id ? replacement : attempt);
}

function updateInvestigation(
  session: BisectSession,
  investigation: MergeInvestigation,
): BisectSession {
  return {
    ...session,
    mergeInvestigations: {
      ...session.mergeInvestigations,
      [investigation.mergeSha]: investigation,
    },
  };
}

function unique(values: BisectCategory[]): BisectCategory[] {
  return [...new Set(values)];
}
