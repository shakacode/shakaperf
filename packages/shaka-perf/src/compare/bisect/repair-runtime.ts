/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { exec } from '../../twin-servers/helpers/shell';
import { requireClean, resolveCommit } from './git';
import { repairArtifactPath } from './repair-artifacts';
import { fingerprint } from './state';
import type {
  BisectRepair,
  BisectRepairApplicationEvidence,
  BisectRepairEvidence,
} from './types';

export interface BisectRepairCommandRunner {
  runRepairCommands(
    phase: 'prepare' | 'cleanup',
    commands: readonly string[],
  ): Promise<void>;
}

export interface BisectRepairScope {
  prepare(): Promise<void>;
}

export interface BisectRepairTransactionResult<T> {
  value: T;
  evidence: BisectRepairEvidence;
}

export interface BisectRepairExecutor {
  selectionFor(sha: string, evaluationId: string): BisectRepairEvidence;
  withRepairs<T>(options: {
    sha: string;
    evaluationId: string;
    run: (scope: BisectRepairScope) => Promise<T>;
  }): Promise<BisectRepairTransactionResult<T>>;
}

export class BisectRepairTransactionError extends Error {
  constructor(
    readonly evidence: BisectRepairEvidence,
    readonly originalError: unknown,
  ) {
    super(`Repair transaction for ${evidence.sha} failed: ${errorMessage(originalError)}`, {
      cause: originalError,
    });
    this.name = 'BisectRepairTransactionError';
  }
}

export class ConfiguredBisectRepairRuntime {
  constructor(private readonly options: {
    repoDir: string;
    resultsDirectory: string;
    repairs: readonly BisectRepair[];
    commandRunner: BisectRepairCommandRunner;
  }) {}

  selectionFor(sha: string, evaluationId: string): BisectRepairEvidence {
    return createRepairEvidence(sha, evaluationId, this.repairsFor(sha));
  }

