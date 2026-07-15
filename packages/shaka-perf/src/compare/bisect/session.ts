/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AbTestDefinition } from 'shaka-shared';
import { loadTests } from '../../config-loader';
import { parseAbTestsConfig, viewportsByStageCategory, type AbTestsConfig } from '../../config';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import { runPipeline } from '../../pipeline/runner';
import { withAbTestsConfigPath } from '../../before-navigate';
import {
  comparePipelineConfigFromAbTests,
  createComparePipeline,
  comparePipelineMetadata,
} from '../compare-pipeline';
import { assertNoPipelineErrors, discoverTargets, observeTargets } from './analyze';
import { checkoutDetached, prepareGitRange, restoreCheckout, type PreparedGitRange } from './git';
import {
  applyCachedObservations,
  applyObservations,
  nextCandidate,
  testsForTargets,
} from './search';
import { writeSessionAtomic, writeSummary } from './persistence';
import { reconcileExperimentVolume, syncCommitDelta } from './sync';
import type {
  BisectCategory,
  BisectNextAction,
  BisectSession,
  BisectTestSelection,
  BisectTarget,
  CommitRun,
  TargetObservation,
} from './types';
import { resolveConfig } from '../../twin-servers/config';
import type { ResolvedConfig } from '../../twin-servers/types';
import { readBuildManifest, type BuildManifest } from '../../twin-servers/helpers/rebuild-check';
import { requireBisectProxy } from '../../twin-servers/ipc/client';
import { PROTOCOL_VERSION, type ProxyRequestPayload } from '../../twin-servers/ipc/protocol';
import type { BisectRefreshResult } from '../../twin-servers/commands/bisect-session';
import {
  BisectInterruptedError,
  runCandidate,
  type CandidateCheckpoint,
  type CandidateDependencies,
  type CompareRunRequest,
  type CompareRunResult,
  type MaterializeRequest,
  type RefreshRequest,
  type RefreshResult,
} from './run-candidate';
import { loadReusableCompareResults } from './reuse-results';

type RefreshMode = CommitRun['refreshMode'];

export interface BisectCliOptions {
  configPath?: string;
  categories?: string | string[];
  filter?: string;
  testPathPattern?: string;
  headed?: boolean;
  controlURL?: string;
  experimentURL?: string;
  reuseCurrentResults?: boolean;
  dryRun?: boolean;
  validateGoodRef?: boolean;
}

export type {
  CompareRunRequest,
  CompareRunResult,
  MaterializeRequest,
  RefreshRequest,
  RefreshResult,
} from './run-candidate';

export interface RestoreRequest {
  previousSha: string | null;
  originalSha: string;
}

export interface RestoreExperimentStateDependencies {
  restoreCheckout(): Promise<void>;
  syncVolume(): Promise<void>;
  refreshExperiment(): Promise<void>;
}

