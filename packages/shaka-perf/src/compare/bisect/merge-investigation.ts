/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PreparedChildGitRange } from './git';
import { runCheckpointedAttempt } from './attempt';
import { runNativeSearchPhase, type NativeBisectPhaseDriver } from './phase';
import type { CandidateResult, ExperimentReloadMode } from './run-candidate';
import { testsForTargets, type CandidateMeasurementPlan } from './search';
import type {
  BisectCategory,
  BisectSearchPhase,
  BisectSession,
  BisectTarget,
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
  preferredExperimentReloadMode: ExperimentReloadMode;
  nextAttemptId(): string;
  nextGroupId(): string;
  now(): string;
  commitRuns(): Record<string, CommitRun>;
  checkpoint(session: BisectSession): void;
  afterCheckpoint?(session: BisectSession): void;
  prepareRange(investigation: MergeInvestigation): Promise<PreparedChildGitRange>;
  nativeBisect: NativeBisectPhaseDriver;
  measure(
    work: CandidateMeasurementPlan,
    targets: readonly BisectTarget[],
    checkout: boolean,
  ): Promise<CandidateResult>;
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
      const phaseBeforeValidation: BisectSearchPhase = phase
        ? {
          ...phase,
          status: 'pending',
          targets: [...primaryTargets],
        }
        : childPhase(investigation, range, primaryTargets);
      let preValidationPhase = phaseBeforeValidation;
      let preValidationInvestigation = investigation;
      let preValidationSession = session;

      await runCheckpointedAttempt({
        attempts: phaseBeforeValidation.attempts,
        work: validationWork,
        preferredExperimentReloadMode: options.preferredExperimentReloadMode,
        nextAttemptId: options.nextAttemptId,
        now: options.now,
        checkpointRunning(attempts) {
          preValidationPhase = { ...phaseBeforeValidation, attempts };
          preValidationInvestigation = {
            ...investigation!,
            phase: preValidationPhase,
          };
          preValidationSession = updateInvestigation(session, preValidationInvestigation);
          phase = preValidationPhase;
          investigation = preValidationInvestigation;
          session = preValidationSession;
          options.checkpoint(session);
        },
        checkpointComplete(attempts, validation) {
          const targetEvaluations = new Map(
            validation.targetEvaluations.map((value) => [value.targetId, value]),
          );
          const reproducing: BisectTarget[] = [];
          const targetResults = { ...preValidationInvestigation.targetResults };
          for (const target of primaryTargets) {
            const evaluation = targetEvaluations.get(target.id);
            if (!evaluation?.regressionDetected) {
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
              recordedTargetEvaluations: { [range.secondParent]: evaluation },
            });
          }
          phase = {
            ...preValidationPhase,
            targets: reproducing,
            attempts,
          };
          investigation = {
            ...preValidationInvestigation,
            phase,
            targetResults,
          };
          session = updateInvestigation(preValidationSession, investigation);
          options.checkpoint(session);
        },
        checkpointIncomplete(attempts) {
          phase = { ...preValidationPhase, attempts };
          investigation = { ...preValidationInvestigation, phase };
          session = updateInvestigation(preValidationSession, investigation);
          options.checkpoint(session);
        },
        afterCheckpoint() {
          options.afterCheckpoint?.(session);
        },
        measure: () => options.measure(validationWork, primaryTargets, true),
      });
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
      const completedPhase = await runNativeSearchPhase({
        phase,
        preferredExperimentReloadMode: options.preferredExperimentReloadMode,
        nextAttemptId: options.nextAttemptId,
        nextGroupId: options.nextGroupId,
        nativeBisect: options.nativeBisect,
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
          false,
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
    attempts: [],
  };
}

function workForTargets(sha: string, targets: readonly BisectTarget[]): CandidateMeasurementPlan {
  return {
    sha,
    targetIds: targets.map((target) => target.id),
    categories: unique(targets.map((target) => target.category)),
    tests: testsForTargets(targets),
  };
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
