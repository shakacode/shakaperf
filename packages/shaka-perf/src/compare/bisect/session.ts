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
import type { TestResult } from '../../pipeline/report';
import { withAbTestsConfigPath } from '../../before-navigate';
import { pairedBenchmarkParallelism } from '../stages/shared/runtime';
import { createComparePipeline, comparePipelineMetadata } from '../compare-pipeline';
import { discoverTargets, observeTargets } from './analyze';
import { checkoutDetached, prepareGitRange, restoreCheckout, type PreparedGitRange } from './git';
import { applyCachedObservations, applyObservations, nextCandidate } from './search';
import { writeSessionAtomic, writeSummary } from './persistence';
import { reconcileExperimentVolume, syncCommitDelta } from './sync';
import type {
  BisectCategory,
  BisectSession,
  BisectTarget,
  CommitRun,
  TargetObservation,
} from './types';
import { loadConfig as loadTwinServersConfig, resolveConfig } from '../../twin-servers/config';
import type { ResolvedConfig } from '../../twin-servers/types';
import { readBuildManifest, type BuildManifest } from '../../twin-servers/helpers/rebuild-check';
import { tryProxy } from '../../twin-servers/ipc/client';
import { EXIT_NEVER_DISPATCHED, EXIT_OK, PROTOCOL_VERSION, type ProxyRequestPayload } from '../../twin-servers/ipc/protocol';

type RefreshMode = CommitRun['refreshMode'];

export interface BisectCliOptions {
  configPath?: string;
  categories?: string | string[];
  filter?: string;
  testPathPattern?: string;
  headed?: boolean;
}

export interface CompareRunRequest {
  sha: string;
  categories: readonly BisectCategory[];
  testFiles: readonly string[];
}

export interface CompareRunResult {
  testResults: readonly TestResult[];
  compareResultsPath?: string;
}

export interface RefreshRequest {
  sha: string;
  preferredMode: RefreshMode;
}

export interface RefreshResult {
  mode: RefreshMode;
  usedFallback: boolean;
}

export interface MaterializeRequest {
  previousSha: string | null;
  candidateSha: string;
}

export interface RestoreRequest {
  previousSha: string | null;
  originalSha: string;
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
}

export interface ExecuteBisectDependencies {
  beginSession(): Promise<void>;
  endSession(): Promise<void>;
  checkout(sha: string): Promise<void>;
  restore(request: RestoreRequest): Promise<void>;
  materialize(request: MaterializeRequest): Promise<void>;
  refresh(request: RefreshRequest): Promise<RefreshResult>;
  compare(request: CompareRunRequest): Promise<CompareRunResult>;
  writeSession(session: BisectSession): void;
  writeSummary(session: BisectSession): void;
  recordDecision(entry: BisectDecisionLogEntry): void;
  logProgress(message: string): void;
  now(): string;
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
): Promise<BisectSession> {
  const cwd = process.cwd();
  const configPath = cliOptions.configPath ?? findAbTestsConfig(cwd);
  if (!configPath) throw new Error('No abtests.config.ts found. Pass one with --config.');

  return withAbTestsConfigPath(configPath, async () => {
    const raw = await loadAbTestsConfig(configPath);
    const config = parseAbTestsConfig(raw);
    if (!config.twinServers) {
      throw new Error('compare bisect requires a twinServers section in abtests.config.ts');
    }
    const twinServers = resolveConfig(await loadTwinServersConfig(configPath), cwd);
    const frozenTests = await loadTests({
      testPathPattern: cliOptions.testPathPattern ?? config.shared.testPathPattern,
      filter: cliOptions.filter ?? config.shared.filter,
      log: (message) => console.log(message),
    });
    const gitRange = await prepareGitRange({
      experimentDir: twinServers.experimentDir,
      controlDir: twinServers.controlDir,
      goodRef,
      badRef,
    });
    const resultsDirectory = path.resolve(cwd, 'compare-bisect-results');
    const selectedCategories = parseCategories(cliOptions.categories);
    const manifest = readRequiredBuildManifest(twinServers);

    const session = await executeBisect({
      goodRef,
      badRef,
      cwd,
      resultsDirectory,
      config,
      twinServers,
      selectedCategories,
      frozenTests,
      gitRange,
      headed: cliOptions.headed === true,
    }, createDefaultDependencies({
      cwd,
      config,
      twinServers,
      frozenTests,
      resultsDirectory,
      manifest,
      gitRange,
      headed: cliOptions.headed === true,
    }));
    printBisectSummary(session, resultsDirectory);
    return session;
  });
}