  async withRepairs<T>(options: {
    sha: string;
    evaluationId: string;
    run: (scope: BisectRepairScope) => Promise<T>;
  }): Promise<BisectRepairTransactionResult<T>> {
    const repairs = this.repairsFor(options.sha);
    const evidence = createRepairEvidence(options.sha, options.evaluationId, repairs);
    if (repairs.length === 0) {
      return {
        value: await options.run({ prepare: async () => undefined }),
        evidence,
      };
    }

    await this.assertUnpatchedCandidate(options.sha, 'before applying repairs');
    const applied: BisectRepair[] = [];
    const prepared: BisectRepair[] = [];
    let prepareCalled = false;
    let value: T | undefined;
    let primaryError: unknown;
    const cleanupErrors: unknown[] = [];

    try {
      for (const repair of repairs) {
        const application = applicationFor(evidence, repair.id);
        try {
          await this.gitApply(repair, false, true);
          await this.gitApply(repair, false, false);
          application.apply = 'succeeded';
          applied.push(repair);
        } catch (error) {
          application.apply = 'failed';
          application.errors.push(errorMessage(error));
          throw error;
        }
      }

      value = await options.run({
        prepare: async () => {
          if (prepareCalled) throw new Error('Bisect repair preparation ran more than once');
          prepareCalled = true;
          for (const repair of repairs) {
            const application = applicationFor(evidence, repair.id);
            prepared.push(repair);
            try {
              await this.options.commandRunner.runRepairCommands(
                'prepare',
                repair.prepareCommands.map((command) => command.command),
              );
              application.prepare = 'succeeded';
            } catch (error) {
              application.prepare = 'failed';
              application.errors.push(errorMessage(error));
              throw error;
            }
          }
        },
      });
      if (!prepareCalled) {
        throw new Error('Candidate evaluation did not run bisect repair preparation');
      }
    } catch (error) {
      primaryError = error;
    } finally {
      for (const repair of [...prepared].reverse()) {
        const application = applicationFor(evidence, repair.id);
        try {
          await this.options.commandRunner.runRepairCommands(
            'cleanup',
            repair.cleanupCommands.map((command) => command.command),
          );
          application.cleanup = 'succeeded';
        } catch (error) {
          application.cleanup = 'failed';
          application.errors.push(errorMessage(error));
          cleanupErrors.push(error);
        }
      }
      for (const repair of [...applied].reverse()) {
        const application = applicationFor(evidence, repair.id);
        try {
          await this.gitApply(repair, true, false);
          application.reverse = 'succeeded';
        } catch (error) {
          application.reverse = 'failed';
          application.errors.push(errorMessage(error));
          cleanupErrors.push(error);
        }
      }
      try {
        await this.assertUnpatchedCandidate(options.sha, 'after cleaning up repairs');
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (primaryError !== undefined || cleanupErrors.length > 0) {
      const combined = combineErrors(primaryError, cleanupErrors, options.sha);
      throw new BisectRepairTransactionError(evidence, combined);
    }
    if (value === undefined) {
      throw new BisectRepairTransactionError(
        evidence,
        new Error(`Repair transaction for ${options.sha} completed without a value`),
      );
    }
    return { value, evidence };
  }

  private repairsFor(sha: string): BisectRepair[] {
    return this.options.repairs
      .filter((repair) => repairAppliesToSha(repair, sha))
      .sort((left, right) => left.order - right.order);
  }

  private async assertUnpatchedCandidate(sha: string, operation: string): Promise<void> {
    const actual = await resolveCommit(this.options.repoDir, 'HEAD');
    if (actual !== sha) {
      throw new Error(`Repair transaction ${operation} found ${actual}; expected ${sha}`);
    }
    await requireClean(this.options.repoDir, `Experiment ${operation}`, {
      allowedPaths: [this.options.resultsDirectory],
    });
  }

  private async gitApply(
    repair: BisectRepair,
    reverse: boolean,
    check: boolean,
  ): Promise<void> {
    const args = ['apply'];
    if (check) args.push('--check');
    if (reverse) args.push('--reverse');
    args.push('--binary');
    args.push(repairArtifactPath(this.options.resultsDirectory, repair.filename));
    const result = await exec('git', args, { cwd: this.options.repoDir, silent: true });
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
      throw new Error(`Repair "${repair.id}" git apply failed: ${detail}`);
    }
  }
}

export function repairAppliesToSha(repair: BisectRepair, sha: string): boolean {
  return repair.appliesToAll || repair.applicableShas.includes(sha);
}

export function createRepairEvidence(
  sha: string,
  evaluationId: string,
  repairs: readonly BisectRepair[],
): BisectRepairEvidence {
  return {
    evaluationId,
    sha,
    repairIds: repairs.map((repair) => repair.id),
    repairSetFingerprint: fingerprint(repairs.map((repair) => ({
      id: repair.id,
      sha256: repair.sha256,
    }))),
    applications: repairs.map((repair) => ({
      repairId: repair.id,
      apply: 'not-run',
      prepare: 'not-run',
      cleanup: 'not-run',
      reverse: 'not-run',
      errors: [],
    })),
  };
}

function applicationFor(
  evidence: BisectRepairEvidence,
  repairId: string,
): BisectRepairApplicationEvidence {
  const application = evidence.applications.find((item) => item.repairId === repairId);
  if (!application) throw new Error(`Missing repair evidence for ${repairId}`);
  return application;
}

function combineErrors(primary: unknown, cleanup: unknown[], sha: string): unknown {
  if (primary === undefined && cleanup.length === 1) return cleanup[0];
  if (primary === undefined) {
    return new AggregateError(cleanup, `Repair cleanup failed for ${sha}`);
  }
  if (cleanup.length === 0) return primary;
  return new AggregateError([primary, ...cleanup], `Repair evaluation and cleanup failed for ${sha}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