export async function restoreExperimentState(
  dependencies: RestoreExperimentStateDependencies,
): Promise<void> {
  const errors: Error[] = [];
  let checkoutRestored = false;
  try {
    await dependencies.restoreCheckout();
    checkoutRestored = true;
  } catch (error) {
    errors.push(asError(error));
  }
  if (checkoutRestored) {
    try {
      await dependencies.syncVolume();
    } catch (error) {
      errors.push(asError(error));
    }
  }
  try {
    await dependencies.refreshExperiment();
  } catch (error) {
    errors.push(asError(error));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Failed to restore experiment state');
}

export interface ExecuteBisectInput {
  goodRef?: string;
  badRef?: string;
  cwd: string;
  resultsDirectory: string;
  config: AbTestsConfig;
  twinServers: ResolvedConfig;
  selectedCategories: readonly BisectCategory[];
  frozenTests: readonly AbTestDefinition[];
  gitRange: PreparedGitRange;
  headed: boolean;
  controlURL: string;
  experimentURL: string;
  reuseCurrentResults: boolean;
  dryRun: boolean;
  validateGoodRef: boolean;
}

export interface ReuseCurrentResultsRequest {
  sha: string;
  categories: readonly BisectCategory[];
}

export interface ExecuteBisectDependencies extends CandidateDependencies {
  installSignalHandlers(handler: (signal: NodeJS.Signals) => void): () => void;
  beginSession(): Promise<void>;
  endSession(): Promise<void>;
  restore(request: RestoreRequest): Promise<void>;
  clearSummary(): void;
  writeSession(session: BisectSession): void;
  writeSummary(session: BisectSession): void;
  recordDecision(entry: BisectDecisionLogEntry): void;
  logProgress(message: string): void;
  now(): string;
  reuseCurrentResults(request: ReuseCurrentResultsRequest): Promise<CompareRunResult>;
}

export interface RunBisectOptions {
  goodRef?: string;
  badRef?: string;
  cwd: string;
  resultsDirectory?: string;
  config: AbTestsConfig;
  twinServers: ResolvedConfig;
  selectedCategories: readonly BisectCategory[];
  frozenTests: readonly AbTestDefinition[];
  headed: boolean;
  controlURL?: string;
  experimentURL?: string;
  reuseCurrentResults?: boolean;
  dryRun?: boolean;
  validateGoodRef?: boolean;
  gitRange?: PreparedGitRange;
  dependencies?: ExecuteBisectDependencies;
}

export interface BisectCliRuntimeDependencies {
  loadConfig?: typeof loadAbTestsConfig;
  parseConfig?: typeof parseAbTestsConfig;
  resolveTwinServers?: typeof resolveConfig;
  loadFrozenTests?: typeof loadTests;
  run?: typeof runBisect;
}

export interface BisectDecisionLogEntry {
  timestamp: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export async function runCompareBisectFromCli(
  goodRef: string | undefined,
  badRef: string | undefined,
  cliOptions: BisectCliOptions,
  runtime: BisectCliRuntimeDependencies = {},
): Promise<BisectSession> {
  const cwd = process.cwd();
  const configPath = cliOptions.configPath ?? findAbTestsConfig(cwd);
  if (!configPath) throw new Error('No abtests.config.ts found. Pass one with --config.');

  return withAbTestsConfigPath(configPath, async () => {
    const raw = await (runtime.loadConfig ?? loadAbTestsConfig)(configPath);
    const config = (runtime.parseConfig ?? parseAbTestsConfig)(raw);
    if (!config.twinServers) {
      throw new Error('compare bisect requires a twinServers section in abtests.config.ts');
    }
    const twinServers = (runtime.resolveTwinServers ?? resolveConfig)(config.twinServers, cwd);
    const frozenTests = await (runtime.loadFrozenTests ?? loadTests)({
      testPathPattern: cliOptions.testPathPattern ?? config.shared.testPathPattern,
      filter: cliOptions.filter ?? config.shared.filter,
      log: (message) => console.log(message),
    });
    const session = await (runtime.run ?? runBisect)({
      goodRef,
      badRef,
      cwd,
      config,
      twinServers,
      selectedCategories: parseCategories(cliOptions.categories),
      frozenTests,
      headed: cliOptions.headed === true,
      controlURL: cliOptions.controlURL,
      experimentURL: cliOptions.experimentURL,
      reuseCurrentResults: cliOptions.reuseCurrentResults === true,
      dryRun: cliOptions.dryRun === true,
      validateGoodRef: cliOptions.validateGoodRef === true,
    });
    printBisectSummary(session, path.resolve(cwd, 'compare-bisect-results'));
    return session;
  });
}

export async function runBisect(options: RunBisectOptions): Promise<BisectSession> {
  const resultsDirectory = options.resultsDirectory
    ?? path.resolve(options.cwd, 'compare-bisect-results');
  const gitRange = options.gitRange ?? await prepareGitRange({
    experimentDir: options.twinServers.experimentDir,
    controlDir: options.twinServers.controlDir,
    goodRef: options.goodRef,
    badRef: options.badRef,
  });
  const input: ExecuteBisectInput = {
    goodRef: options.goodRef,
    badRef: options.badRef,
    cwd: options.cwd,
    resultsDirectory,
    config: options.config,
    twinServers: options.twinServers,
    selectedCategories: options.selectedCategories,
    frozenTests: options.frozenTests,
    gitRange,
    headed: options.headed,
    controlURL: options.controlURL ?? options.config.shared.controlURL,
    experimentURL: options.experimentURL ?? options.config.shared.experimentURL,
    reuseCurrentResults: options.reuseCurrentResults === true,
    dryRun: options.dryRun === true,
    validateGoodRef: options.validateGoodRef === true,
  };
  const dependencies = options.dependencies ?? createDefaultDependencies({
    cwd: options.cwd,
    config: options.config,
    twinServers: options.twinServers,
    frozenTests: options.frozenTests,
    resultsDirectory,
    manifest: readRequiredBuildManifest(options.twinServers),
    gitRange,
    headed: options.headed,
    controlURL: input.controlURL,
    experimentURL: input.experimentURL,
  });
  return executeBisect(input, dependencies);
}

export async function executeBisect(
  input: ExecuteBisectInput,
  deps: ExecuteBisectDependencies,
): Promise<BisectSession> {
  fs.mkdirSync(input.resultsDirectory, { recursive: true });
  deps.clearSummary();
  let session = initialSession(input, deps.now());
  let materializedSha: string | null = null;
  let volumeStateUncertain = false;
  let checkoutAttempted = false;
  let leaseAcquired = false;
  let primaryError: unknown = null;
  const cleanupErrors: Error[] = [];
  let cancellationSignal: NodeJS.Signals | null = null;
  let disposeSignalHandlers: (() => void) | null = null;

  const persist = (): void => {
    deps.writeSession(session);
  };
  const checkCancellation = (): void => {
    if (cancellationSignal) throw new BisectInterruptedError(cancellationSignal);
  };
  const logDecision = (
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void => {
    deps.logProgress(message);
    deps.recordDecision({
      timestamp: deps.now(),
      event,
      message,
      data,
    });
  };
  const measure = async (options: {
    sha: string;
    categories: readonly BisectCategory[];
    tests: readonly BisectTestSelection[];
    targets: readonly BisectTarget[];
  }) => runCandidate({
    ...options,
    previousSha: materializedSha,
    preferredMode: preferredRefreshMode(input.config),
    dependencies: {
      ...deps,
      async checkout(sha) {
        checkoutAttempted = true;
        await deps.checkout(sha);
      },
      async materialize(request) {
        volumeStateUncertain = true;
        await deps.materialize(request);
        volumeStateUncertain = false;
      },
    },
    checkCancellation,
    onCheckpoint(checkpoint: CandidateCheckpoint, commitRun: CommitRun) {
      if (checkpoint === 'materialize') materializedSha = options.sha;
      session = recordCommitRun(session, commitRun);
      persist();
    },
  });

  try {
    disposeSignalHandlers = deps.installSignalHandlers((signal) => {
      cancellationSignal ??= signal;
    });
    persist();
    logDecision('session-start', 'Starting compare bisect session', {
      goodSha: input.gitRange.goodSha,
      badSha: input.gitRange.badSha,
      commits: input.gitRange.orderedCommits.length,
      categories: input.selectedCategories,
      resultsDirectory: input.resultsDirectory,
      decisionLog: path.join(input.resultsDirectory, 'decision-log.md'),
    });
    await deps.beginSession();
    leaseAcquired = true;
    logDecision('lease-acquired', 'Acquired twin-server bisect lease; experiment auto-sync is paused');
    persist();
    checkCancellation();

    let badRun: CompareRunResult;
    if (input.reuseCurrentResults) {
      logDecision(
        'bad-ref-reuse-start',
        `Reusing current compare results for bad ref ${shortSha(input.gitRange.badSha)}`,
        {
          sha: input.gitRange.badSha,
          categories: input.selectedCategories,
          source: path.join(input.cwd, 'compare-results'),
        },
      );
      const startedAt = deps.now();
      badRun = await deps.reuseCurrentResults({
        sha: input.gitRange.badSha,
        categories: input.selectedCategories,
      });
      assertNoPipelineErrors(badRun.testResults, input.gitRange.badSha);
      session = recordCommitRun(session, {
        sha: input.gitRange.badSha,
        requestedCategories: [...input.selectedCategories],
        requestedTests: [],
        refreshMode: preferredRefreshMode(input.config),
        usedFallback: false,
        compareResultsPath: badRun.compareResultsPath,
        startedAt,
        finishedAt: deps.now(),
        reusedResults: true,
      });
      persist();
    } else {
      logDecision('bad-ref-start', `Measuring bad ref ${shortSha(input.gitRange.badSha)} to discover regression targets`, {
        sha: input.gitRange.badSha,
        categories: input.selectedCategories,
      });
      badRun = await measure({
        sha: input.gitRange.badSha,
        categories: input.selectedCategories,
        tests: [],
        targets: [],
      });
    }
    session = {
      ...session,
      targets: discoverTargets(
        badRun.testResults,
        input.gitRange.orderedCommits,
        input.gitRange.badSha,
        input.selectedCategories,
      ),
    };
    const badObservations = observeTargets(
      badRun.testResults,
      session.targets,
      input.gitRange.badSha,
    );
    session = recordEndpointObservations(session, badObservations);
    logDecision('bad-ref-targets', `Discovered ${session.targets.length} regression target(s) at the bad ref`, {
      sha: input.gitRange.badSha,
      targetCount: session.targets.length,
      targets: session.targets.map((target) => targetLogData(target)),
    });
    persist();

    if (input.dryRun) {
      let targets = activeTargets(session);
      let nextAction: BisectNextAction | undefined;
      if (targets.length > 0 && input.validateGoodRef) {
        nextAction = {
          kind: 'validate-good-ref' as const,
          sha: input.gitRange.goodSha,
          categories: categoriesForTargets(targets),
          tests: testsForTargets(targets),
          targetIds: targets.map((target) => target.id),
        };
      } else if (targets.length > 0) {
        const normalized = applyCachedObservations(session);
        session = normalized;
        targets = activeTargets(session);
        const work = nextCandidate(normalized);
        if (work) {
          nextAction = {
            kind: 'measure-candidate' as const,
            sha: work.sha,
            categories: work.categories,
            tests: work.tests,
            targetIds: work.targetIds,
          };
        }
      }
      session = {
        ...session,
        dryRun: true,
        nextAction,
      };
      logDecision(
        'dry-run-plan',
        nextAction
          ? `Dry run stopped before ${nextAction.kind === 'validate-good-ref'
            ? 'validating good ref'
            : 'measuring midpoint'} ${shortSha(nextAction.sha)}`
          : 'Dry run found no regression targets and has no next action',
        nextAction ? { nextAction } : { targetCount: 0 },
      );
      persist();
    } else if (session.targets.length === 0) {
      deps.logProgress('No regression targets were present at the bad ref');
    } else {
      if (input.validateGoodRef) {
        const goodTargets = activeTargets(session);
        logDecision('good-ref-start', `Measuring good ref ${shortSha(input.gitRange.goodSha)} to validate the bracket`, {
          sha: input.gitRange.goodSha,
          targetCount: goodTargets.length,
          categories: categoriesForTargets(goodTargets),
          tests: testsForTargets(goodTargets),
        });
        const goodRun = await measure({
          sha: input.gitRange.goodSha,
          categories: categoriesForTargets(goodTargets),
          tests: testsForTargets(goodTargets),
          targets: goodTargets,
        });
        session = validateGoodEndpoint(session, goodRun.observations);
        const invalidTargets = session.targets.filter((target) => target.status === 'invalid');
        logDecision('good-ref-validated', `Good ref validated: ${invalidTargets.length} target(s) already present at good`, {
          sha: input.gitRange.goodSha,
          invalidTargets: invalidTargets.map((target) => targetLogData(target)),
          activeTargets: activeTargets(session).map((target) => targetLogData(target)),
        });
        persist();
      } else {
        logDecision('good-ref-validation-skipped', 'Skipping experiment-side good-ref validation', {
          sha: input.gitRange.goodSha,
        });
      }

      while (true) {
        const normalized = applyCachedObservations(session);
        session = normalized;
        persist();
        const work = nextCandidate(normalized);
        if (!work) break;

        const targets = session.targets.filter((target) => work.targetIds.includes(target.id));
        logDecision('candidate-selected', `Selected midpoint ${shortSha(work.sha)} for ${targets.length} active target(s)`, {
          sha: work.sha,
          categories: work.categories,
          tests: work.tests,
          targets: targets.map((target) => targetLogData(target, input.gitRange.orderedCommits)),
        });
        const candidateRun = await measure({
          sha: work.sha,
          categories: work.categories,
          tests: work.tests,
          targets,
        });
        const observations = new Map(
          candidateRun.observations.map((observation) => [observation.targetId, observation]),
        );
        const beforeTargets = new Map(session.targets.map((target) => [target.id, target]));
        session = applyObservations(session, work.sha, observations);
        logDecision('candidate-observed', `Applied ${candidateRun.observations.length} observation(s) from ${shortSha(work.sha)}`, {
          sha: work.sha,
          observations: candidateRun.observations.map((observation) => {
            const before = beforeTargets.get(observation.targetId);
            const after = session.targets.find((target) => target.id === observation.targetId);
            return {
              targetId: observation.targetId,
              present: observation.present,
              previousInterval: before ? intervalLogData(before, input.gitRange.orderedCommits) : null,
              nextInterval: after ? intervalLogData(after, input.gitRange.orderedCommits) : null,
              status: after?.status,
              firstBadSha: after?.firstBadSha,
            };
          }),
        });
        persist();
      }
    }
    checkCancellation();
  } catch (error) {
    primaryError = error;
  } finally {
    if (checkoutAttempted) {
      try {
        await deps.restore({
          previousSha: volumeStateUncertain ? null : materializedSha,
          originalSha: input.gitRange.originalExperiment.sha,
        });
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    if (leaseAcquired) {
      try {
        await deps.endSession();
      } catch (error) {
        cleanupErrors.push(new Error(`lease release failed: ${errorMessage(error)}`, { cause: error }));
      }
    }

    if (!primaryError && cancellationSignal) {
      primaryError = new BisectInterruptedError(cancellationSignal);
    }
    if (disposeSignalHandlers) {
      try {
        disposeSignalHandlers();
      } catch (error) {
        cleanupErrors.push(new Error(`signal handler disposal failed: ${errorMessage(error)}`, { cause: error }));
      }
    }

    session = terminalSession(session, primaryError, cleanupErrors, deps.now());
    const loggedStatus = session.status;
    try {
      if (loggedStatus === 'complete' && session.dryRun) {
        logDecision('session-dry-run-complete', 'Compare bisect dry run completed', {
          targets: session.targets.map((target) => targetLogData(target)),
          nextAction: session.nextAction,
          summaryPath: path.join(input.resultsDirectory, 'summary.json'),
        });
      } else if (loggedStatus === 'complete') {
        logDecision('session-complete', session.targets.length === 0
          ? 'No regression targets were present at the bad ref'
          : 'Compare bisect session completed', {
          foundTargets: session.targets.filter((target) => target.status === 'found').map((target) => targetLogData(target)),
          invalidTargets: session.targets.filter((target) => target.status === 'invalid').map((target) => targetLogData(target)),
          unresolvedTargets: session.targets.filter((target) => target.status === 'active').map((target) => targetLogData(target)),
          summaryPath: path.join(input.resultsDirectory, 'summary.json'),
        });
      } else {
        logDecision('session-failed', `Compare bisect ${loggedStatus}: ${session.failure}`);
      }
    } catch (error) {
      cleanupErrors.push(new Error(`decision log persistence failed: ${errorMessage(error)}`, { cause: error }));
      session = terminalSession(session, primaryError, cleanupErrors, deps.now());
    }

    const persistTerminal = (): boolean => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          persist();
          return true;
        } catch (error) {
          cleanupErrors.push(new Error(`session persistence failed: ${errorMessage(error)}`, { cause: error }));
          session = terminalSession(session, primaryError, cleanupErrors, deps.now());
        }
      }
      return false;
    };

    const terminalPersisted = persistTerminal();
    if (terminalPersisted && cleanupErrors.length === 0) {
      try {
        deps.writeSummary(session);
      } catch (error) {
        cleanupErrors.push(new Error(`summary persistence failed: ${errorMessage(error)}`, { cause: error }));
        session = terminalSession(session, primaryError, cleanupErrors, deps.now());
        persistTerminal();
      }
    }
  }

  if (primaryError instanceof Error && cleanupErrors.length > 0) {
    attachCleanupContext(primaryError, cleanupErrors);
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, session.failure);
  }
  return session;
}

function createDefaultDependencies(options: {
  cwd: string;
  config: AbTestsConfig;
  twinServers: ResolvedConfig;
  frozenTests: readonly AbTestDefinition[];
  resultsDirectory: string;
  manifest: BuildManifest;
  gitRange: PreparedGitRange;
  headed: boolean;
  controlURL: string;
  experimentURL: string;
}): ExecuteBisectDependencies {
  const bisectSessionId = randomUUID();
  return {
    installSignalHandlers(handler) {
      process.on('SIGINT', handler);
      process.on('SIGTERM', handler);
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    },
    beginSession: () => proxyBisect<void>(options.twinServers, {
      cmd: 'bisect-begin',
      sessionId: bisectSessionId,
      ownerPid: process.pid,
    }),
    endSession: () => proxyBisect<void>(options.twinServers, {
      cmd: 'bisect-end',
      sessionId: bisectSessionId,
    }),
    checkout: (sha) => checkoutDetached(options.twinServers.experimentDir, sha, {
      allowedPaths: [options.resultsDirectory],
    }),
    restore: ({ previousSha, originalSha }) => restoreExperimentState({
      restoreCheckout: () => restoreCheckout(
        options.twinServers.experimentDir,
        options.gitRange.originalExperiment,
        { allowedPaths: [options.resultsDirectory] },
      ),
      syncVolume: async () => {
        if (previousSha === null) {
          await reconcileExperimentVolume({
            sourceDir: options.twinServers.dockerBuildDir,
            volumeDir: options.twinServers.volumes.experiment,
            manifest: options.manifest,
            candidateSha: originalSha,
          });
          return;
        }
        await syncCommitDelta({
          sourceDir: options.twinServers.dockerBuildDir,
          volumeDir: options.twinServers.volumes.experiment,
          manifest: options.manifest,
          previousSha,
          candidateSha: originalSha,
        });
      },
      refreshExperiment: async () => {
        await refreshExperimentViaMenu(
          options.twinServers,
          options.config,
          preferredRefreshMode(options.config),
          bisectSessionId,
        );
      },
    }),
    clearSummary: () => {
      fs.rmSync(path.join(options.resultsDirectory, 'summary.json'), { force: true });
    },
    materialize: async ({ previousSha, candidateSha }) => {
      if (previousSha === null) {
        await reconcileExperimentVolume({
          sourceDir: options.twinServers.dockerBuildDir,
          volumeDir: options.twinServers.volumes.experiment,
          manifest: options.manifest,
          candidateSha,
        });
        return;
      }
      await syncCommitDelta({
        sourceDir: options.twinServers.dockerBuildDir,
        volumeDir: options.twinServers.volumes.experiment,
        manifest: options.manifest,
        previousSha,
        candidateSha,
      });
    },
    refresh: (request) => refreshExperimentViaMenu(
      options.twinServers,
      options.config,
      request.preferredMode,
      bisectSessionId,
    ),
    compare: (request) => runCompareForCandidate({
      cwd: options.cwd,
      config: options.config,
      frozenTests: options.frozenTests,
      resultsDirectory: options.resultsDirectory,
      sha: request.sha,
      categories: request.categories,
      tests: request.tests,
      headed: options.headed,
      controlURL: options.controlURL,
      experimentURL: options.experimentURL,
    }),
    reuseCurrentResults: async (request) => loadReusableCompareResults({
      cwd: options.cwd,
      tests: options.frozenTests,
      categories: request.categories,
      controlURL: options.controlURL,
      experimentURL: options.experimentURL,
      viewports: viewportsByStageCategory(options.config),
    }),
    writeSession: (session) => writeSessionAtomic(path.join(options.resultsDirectory, 'session.json'), session),
    writeSummary: (session) => writeSummary(path.join(options.resultsDirectory, 'summary.json'), session),
    recordDecision: createDecisionLogWriter(options.resultsDirectory),
    logProgress: (message) => console.log(`[compare bisect] ${message}`),
    now: () => new Date().toISOString(),
  };
}

async function runCompareForCandidate(options: {
  cwd: string;
  config: AbTestsConfig;
  frozenTests: readonly AbTestDefinition[];
  resultsDirectory: string;
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  headed: boolean;
  controlURL: string;
  experimentURL: string;
}): Promise<CompareRunResult> {
  const pipeline = createComparePipeline(comparePipelineConfigFromAbTests(options.config, {
    artifactRoot: path.join(options.resultsDirectory, 'commits', options.sha),
    testPathPattern: options.config.shared.testPathPattern,
  }));
  const tests = filterFrozenTests(options.frozenTests, options.cwd, options.tests);
  const result = await runPipeline(pipeline, {
    cwd: options.cwd,
    tests,
    controlURL: options.controlURL,
    experimentURL: options.experimentURL,
    categories: [...options.categories],
    skipReport: true,
    headed: options.headed,
    retries: options.config.shared.retries,
    retryDelay: options.config.shared.retryDelay,
    timeoutMs: options.config.shared.timeoutMs,
    viewports: viewportsByStageCategory(options.config),
  });
  return {
    testResults: result.testResults,
    compareResultsPath: result.resultsRoot,
  };
}

async function refreshExperimentViaMenu(
  twinServers: ResolvedConfig,
  config: AbTestsConfig,
  preferredMode: RefreshMode,
  sessionId: string,
): Promise<RefreshResult> {
  return proxyBisect<BisectRefreshResult>(twinServers, {
    cmd: 'bisect-refresh',
    sessionId,
    mode: preferredMode,
    rebuildCommands: config.bisect.rebuildCommands.map((command) => command.command),
    noCache: false,
  });
}

async function proxyBisect<T>(
  twinServers: ResolvedConfig,
  payload: ProxyRequestPayload,
): Promise<T> {
  return requireBisectProxy<T>({
    slug: twinServers.projectSlug,
    request: { v: PROTOCOL_VERSION, ...payload },
    verbose: false,
  });
}

function initialSession(input: ExecuteBisectInput, startedAt: string): BisectSession {
  return {
    version: 1,
    status: 'running',
    goodSha: input.gitRange.goodSha,
    badSha: input.gitRange.badSha,
    originalExperiment: input.gitRange.originalExperiment,
    selectedCategories: [...input.selectedCategories],
    orderedCommits: input.gitRange.orderedCommits,
    targets: [],
    commitRuns: {},
    dryRun: input.dryRun,
    validateGoodRef: input.validateGoodRef,
    startedAt,
  };
}

function validateGoodEndpoint(
  session: BisectSession,
  observations: readonly TargetObservation[],
): BisectSession {
  const byTarget = new Map(observations.map((observation) => [observation.targetId, observation]));
  return {
    ...session,
    targets: session.targets.map((target) => {
      const observation = byTarget.get(target.id);
      if (!observation) return target;
      if (observation.present) {
        return {
          ...target,
          status: 'invalid',
          invalidReason: 'target is already present at the good ref',
          observations: {
            ...target.observations,
            [observation.commitSha]: observation,
          },
        };
      }
      return {
        ...target,
        observations: {
          ...target.observations,
          [observation.commitSha]: observation,
        },
      };
    }),
  };
}

function recordEndpointObservations(
  session: BisectSession,
  observations: readonly TargetObservation[],
): BisectSession {
  const byTarget = new Map(observations.map((observation) => [observation.targetId, observation]));
  return {
    ...session,
    targets: session.targets.map((target) => {
      const observation = byTarget.get(target.id);
      if (!observation) return target;
      return {
        ...target,
        observations: {
          ...target.observations,
          [observation.commitSha]: observation,
        },
      };
    }),
  };
}

function terminalSession(
  session: BisectSession,
  primaryError: unknown,
  cleanupErrors: readonly Error[],
  finishedAt: string,
): BisectSession {
  if (cleanupErrors.length > 0) {
    const cleanupFailure = cleanupErrors.map((error) => error.message).join('; ');
    return {
      ...session,
      status: 'failed',
      failure: primaryError
        ? `${errorMessage(primaryError)}; cleanup failed: ${cleanupFailure}`
        : cleanupFailure,
      finishedAt,
    };
  }
  if (primaryError) {
    return {
      ...session,
      status: primaryError instanceof BisectInterruptedError ? 'interrupted' : 'failed',
      failure: errorMessage(primaryError),
      finishedAt,
    };
  }
  return {
    ...session,
    status: 'complete',
    failure: undefined,
    finishedAt,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return asError(error).message;
}

function attachCleanupContext(primaryError: Error, cleanupErrors: readonly Error[]): void {
  const existingCause = primaryError.cause;
  const causes = existingCause === undefined
    ? [...cleanupErrors]
    : [existingCause, ...cleanupErrors];
  const cause = causes.length === 1
    ? causes[0]
    : new AggregateError(causes, cleanupErrors.map((error) => error.message).join('; '));
  Object.defineProperty(primaryError, 'cause', {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: true,
  });
}

function recordCommitRun(session: BisectSession, commitRun: CommitRun): BisectSession {
  return {
    ...session,
    commitRuns: {
      ...session.commitRuns,
      [commitRun.sha]: commitRun,
    },
  };
}

function activeTargets(session: BisectSession): BisectTarget[] {
  return session.targets.filter((target) => target.status === 'active');
}

function categoriesForTargets(targets: readonly BisectTarget[]): BisectCategory[] {
  return unique(targets.map((target) => target.category));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function parseCategories(input: string | string[] | undefined): BisectCategory[] {
  const raw = Array.isArray(input)
    ? input
    : (input ?? comparePipelineMetadata.categories.join(',')).split(',');
  const categories = raw.map((value) => value.trim()).filter(Boolean);
  const valid = new Set<string>(comparePipelineMetadata.categories);
  for (const category of categories) {
    if (!valid.has(category)) {
      throw new Error(`Unknown compare bisect category "${category}"`);
    }
  }
  return categories as BisectCategory[];
}

function preferredRefreshMode(config: AbTestsConfig): RefreshMode {
  if (config.bisect.rebuildContainer || config.bisect.rebuildCommands.length === 0) {
    return 'container';
  }
  return 'commands';
}

export function filterFrozenTests(
  tests: readonly AbTestDefinition[],
  cwd: string,
  selections: readonly BisectTestSelection[],
): AbTestDefinition[] {
  if (selections.length === 0) return [...tests];
  const wanted = new Set(selections.map((selection) => testSelectionKey(cwd, selection)));
  return tests.filter((test) => {
    if (!test.file) return false;
    return wanted.has(testSelectionKey(cwd, {
      testFile: test.file,
      testName: test.name,
    }));
  });
}

function testSelectionKey(cwd: string, selection: BisectTestSelection): string {
  return JSON.stringify([
    normalizeRelativeTestFile(cwd, selection.testFile),
    selection.testName,
  ]);
}

function normalizeRelativeTestFile(cwd: string, testFile: string): string {
  const relative = path.isAbsolute(testFile) ? path.relative(cwd, testFile) : testFile;
  return path.posix.normalize(relative.replace(/\\/g, '/')).replace(/^\.\//, '');
}

function readRequiredBuildManifest(twinServers: ResolvedConfig): BuildManifest {
  const manifest = readBuildManifest(twinServers.volumes.experiment);
  if (!manifest) {
    throw new Error(
      'compare bisect requires an experiment build manifest. ' +
        'Run `shaka-perf servers build --target experiment` first.',
    );
  }
  return manifest;
}

function printBisectSummary(session: BisectSession, resultsDirectory: string): void {
  const found = session.targets.filter((target) => target.status === 'found');
  const invalid = session.targets.filter((target) => target.status === 'invalid');
  const unresolved = session.targets.filter((target) => target.status === 'active');
  console.log('');
  if (session.dryRun) {
    console.log('Compare bisect dry run complete.');
    console.log(`Range: ${session.goodSha}..${session.badSha}`);
    console.log(`Summary: ${path.join(resultsDirectory, 'summary.json')}`);
    console.log(`Decision log: ${path.join(resultsDirectory, 'decision-log.md')}`);
    console.log(`Targets discovered: ${session.targets.length}`);
    for (const target of session.targets) {
      console.log(`  ${target.category} ${target.testName} ${target.viewport} ${target.subject}`);
    }
    if (session.nextAction) {
      const action = session.nextAction.kind === 'validate-good-ref'
        ? 'validate good ref'
        : 'measure midpoint';
      console.log(
        `Next: ${action} ${shortSha(session.nextAction.sha)} ` +
        `for ${session.nextAction.targetIds.length} target(s)`,
      );
      console.log(`Categories: ${session.nextAction.categories.join(', ')}`);
      if (session.nextAction.tests) {
        console.log(`Tests: ${session.nextAction.tests
          .map((test) => `${test.testFile} :: ${test.testName}`)
          .join(', ')}`);
      } else if (session.nextAction.testFiles) {
        console.log(`Test files: ${session.nextAction.testFiles.join(', ')}`);
      }
    } else {
      console.log('Next: no bisect action because no regression targets were discovered.');
    }
    return;
  }
  console.log(`Compare bisect ${session.status}.`);
  console.log(`Summary: ${path.join(resultsDirectory, 'summary.json')}`);
  console.log(`Decision log: ${path.join(resultsDirectory, 'decision-log.md')}`);
  console.log(`Targets: ${found.length} found, ${invalid.length} invalid, ${unresolved.length} unresolved`);
  if (found.length === 0) {
    if (session.targets.length === 0) console.log('No regression targets were present at the bad ref.');
    return;
  }
  for (const target of found) {
    console.log(
      `  ${target.category} ${target.testName} ${target.viewport} ${target.subject}: ` +
      `${shortSha(target.firstBadSha!)}`,
    );
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function createDecisionLogWriter(resultsDirectory: string): (entry: BisectDecisionLogEntry) => void {
  const jsonlPath = path.join(resultsDirectory, 'decision-log.jsonl');
  const markdownPath = path.join(resultsDirectory, 'decision-log.md');
  let initialized = false;

  return (entry) => {
    fs.mkdirSync(resultsDirectory, { recursive: true });
    if (!initialized) {
      fs.writeFileSync(markdownPath, '# Compare Bisect Decision Log\n\n', 'utf8');
      fs.writeFileSync(jsonlPath, '', 'utf8');
      initialized = true;
    }
    fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`, 'utf8');
    fs.appendFileSync(markdownPath, formatDecisionMarkdown(entry), 'utf8');
  };
}

function formatDecisionMarkdown(entry: BisectDecisionLogEntry): string {
  const lines = [
    `- \`${entry.timestamp}\` **${entry.event}** — ${entry.message}`,
  ];
  if (entry.data && Object.keys(entry.data).length > 0) {
    lines.push('');
    lines.push('  ```json');
    lines.push(JSON.stringify(entry.data, null, 2).split('\n').map((line) => `  ${line}`).join('\n'));
    lines.push('  ```');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function targetLogData(target: BisectTarget, orderedCommits?: readonly string[]): Record<string, unknown> {
  return {
    id: target.id,
    category: target.category,
    testFile: target.testFile,
    testName: target.testName,
    viewport: target.viewport,
    subject: target.subject,
    status: target.status,
    firstBadSha: target.firstBadSha,
    invalidReason: target.invalidReason,
    interval: orderedCommits ? intervalLogData(target, orderedCommits) : {
      goodIndex: target.goodIndex,
      badIndex: target.badIndex,
    },
  };
}

function intervalLogData(target: BisectTarget, orderedCommits: readonly string[]): Record<string, unknown> {
  return {
    goodIndex: target.goodIndex,
    goodSha: orderedCommits[target.goodIndex],
    badIndex: target.badIndex,
    badSha: orderedCommits[target.badIndex],
  };
}