export async function executeBisect(
  input: ExecuteBisectInput,
  deps: ExecuteBisectDependencies,
): Promise<BisectSession> {
  fs.mkdirSync(input.resultsDirectory, { recursive: true });
  let session = initialSession(input, deps.now());
  let materializedSha: string | null = null;
  let leaseAcquired = false;
  let primaryError: unknown = null;

  const persist = (): void => {
    deps.writeSession(session);
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

  try {
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

    logDecision('bad-ref-start', `Measuring bad ref ${shortSha(input.gitRange.badSha)} to discover regression targets`, {
      sha: input.gitRange.badSha,
      categories: input.selectedCategories,
    });
    const badRun = await runMeasuredCommit({
      input,
      deps,
      sha: input.gitRange.badSha,
      previousSha: materializedSha,
      categories: input.selectedCategories,
      testFiles: [],
    });
    materializedSha = input.gitRange.badSha;
    session = recordCommitRun(session, badRun.commitRun);
    assertSuccessfulRun(badRun.commitRun);
    session = {
      ...session,
      targets: discoverTargets(
        badRun.compare.testResults,
        input.gitRange.orderedCommits,
        input.gitRange.badSha,
      ),
    };
    logDecision('bad-ref-targets', `Discovered ${session.targets.length} regression target(s) at the bad ref`, {
      sha: input.gitRange.badSha,
      targetCount: session.targets.length,
      targets: session.targets.map((target) => targetLogData(target)),
    });
    persist();

    if (session.targets.length === 0) {
      logDecision('session-complete', 'No regression targets were present at the bad ref');
      session = completeSession(session, deps.now());
      deps.writeSummary(session);
      persist();
      return session;
    }

    const goodTargets = activeTargets(session);
    logDecision('good-ref-start', `Measuring good ref ${shortSha(input.gitRange.goodSha)} to validate the bracket`, {
      sha: input.gitRange.goodSha,
      targetCount: goodTargets.length,
      categories: categoriesForTargets(goodTargets),
      testFiles: testFilesForTargets(goodTargets),
    });
    const goodRun = await runMeasuredCommit({
      input,
      deps,
      sha: input.gitRange.goodSha,
      previousSha: materializedSha,
      categories: categoriesForTargets(goodTargets),
      testFiles: testFilesForTargets(goodTargets),
    });
    materializedSha = input.gitRange.goodSha;
    session = recordCommitRun(session, goodRun.commitRun);
    assertSuccessfulRun(goodRun.commitRun);
    let goodObservations: TargetObservation[];
    try {
      goodObservations = observeTargets(goodRun.compare.testResults, goodTargets, input.gitRange.goodSha);
    } catch (error) {
      session = markCommitRunInfrastructureError(session, input.gitRange.goodSha, (error as Error).message);
      throw new Error(`Candidate ${input.gitRange.goodSha} failed: ${(error as Error).message}`);
    }
    session = validateGoodEndpoint(
      session,
      goodObservations,
    );
    const invalidTargets = session.targets.filter((target) => target.status === 'invalid');
    logDecision('good-ref-validated', `Good ref validated: ${invalidTargets.length} target(s) already present at good`, {
      sha: input.gitRange.goodSha,
      invalidTargets: invalidTargets.map((target) => targetLogData(target)),
      activeTargets: activeTargets(session).map((target) => targetLogData(target)),
    });
    persist();

    while (true) {
      const normalized = applyCachedObservations(session);
      const work = nextCandidate(normalized);
      if (!work) break;

      const targets = session.targets.filter((target) => work.targetIds.includes(target.id));
      logDecision('candidate-selected', `Selected midpoint ${shortSha(work.sha)} for ${targets.length} active target(s)`, {
        sha: work.sha,
        categories: work.categories,
        testFiles: work.testFiles,
        targets: targets.map((target) => targetLogData(target, input.gitRange.orderedCommits)),
      });
      const candidateRun = await runMeasuredCommit({
        input,
        deps,
        sha: work.sha,
        previousSha: materializedSha,
        categories: work.categories,
        testFiles: work.testFiles,
      });
      materializedSha = work.sha;
      session = recordCommitRun(session, candidateRun.commitRun);
      assertSuccessfulRun(candidateRun.commitRun);
      let targetObservations: TargetObservation[];
      try {
        targetObservations = observeTargets(candidateRun.compare.testResults, targets, work.sha);
      } catch (error) {
        session = markCommitRunInfrastructureError(session, work.sha, (error as Error).message);
        throw new Error(`Candidate ${work.sha} failed: ${(error as Error).message}`);
      }
      const observations = new Map(
        targetObservations
          .map((observation) => [observation.targetId, observation]),
      );
      const beforeTargets = new Map(session.targets.map((target) => [target.id, target]));
      session = applyObservations(session, work.sha, observations);
      logDecision('candidate-observed', `Applied ${targetObservations.length} observation(s) from ${shortSha(work.sha)}`, {
        sha: work.sha,
        observations: targetObservations.map((observation) => {
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

    session = completeSession(session, deps.now());
    logDecision('session-complete', 'Compare bisect session completed', {
      foundTargets: session.targets.filter((target) => target.status === 'found').map((target) => targetLogData(target)),
      invalidTargets: session.targets.filter((target) => target.status === 'invalid').map((target) => targetLogData(target)),
      unresolvedTargets: session.targets.filter((target) => target.status === 'active').map((target) => targetLogData(target)),
      summaryPath: path.join(input.resultsDirectory, 'summary.json'),
    });
    deps.writeSummary(session);
    persist();
    return session;
  } catch (error) {
    primaryError = error;
    logDecision('session-failed', `Compare bisect failed: ${(error as Error).message}`);
    session = {
      ...session,
      status: 'failed',
      failure: (error as Error).message,
      finishedAt: deps.now(),
    };
    deps.writeSummary(session);
    persist();
    throw error;
  } finally {
    await cleanupBisect({
      deps,
      leaseAcquired,
      restoreRequest: {
        previousSha: materializedSha,
        originalSha: input.gitRange.originalExperiment.sha,
      },
      primaryError,
    });
  }
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
}): ExecuteBisectDependencies {
  const bisectToken = randomUUID();
  return {
    beginSession: () => proxyStrict(options.twinServers, {
      cmd: 'bisect-begin',
      token: bisectToken,
      ownerPid: process.pid,
    }),
    endSession: () => proxyStrict(options.twinServers, {
      cmd: 'bisect-end',
      token: bisectToken,
    }),
    checkout: (sha) => checkoutDetached(options.twinServers.experimentDir, sha, {
      allowedPaths: [options.resultsDirectory],
    }),
    restore: async ({ previousSha, originalSha }) => {
      await restoreCheckout(options.twinServers.experimentDir, options.gitRange.originalExperiment, {
        allowedPaths: [options.resultsDirectory],
      });
      if (previousSha === null || previousSha === originalSha) return;
      await syncCommitDelta({
        sourceDir: options.twinServers.dockerBuildDir,
        volumeDir: options.twinServers.volumes.experiment,
        manifest: options.manifest,
        previousSha,
        candidateSha: originalSha,
      });
      await refreshExperimentViaMenu(options.twinServers, options.config, preferredRefreshMode(options.config), bisectToken);
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
      bisectToken,
    ),
    compare: (request) => runCompareForCandidate({
      cwd: options.cwd,
      config: options.config,
      frozenTests: options.frozenTests,
      resultsDirectory: options.resultsDirectory,
      sha: request.sha,
      categories: request.categories,
      testFiles: request.testFiles,
      headed: options.headed,
    }),
    writeSession: (session) => writeSessionAtomic(path.join(options.resultsDirectory, 'session.json'), session),
    writeSummary: (session) => writeSummary(path.join(options.resultsDirectory, 'summary.json'), session),
    recordDecision: createDecisionLogWriter(options.resultsDirectory),
    logProgress: (message) => console.log(`[compare bisect] ${message}`),
    now: () => new Date().toISOString(),
  };
}

async function runMeasuredCommit(options: {
  input: ExecuteBisectInput;
  deps: ExecuteBisectDependencies;
  sha: string;
  previousSha: string | null;
  categories: readonly BisectCategory[];
  testFiles: readonly string[];
}): Promise<{ commitRun: CommitRun; compare: CompareRunResult }> {
  const startedAt = options.deps.now();
  const preferredMode = preferredRefreshMode(options.input.config);
  const baseRun: CommitRun = {
    sha: options.sha,
    requestedCategories: [...options.categories],
    requestedTestFiles: [...options.testFiles],
    refreshMode: preferredMode,
    usedFallback: false,
    startedAt,
  };

  try {
    options.deps.logProgress(`Checking out ${shortSha(options.sha)}`);
    await options.deps.checkout(options.sha);
    options.deps.logProgress(`Syncing experiment volume for ${shortSha(options.sha)}`);
    await options.deps.materialize({
      previousSha: options.previousSha,
      candidateSha: options.sha,
    });
    options.deps.logProgress(`Refreshing experiment server for ${shortSha(options.sha)} using ${preferredMode} mode`);
    const refresh = await options.deps.refresh({ sha: options.sha, preferredMode });
    options.deps.logProgress(
      `Running compare for ${shortSha(options.sha)} ` +
      `(${options.categories.join(', ') || 'no categories'}, ${formatTestScope(options.testFiles)})`,
    );
    const compare = await options.deps.compare({
      sha: options.sha,
      categories: options.categories,
      testFiles: options.testFiles,
    });
    options.deps.logProgress(
      `Finished ${shortSha(options.sha)} ` +
      `(refresh=${refresh.mode}${refresh.usedFallback ? ', fallback=true' : ''})`,
    );
    return {
      compare,
      commitRun: {
        ...baseRun,
        refreshMode: refresh.mode,
        usedFallback: refresh.usedFallback,
        compareResultsPath: compare.compareResultsPath,
        finishedAt: options.deps.now(),
      },
    };
  } catch (error) {
    options.deps.logProgress(`Candidate ${shortSha(options.sha)} failed: ${(error as Error).message}`);
    return {
      compare: { testResults: [] },
      commitRun: {
        ...baseRun,
        finishedAt: options.deps.now(),
        infrastructureError: (error as Error).message,
      },
    };
  }
}

async function runCompareForCandidate(options: {
  cwd: string;
  config: AbTestsConfig;
  frozenTests: readonly AbTestDefinition[];
  resultsDirectory: string;
  sha: string;
  categories: readonly BisectCategory[];
  testFiles: readonly string[];
  headed: boolean;
}): Promise<CompareRunResult> {
  const pipeline = createComparePipeline({
    artifactRoot: path.join(options.resultsDirectory, 'commits', options.sha),
    parallelism: pairedBenchmarkParallelism(options.config.shared.parallelism),
    testPathPattern: options.config.shared.testPathPattern,
    visregDefaultMisMatchThreshold: options.config.visreg.defaultMisMatchThreshold,
    visregMaxNumDiffPixels: options.config.visreg.maxNumDiffPixels,
    visregComparePixelmatchThreshold: options.config.visreg.comparePixelmatchThreshold,
    visregEngineOptions: options.config.visreg.engineOptions,
    visregResembleOutputOptions: options.config.visreg.resembleOutputOptions,
    visregCompareRetries: options.config.visreg.compareRetries,
    visregCompareRetryDelay: options.config.visreg.compareRetryDelay,
    perfNumberOfMeasurements: options.config.perf.numberOfMeasurements,
    perfRegressionThreshold: options.config.perf.regressionThreshold,
    perfPValueThreshold: options.config.perf.pValueThreshold,
    perfRegressionThresholdStat: options.config.perf.regressionThresholdStat,
    perfSamplingMode: options.config.perf.samplingMode,
    perfLighthouseConfig: options.config.perf.lighthouseConfig,
    perfPlotTitle: options.config.perf.plotTitle,
    accessibility: options.config.accessibility,
  });
  const tests = filterFrozenTests(options.frozenTests, options.cwd, options.testFiles);
  const result = await runPipeline(pipeline, {
    cwd: options.cwd,
    tests,
    controlURL: options.config.shared.controlURL,
    experimentURL: options.config.shared.experimentURL,
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
  token: string,
): Promise<RefreshResult> {
  if (preferredMode === 'container') {
    await proxyStrict(twinServers, {
      cmd: 'bisect-refresh',
      token,
      mode: 'container',
      commands: [],
      noCache: false,
    });
    return { mode: 'container', usedFallback: false };
  }

  try {
    await proxyStrict(twinServers, {
      cmd: 'bisect-refresh',
      token,
      mode: 'commands',
      commands: config.bisect.rebuildCommands.map((command) => command.command),
      noCache: false,
    });
    return { mode: 'commands', usedFallback: false };
  } catch (error) {
    console.warn(`[compare bisect] command refresh failed: ${(error as Error).message}`);
    await proxyStrict(twinServers, {
      cmd: 'bisect-refresh',
      token,
      mode: 'container',
      commands: [],
      noCache: false,
    });
    return { mode: 'container', usedFallback: true };
  }
}

async function cleanupBisect(options: {
  deps: ExecuteBisectDependencies;
  leaseAcquired: boolean;
  restoreRequest: RestoreRequest;
  primaryError: unknown;
}): Promise<void> {
  let cleanupError: unknown = null;
  try {
    await options.deps.restore(options.restoreRequest);
  } catch (error) {
    cleanupError = error;
  }

  if (options.leaseAcquired) {
    try {
      await options.deps.endSession();
    } catch (error) {
      cleanupError = cleanupError
        ? new Error(`${(cleanupError as Error).message}; lease release failed: ${(error as Error).message}`)
        : error;
    }
  }

  if (!cleanupError) return;
  if (options.primaryError) {
    console.error(`[compare bisect] cleanup failed after primary error: ${(cleanupError as Error).message}`);
    return;
  }
  throw cleanupError;
}

async function proxyStrict(
  twinServers: ResolvedConfig,
  payload: ProxyRequestPayload,
): Promise<void> {
  const outcome = await tryProxy({
    slug: twinServers.projectSlug,
    request: { v: PROTOCOL_VERSION, ...payload },
    verbose: false,
  });
  if (!outcome.proxied || outcome.code === EXIT_NEVER_DISPATCHED) {
    throw new Error('compare bisect requires an active `shaka-perf servers` menu session');
  }
  if (outcome.code !== EXIT_OK) {
    throw new Error(outcome.error ?? `proxied ${payload.cmd} exited ${outcome.code}`);
  }
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

function completeSession(session: BisectSession, finishedAt: string): BisectSession {
  return { ...session, status: 'complete', finishedAt };
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

function assertSuccessfulRun(commitRun: CommitRun): void {
  if (commitRun.infrastructureError) {
    throw new Error(`Candidate ${commitRun.sha} failed: ${commitRun.infrastructureError}`);
  }
}

function markCommitRunInfrastructureError(
  session: BisectSession,
  sha: string,
  message: string,
): BisectSession {
  const existing = session.commitRuns[sha];
  if (!existing) return session;
  return {
    ...session,
    commitRuns: {
      ...session.commitRuns,
      [sha]: {
        ...existing,
        infrastructureError: message,
      },
    },
  };
}

function activeTargets(session: BisectSession): BisectTarget[] {
  return session.targets.filter((target) => target.status === 'active');
}

function categoriesForTargets(targets: readonly BisectTarget[]): BisectCategory[] {
  return unique(targets.map((target) => target.category));
}

function testFilesForTargets(targets: readonly BisectTarget[]): string[] {
  return unique(targets.map((target) => target.testFile));
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

function filterFrozenTests(
  tests: readonly AbTestDefinition[],
  cwd: string,
  testFiles: readonly string[],
): AbTestDefinition[] {
  if (testFiles.length === 0) return [...tests];
  const wanted = new Set(testFiles);
  return tests.filter((test) => {
    if (!test.file) return false;
    return wanted.has(path.relative(cwd, test.file));
  });
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

function formatTestScope(testFiles: readonly string[]): string {
  if (testFiles.length === 0) return 'all tests';
  if (testFiles.length === 1) return testFiles[0];
  return `${testFiles.length} test files`;
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
