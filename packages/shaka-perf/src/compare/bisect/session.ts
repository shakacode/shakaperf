/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AbTestDefinition } from 'shaka-shared';
import { loadTests } from '../../config-loader';
import { buildAbTestsConfig, viewportsByStageCategory, type AbTestsConfig } from '../../config';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import { runPipeline } from '../../pipeline/runner';
import type { TestResult } from '../../pipeline/report';
import { withAbTestsConfigPath } from '../../effective-config';
import {
  comparePipelineConfigFromAbTests,
  createComparePipeline,
  comparePipelineMetadata,
} from '../compare-pipeline';
import {
  assertNoPipelineErrors,
  evaluateTargetsAtCommitFromTestResults,
  discoverTargets,
} from './analyze';
import {
  checkoutDetached,
  inspectBisectRepositories,
  prepareChildGitRange,
  prepareGitRange,
  restoreCheckout,
  markNativeBisect,
  resetNativeBisect,
  startNativeBisect,
  type BisectRepositorySnapshot,
  type PreparedGitRange,
  type NativeBisectStep,
  type NativeBisectVerdict,
} from './git';
import {
  candidatePlanForGroup,
  createInitialTargetGroup,
  testsForTargets,
} from './search';
import { runNativeSearchPhase } from './phase';
import { buildMergeQueue, runMergeInvestigations } from './merge-investigation';
import {
  writeSessionAtomic,
  writeSummary,
  type BisectSummaryMetadata,
} from './persistence';
import {
  BISECT_REPORT_FILENAME,
  clearPriorBisectReportOutput,
  writeBisectReport,
} from './report';
import { buildBisectReportModel } from './report-model';
import { regenerateBisectReport } from './report-only';
import { reconcileExperimentVolume, syncCommitDelta } from './sync';
import type {
  BisectCategory,
  BisectCompatibility,
  BisectNextAction,
  BisectSearchPhase,
  BisectSession,
  BisectTestSelection,
  BisectTarget,
  BisectTargetGroup,
  CommitRun,
  MergeInvestigation,
  MergeTargetResult,
  PersistedRebuildStrategy,
  TargetEvaluationAtCommit,
} from './types';
import { resolveConfig } from '../../twin-servers/config';
import type { ResolvedConfig } from '../../twin-servers/types';
import { readBuildManifest, type BuildManifest } from '../../twin-servers/helpers/rebuild-check';
import { requireBisectProxy } from '../../twin-servers/ipc/client';
import { PROTOCOL_VERSION, type ProxyRequestPayload } from '../../twin-servers/ipc/protocol';
import type { BisectExperimentReloadResult } from '../../twin-servers/commands/bisect-session';
import {
  BisectInterruptedError,
  runCandidate,
  type CandidateRunProgressEvent,
  type CandidateDependencies,
  type CompareRunRequest,
  type CompareRunResult,
  type SyncCandidateFilesRequest,
  type ExperimentReloadRequest,
  type ExperimentReloadResult,
} from './run-candidate';
import { loadReusableCompareResults } from './reuse-results';
import {
  buildCompatibility,
  prepareResume,
  readBisectSession,
  writeBadRefTestsAtomic,
} from './state';

type ExperimentReloadMode = CommitRun['experimentReloadMode'];

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
  reportOnly?: boolean;
  resume?: boolean;
  investigateMerges?: boolean;
}

export type {
  CompareRunRequest,
  CompareRunResult,
  SyncCandidateFilesRequest,
  ExperimentReloadRequest,
  ExperimentReloadResult,
} from './run-candidate';

export interface RestoreRequest {
  previouslySyncedSha: string | null;
  originalSha: string;
}

export interface RestoreExperimentStateDependencies {
  restoreCheckout(): Promise<void>;
  syncVolume(): Promise<void>;
  reloadExperiment(): Promise<void>;
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
    await dependencies.reloadExperiment();
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
  repositorySnapshot?: BisectRepositorySnapshot;
  compatibility?: BisectCompatibility;
  rebuildStrategy?: PersistedRebuildStrategy;
  resumeSession?: BisectSession;
  resumeBadRefTests?: readonly TestResult[];
  investigateMerges?: boolean;
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
  clearPriorReportOutput(): void;
  writeSession(session: BisectSession): void;
  writeReport(session: BisectSession, badRefTests: readonly TestResult[]): void;
  writeSummary(session: BisectSession, metadata?: BisectSummaryMetadata): void;
  writeBadRefTests?(tests: readonly TestResult[]): string;
  prepareChildRange?(investigation: import('./types').MergeInvestigation): ReturnType<typeof prepareChildGitRange>;
  recordDecision(entry: BisectDecisionLogEntry): void;
  logProgress(message: string): void;
  now(): string;
  reuseCurrentResults(request: ReuseCurrentResultsRequest): Promise<CompareRunResult>;
  startNativeBisect?(group: BisectTargetGroup): Promise<NativeBisectStep>;
  markNativeBisect?(verdict: NativeBisectVerdict): Promise<NativeBisectStep>;
  resetNativeBisect?(): Promise<void>;
  previewNativeBisect?(group: BisectTargetGroup): Promise<NativeBisectStep>;
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
  resume?: boolean;
  investigateMerges?: boolean;
  compatibilityConfig?: unknown;
  gitRange?: PreparedGitRange;
  dependencies?: ExecuteBisectDependencies;
}

export interface BisectCliRuntimeDependencies {
  loadConfig?: typeof loadAbTestsConfig;
  parseConfig?: typeof buildAbTestsConfig;
  resolveTwinServers?: typeof resolveConfig;
  loadFrozenTests?: typeof loadTests;
  run?: typeof runBisect;
  regenerateReport?: typeof regenerateBisectReport;
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
    const config = (runtime.parseConfig ?? buildAbTestsConfig)(raw);
    if (cliOptions.reportOnly) {
      if (goodRef || badRef) {
        throw new Error('compare bisect --report-only does not accept good-ref or bad-ref');
      }
      const pipeline = createComparePipeline(comparePipelineConfigFromAbTests(config));
      const result = (runtime.regenerateReport ?? regenerateBisectReport)({
        resultsDirectory: path.resolve(cwd, 'compare-bisect-results'),
        stages: pipeline.stages,
      });
      console.log(`Bisect report: ${result.htmlPath}`);
      return result.session;
    }
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
      selectedCategories: cliOptions.resume && cliOptions.categories === undefined
        ? []
        : parseCategories(cliOptions.categories),
      frozenTests,
      headed: cliOptions.headed === true,
      controlURL: cliOptions.controlURL,
      experimentURL: cliOptions.experimentURL,
      reuseCurrentResults: cliOptions.reuseCurrentResults === true,
      dryRun: cliOptions.dryRun === true,
      validateGoodRef: cliOptions.validateGoodRef === true,
      resume: cliOptions.resume === true,
      investigateMerges: cliOptions.investigateMerges === true,
      compatibilityConfig: {
        source: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : raw,
        overrides: {
          filter: cliOptions.filter ?? config.shared.filter,
          testPathPattern: cliOptions.testPathPattern ?? config.shared.testPathPattern,
          headed: cliOptions.headed === true,
          controlURL: cliOptions.controlURL ?? config.shared.controlURL,
          experimentURL: cliOptions.experimentURL ?? config.shared.experimentURL,
        },
      },
    });
    printBisectSummary(session, path.resolve(cwd, 'compare-bisect-results'), {
      dryRun: cliOptions.dryRun === true,
      validateGoodRef: cliOptions.validateGoodRef === true,
    });
    return session;
  });
}

export async function runBisect(options: RunBisectOptions): Promise<BisectSession> {
  const prepared = await prepareBisectExecution(options);
  return executeBisect(prepared.input, prepared.dependencies);
}

interface PreparedBisectExecution {
  input: ExecuteBisectInput;
  dependencies: ExecuteBisectDependencies;
}

async function prepareBisectExecution(
  options: RunBisectOptions,
): Promise<PreparedBisectExecution> {
  const resultsDirectory = options.resultsDirectory
    ?? path.resolve(options.cwd, 'compare-bisect-results');
  const preliminaryResume = options.resume
    ? readBisectSession(path.join(resultsDirectory, 'session.json'))
    : null;
  const selectedCategories = preliminaryResume && options.selectedCategories.length === 0
    ? preliminaryResume.compatibility.effective.categories
    : options.selectedCategories;
  const gitRange = await resolveBisectGitRange(options, preliminaryResume);
  const repositorySnapshot =
    await inspectBisectRepositories({
      experimentDir: options.twinServers.experimentDir,
      controlDir: options.twinServers.controlDir,
      allowedPaths: [resultsDirectory],
    });
  const rebuildStrategy = persistedRebuildStrategy(options.config);
  const controlURL = options.controlURL ?? options.config.shared.controlURL;
  const experimentURL = options.experimentURL ?? options.config.shared.experimentURL;
  const compatibility = buildCompatibility({
    config: options.compatibilityConfig
      ?? { config: options.config, headed: options.headed, controlURL, experimentURL },
    categories: selectedCategories,
    tests: frozenTestSelections(options.frozenTests, options.cwd),
    rebuildStrategy,
    range: { goodSha: gitRange.goodSha, badSha: gitRange.badSha },
  });
  const resumed = prepareCompatibleResume({
    preliminaryResume,
    repositorySnapshot,
    resultsDirectory,
    compatibility,
  });
  const input: ExecuteBisectInput = {
    goodRef: options.goodRef,
    badRef: options.badRef,
    cwd: options.cwd,
    resultsDirectory,
    config: options.config,
    twinServers: options.twinServers,
    selectedCategories,
    frozenTests: options.frozenTests,
    gitRange,
    headed: options.headed,
    controlURL,
    experimentURL,
    reuseCurrentResults: options.reuseCurrentResults === true,
    dryRun: options.dryRun === true,
    validateGoodRef: options.validateGoodRef === true,
    repositorySnapshot,
    compatibility,
    rebuildStrategy,
    resumeSession: resumed?.session,
    resumeBadRefTests: resumed?.badRefTests,
    investigateMerges: options.investigateMerges === true,
  };
  const dependencies = options.dependencies ?? createDefaultDependencies({
    cwd: options.cwd,
    config: options.config,
    twinServers: options.twinServers,
    frozenTests: options.frozenTests,
    resultsDirectory,
    manifest: resumed && !resumeRequiresWork(resumed.session, options.investigateMerges === true)
      ? undefined
      : readRequiredBuildManifest(options.twinServers),
    gitRange,
    headed: options.headed,
    controlURL: input.controlURL,
    experimentURL: input.experimentURL,
  });
  return { input, dependencies };
}

async function resolveBisectGitRange(
  options: RunBisectOptions,
  preliminaryResume: BisectSession | null,
): Promise<PreparedGitRange> {
  if (options.gitRange) return options.gitRange;
  if (preliminaryResume) return gitRangeFromSession(preliminaryResume);
  return prepareGitRange({
    experimentDir: options.twinServers.experimentDir,
    controlDir: options.twinServers.controlDir,
    goodRef: options.goodRef,
    badRef: options.badRef,
  });
}

function gitRangeFromSession(session: BisectSession): PreparedGitRange {
  return {
    goodSha: session.primary.goodSha,
    badSha: session.primary.badSha,
    commitSubjects: session.primary.commitSubjects,
    commitParents: session.primary.commitParents,
    orderedCommits: session.primary.orderedCommits,
    originalExperiment: session.originalExperiment,
  };
}

function prepareCompatibleResume(options: {
  preliminaryResume: BisectSession | null;
  repositorySnapshot: BisectRepositorySnapshot | null;
  resultsDirectory: string;
  compatibility: BisectCompatibility;
}) {
  if (!options.preliminaryResume) return null;
  if (!options.repositorySnapshot) {
    throw new Error('Cannot resume compare bisect without configured control and experiment repositories');
  }
  return prepareResume({
    sessionPath: path.join(options.resultsDirectory, 'session.json'),
    resultsDirectory: options.resultsDirectory,
    compatibility: options.compatibility,
    repositories: options.repositorySnapshot,
  });
}

export async function executeBisect(
  input: ExecuteBisectInput,
  deps: ExecuteBisectDependencies,
): Promise<BisectSession> {
  const context = createBisectExecutionContext(input, deps);

  try {
    startBisectExecution(context);
    await acquireBisectLease(context);
    await initializeBisectTargets(context);
    await runPrimaryBisectWorkflow(context);
    await runMergeBisectWorkflow(context);
    context.checkCancellation();
  } catch (error) {
    context.state.primaryError = error;
  } finally {
    await finalizeBisectExecution(context);
  }

  return bisectExecutionResult(context);
}

interface CandidateMeasureOptions {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  targets: readonly BisectTarget[];
  checkout?: boolean;
}

interface BisectExecutionState {
  session: BisectSession;
  badRefTests: readonly TestResult[] | null;
  volumeSyncedSha: string | null;
  volumeStateUncertain: boolean;
  checkoutAttempted: boolean;
  leaseAcquired: boolean;
  primaryError: unknown;
  cleanupErrors: Error[];
  cancellationSignal: NodeJS.Signals | null;
  disposeSignalHandlers: (() => void) | null;
  nextAction: BisectNextAction | undefined;
}

interface BisectExecutionContext {
  input: ExecuteBisectInput;
  deps: ExecuteBisectDependencies;
  state: BisectExecutionState;
  persistSession(): void;
  writeCurrentReport(): void;
  persistSessionAndReport(): void;
  checkCancellation(): void;
  logDecision(event: string, message: string, data?: Record<string, unknown>): void;
  measure(options: CandidateMeasureOptions): ReturnType<typeof runCandidate>;
}

function createBisectExecutionContext(
  input: ExecuteBisectInput,
  deps: ExecuteBisectDependencies,
): BisectExecutionContext {
  fs.mkdirSync(input.resultsDirectory, { recursive: true });
  if (!input.resumeSession) {
    deps.clearSummary();
    deps.clearPriorReportOutput();
  }
  const state: BisectExecutionState = {
    session: input.resumeSession
      ? resumedSession(input.resumeSession)
      : initialSession(input, deps.now()),
    badRefTests: input.resumeBadRefTests ?? null,
    volumeSyncedSha: null,
    volumeStateUncertain: false,
    checkoutAttempted: false,
    leaseAcquired: false,
    primaryError: null,
    cleanupErrors: [],
    cancellationSignal: null,
    disposeSignalHandlers: null,
    nextAction: undefined,
  };
  const context: BisectExecutionContext = {
    input,
    deps,
    state,
    persistSession() {
      deps.writeSession(state.session);
    },
    writeCurrentReport() {
      if (state.badRefTests) deps.writeReport(state.session, state.badRefTests);
    },
    persistSessionAndReport() {
      context.persistSession();
      context.writeCurrentReport();
    },
    checkCancellation() {
      if (state.cancellationSignal) {
        throw new BisectInterruptedError(state.cancellationSignal);
      }
    },
    logDecision(event, message, data) {
      deps.logProgress(message);
      deps.recordDecision({
        timestamp: deps.now(),
        event,
        message,
        data,
      });
    },
    measure(options) {
      return runCandidate({
        ...options,
        previouslySyncedSha: state.volumeSyncedSha,
        preferredExperimentReloadMode: preferredExperimentReloadMode(input.config),
        dependencies: {
          ...deps,
          async checkout(sha) {
            state.checkoutAttempted = true;
            if (options.checkout !== false) await deps.checkout(sha);
          },
          async syncCandidateFilesToExperimentVolume(request) {
            state.volumeStateUncertain = true;
            await deps.syncCandidateFilesToExperimentVolume(request);
            state.volumeStateUncertain = false;
          },
        },
        checkCancellation: context.checkCancellation,
        recordCandidateRunProgress(event: CandidateRunProgressEvent, commitRun: CommitRun) {
          if (event === 'candidate-files-synced') state.volumeSyncedSha = options.sha;
          state.session = recordCommitRun(state.session, commitRun);
          context.persistSessionAndReport();
        },
      });
    },
  };
  return context;
}

function startBisectExecution(context: BisectExecutionContext): void {
  const { input, deps, state } = context;
  state.disposeSignalHandlers = deps.installSignalHandlers((signal) => {
    state.cancellationSignal ??= signal;
  });
  context.persistSessionAndReport();
  context.logDecision('session-start', 'Starting compare bisect session', {
    goodSha: input.gitRange.goodSha,
    badSha: input.gitRange.badSha,
    commits: input.gitRange.orderedCommits.length,
    categories: input.selectedCategories,
    resultsDirectory: input.resultsDirectory,
    decisionLog: path.join(input.resultsDirectory, 'decision-log.md'),
  });
}

async function acquireBisectLease(context: BisectExecutionContext): Promise<void> {
  if (!resumeHasBisectWork(context.input)) {
    context.logDecision(
      'resume-no-work',
      'Saved primary bisect is already complete; no comparisons are required',
    );
    return;
  }
  await context.deps.beginSession();
  context.state.leaseAcquired = true;
  context.logDecision(
    'lease-acquired',
    'Acquired twin-server bisect lease; experiment auto-sync is paused',
  );
  context.persistSessionAndReport();
  context.checkCancellation();
}

function resumeHasBisectWork(input: ExecuteBisectInput): boolean {
  if (!input.resumeSession) return true;
  if (input.resumeSession.primary.status !== 'complete') return true;
  if (!input.investigateMerges) return false;
  return input.resumeSession.mergeQueue.some((sha) => {
    const status = input.resumeSession!.mergeInvestigations[sha]?.status;
    return status !== 'complete' && status !== 'octopus-unsupported';
  });
}

async function initializeBisectTargets(context: BisectExecutionContext): Promise<void> {
  if (context.input.resumeSession) {
    logBisectResume(context);
    return;
  }
  await discoverBadRefTargets(context);
}

function logBisectResume(context: BisectExecutionContext): void {
  const { session } = context.state;
  context.logDecision('session-resume', 'Resuming compatible compare bisect state', {
    phaseStatus: session.primary?.status,
    attempts: session.primary?.attempts.length ?? 0,
  });
}

async function discoverBadRefTargets(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  const badRun = await measureOrReuseBadRef(context);
  state.session = withPrimaryTargets(state.session, discoverTargets(
    badRun.testResults,
    input.selectedCategories,
  ));
  const badRefTargetEvaluations = evaluateTargetsAtCommitFromTestResults(
    badRun.testResults,
    state.session.primary.targets,
    input.gitRange.badSha,
  );
  state.session = recordEndpointTargetEvaluations(state.session, badRefTargetEvaluations);
  state.badRefTests = badRun.testResults;
  if (deps.writeBadRefTests) {
    state.session = {
      ...state.session,
      reportInput: {
        filename: 'bad-ref-tests.json',
        sha256: deps.writeBadRefTests(state.badRefTests),
      },
    };
  }
  context.logDecision(
    'bad-ref-targets',
    `Discovered ${state.session.primary.targets.length} regression target(s) at the bad ref`,
    {
      sha: input.gitRange.badSha,
      targetCount: state.session.primary.targets.length,
      targets: state.session.primary.targets.map((target) => targetLogData(target)),
    },
  );
  context.persistSessionAndReport();
}

async function measureOrReuseBadRef(
  context: BisectExecutionContext,
): Promise<CompareRunResult> {
  const { input, deps, state } = context;
  if (input.reuseCurrentResults) {
    context.logDecision(
      'bad-ref-reuse-start',
      `Reusing current compare results for bad ref ${shortSha(input.gitRange.badSha)}`,
      {
        sha: input.gitRange.badSha,
        categories: input.selectedCategories,
        source: path.join(input.cwd, 'compare-results'),
      },
    );
    const startedAt = deps.now();
    const badRun = await deps.reuseCurrentResults({
      sha: input.gitRange.badSha,
      categories: input.selectedCategories,
    });
    assertNoPipelineErrors(badRun.testResults, input.gitRange.badSha);
    state.session = recordCommitRun(state.session, {
      sha: input.gitRange.badSha,
      compareCompleted: true,
      requestedCategories: [...input.selectedCategories],
      requestedTests: [],
      experimentReloadMode: preferredExperimentReloadMode(input.config),
      usedFallback: false,
      compareResultsPath: badRun.compareResultsPath,
      startedAt,
      finishedAt: deps.now(),
      reusedResults: true,
    });
    context.persistSessionAndReport();
    return badRun;
  }
  context.logDecision(
    'bad-ref-start',
    `Measuring bad ref ${shortSha(input.gitRange.badSha)} to discover regression targets`,
    {
      sha: input.gitRange.badSha,
      categories: input.selectedCategories,
    },
  );
  return context.measure({
    sha: input.gitRange.badSha,
    categories: input.selectedCategories,
    tests: [],
    targets: [],
  });
}

async function runPrimaryBisectWorkflow(
  context: BisectExecutionContext,
): Promise<void> {
  if (context.input.dryRun) {
    await planBisectDryRun(context);
    return;
  }
  if (context.state.session.primary.targets.length === 0) {
    completeEmptyPrimary(context);
    return;
  }
  await runPrimaryBisectSearch(context);
}

async function planBisectDryRun(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  const targets = activeTargets(state.session);
  if (targets.length > 0 && input.validateGoodRef) {
    state.nextAction = {
      kind: 'validate-good-ref' as const,
      sha: input.gitRange.goodSha,
      categories: categoriesForTargets(targets),
      tests: testsForTargets(targets),
      targetIds: targets.map((target) => target.id),
    };
  } else if (targets.length > 0) {
    const group = createInitialTargetGroup(
      'primary-group-1',
      state.session.primary.goodSha,
      state.session.primary.badSha,
      targets,
    );
    const preview = deps.previewNativeBisect;
    if (!preview) throw new Error('compare bisect dry run requires native Git preview support');
    const step = await preview(group);
    if (!step.complete && step.candidateSha) {
      const plannedGroup = { ...group, previewCandidateSha: step.candidateSha };
      state.session = {
        ...state.session,
        primary: { ...state.session.primary, groups: [plannedGroup] },
      };
      const work = candidatePlanForGroup(plannedGroup, targets, step.candidateSha);
      state.nextAction = {
        kind: 'measure-candidate' as const,
        sha: work.sha,
        categories: work.categories,
        tests: work.tests,
        targetIds: work.targetIds,
      };
    }
  }
  context.logDecision(
    'dry-run-plan',
    state.nextAction
      ? `Dry run stopped before ${state.nextAction.kind === 'validate-good-ref'
        ? 'validating good ref'
        : 'measuring midpoint'} ${shortSha(state.nextAction.sha)}`
      : 'Dry run found no regression targets and has no next action',
    state.nextAction ? { nextAction: state.nextAction } : { targetCount: 0 },
  );
  context.persistSessionAndReport();
}

function completeEmptyPrimary(context: BisectExecutionContext): void {
  const { deps, state } = context;
  deps.logProgress('No regression targets were detected at the bad ref');
  const primary = state.session.primary;
  state.session = {
    ...state.session,
    primary: {
      ...primary,
      status: 'complete',
      targets: [],
      startedAt: primary.startedAt ?? deps.now(),
      finishedAt: deps.now(),
    },
  };
  context.persistSessionAndReport();
}

async function runPrimaryBisectSearch(context: BisectExecutionContext): Promise<void> {
  await validateBisectGoodRef(context);
  const { input, deps, state } = context;
  const primary: BisectSearchPhase = state.session.primary;
  let attemptNumber = primary.attempts.length;
  let groupNumber = Math.max(1, ...(primary.groups ?? []).map((group) => {
    const suffix = Number(group.id.match(/-(\d+)$/)?.[1]);
    return Number.isSafeInteger(suffix) ? suffix : 0;
  }));
  const start = deps.startNativeBisect;
  const mark = deps.markNativeBisect;
  const reset = deps.resetNativeBisect;
  if (!start || !mark || !reset) {
    throw new Error('compare bisect requires native Git bisect dependencies');
  }
  const completedPrimary = await runNativeSearchPhase({
    phase: primary,
    preferredExperimentReloadMode: preferredExperimentReloadMode(input.config),
    nextAttemptId: () => `primary-${++attemptNumber}`,
    nextGroupId: () => `primary-group-${++groupNumber}`,
    now: deps.now,
    commitRuns: () => state.session.commitRuns,
    nativeBisect: {
      start(group) {
        state.checkoutAttempted = true;
        return start(group);
      },
      mark,
      reset,
    },
    checkpoint(phase) {
      state.session = { ...state.session, primary: phase };
      context.persistSession();
    },
    afterCheckpoint(phase) {
      state.session = { ...state.session, primary: phase };
      context.writeCurrentReport();
    },
    async measure(work) {
      const targets = state.session.primary.targets.filter((target) => (
        work.targetIds.includes(target.id)
      ));
      const activeGroup = state.session.primary.groups?.find((group) => (
        group.id === state.session.primary.activeGroupId
      ));
      context.logDecision(
        'candidate-selected',
        `Selected Git candidate ${shortSha(work.sha)} for ${targets.length} active target(s)`,
        {
          sha: work.sha,
          categories: work.categories,
          tests: work.tests,
          targets: targets.map((target) => ({
            ...targetLogData(target),
            group: activeGroup ? {
              id: activeGroup.id,
              goodSha: activeGroup.goodSha,
              badSha: activeGroup.badSha,
            } : undefined,
          })),
        },
      );
      const candidateRun = await context.measure({
        sha: work.sha,
        categories: work.categories,
        tests: work.tests,
        targets,
        checkout: false,
      });
      context.logDecision(
        'candidate-observed',
        `Measured ${candidateRun.targetEvaluations.length} evaluation(s) at ${shortSha(work.sha)}`,
        {
          sha: work.sha,
          targetEvaluations: candidateRun.targetEvaluations.map((evaluation) => ({
            targetId: evaluation.targetId,
            regressionDetected: evaluation.regressionDetected,
          })),
        },
      );
      return candidateRun;
    },
  });
  state.session = { ...state.session, primary: completedPrimary };
}

async function validateBisectGoodRef(context: BisectExecutionContext): Promise<void> {
  const { input, state } = context;
  if (!input.validateGoodRef) {
    context.logDecision('good-ref-validation-skipped', 'Skipping experiment-side good-ref validation', {
      sha: input.gitRange.goodSha,
    });
    return;
  }
  const goodTargets = activeTargets(state.session);
  context.logDecision(
    'good-ref-start',
    `Measuring good ref ${shortSha(input.gitRange.goodSha)} to validate the bracket`,
    {
      sha: input.gitRange.goodSha,
      targetCount: goodTargets.length,
      categories: categoriesForTargets(goodTargets),
      tests: testsForTargets(goodTargets),
    },
  );
  const goodRun = await context.measure({
    sha: input.gitRange.goodSha,
    categories: categoriesForTargets(goodTargets),
    tests: testsForTargets(goodTargets),
    targets: goodTargets,
  });
  state.session = validateGoodEndpoint(state.session, goodRun.targetEvaluations);
  const invalidTargets = state.session.primary.targets.filter((target) => (
    target.status === 'invalid'
  ));
  context.logDecision(
    'good-ref-validated',
    `Good ref validated: ${invalidTargets.length} target(s) already detected at good`,
    {
      sha: input.gitRange.goodSha,
      invalidTargets: invalidTargets.map((target) => targetLogData(target)),
      activeTargets: activeTargets(state.session).map((target) => targetLogData(target)),
    },
  );
  context.persistSessionAndReport();
}

async function runMergeBisectWorkflow(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  state.session = buildMergeQueue(state.session);
  context.persistSessionAndReport();
  if (!input.investigateMerges || (state.session.mergeQueue?.length ?? 0) === 0) return;
  if (state.badRefTests) deps.writeSummary(state.session);
  state.session = { ...state.session, mode: 'merge-investigation' };
  let mergeAttemptNumber = Object.values(state.session.mergeInvestigations ?? {})
    .reduce((count, investigation) => count + (investigation.phase?.attempts.length ?? 0), 0);
  let mergeGroupNumber = Object.values(state.session.mergeInvestigations ?? {})
    .reduce((count, investigation) => count + (investigation.phase?.groups?.length ?? 0), 0);
  const start = deps.startNativeBisect;
  const mark = deps.markNativeBisect;
  const reset = deps.resetNativeBisect;
  if (!start || !mark || !reset) {
    throw new Error('compare bisect merge investigation requires native Git bisect dependencies');
  }
  state.session = await runMergeInvestigations({
    session: state.session,
    preferredExperimentReloadMode: preferredExperimentReloadMode(input.config),
    nextAttemptId: () => `merge-${++mergeAttemptNumber}`,
    nextGroupId: () => `merge-group-${++mergeGroupNumber}`,
    nativeBisect: {
      start(group) {
        state.checkoutAttempted = true;
        return start(group);
      },
      mark,
      reset,
    },
    now: deps.now,
    commitRuns: () => state.session.commitRuns,
    checkpoint(updated) {
      state.session = updated;
      context.persistSession();
    },
    afterCheckpoint(updated) {
      state.session = updated;
      context.writeCurrentReport();
    },
    prepareRange(investigation) {
      if (deps.prepareChildRange) return deps.prepareChildRange(investigation);
      return prepareChildGitRange({
        experimentDir: input.twinServers.experimentDir,
        firstParent: investigation.parents[0],
        secondParent: investigation.parents[1],
      });
    },
    measure: (work, targets, checkout) => context.measure({
      sha: work.sha,
      categories: work.categories,
      tests: work.tests,
      targets,
      checkout,
    }),
  });
}

async function finalizeBisectExecution(context: BisectExecutionContext): Promise<void> {
  await restoreExperimentAfterBisect(context);
  await releaseBisectLease(context);
  promoteBisectCancellation(context);
  disposeBisectSignalHandlers(context);
  setTerminalBisectSession(context);
  logTerminalBisectStatus(context);
  const terminalPersisted = persistTerminalBisectState(context);
  if (terminalPersisted && context.state.cleanupErrors.length === 0) {
    writeTerminalBisectSummary(context);
  }
}

async function restoreExperimentAfterBisect(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  if (!state.checkoutAttempted) return;
  try {
    await deps.restore({
      previouslySyncedSha: state.volumeStateUncertain ? null : state.volumeSyncedSha,
      originalSha: input.gitRange.originalExperiment.sha,
    });
  } catch (error) {
    state.cleanupErrors.push(asError(error));
  }
}

async function releaseBisectLease(context: BisectExecutionContext): Promise<void> {
  const { deps, state } = context;
  if (!state.leaseAcquired) return;
  try {
    await deps.endSession();
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `lease release failed: ${errorMessage(error)}`,
      { cause: error },
    ));
  }
}

function promoteBisectCancellation(context: BisectExecutionContext): void {
  const { state } = context;
  if (!state.primaryError && state.cancellationSignal) {
    state.primaryError = new BisectInterruptedError(state.cancellationSignal);
  }
}

function disposeBisectSignalHandlers(context: BisectExecutionContext): void {
  const { state } = context;
  if (!state.disposeSignalHandlers) return;
  try {
    state.disposeSignalHandlers();
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `signal handler disposal failed: ${errorMessage(error)}`,
      { cause: error },
    ));
  }
}

function setTerminalBisectSession(context: BisectExecutionContext): void {
  const { deps, state } = context;
  state.session = terminalSession(
    state.session,
    state.primaryError,
    state.cleanupErrors,
    deps.now(),
  );
}

function logTerminalBisectStatus(context: BisectExecutionContext): void {
  const { input, deps, state } = context;
  const loggedStatus = state.session.status;
  try {
    if (loggedStatus === 'complete' && input.dryRun) {
      context.logDecision('session-dry-run-complete', 'Compare bisect dry run completed', {
        targets: state.session.primary.targets.map((target) => targetLogData(target)),
        nextAction: state.nextAction,
        summaryPath: path.join(input.resultsDirectory, 'summary.json'),
      });
    } else if (loggedStatus === 'complete') {
      context.logDecision(
        'session-complete',
        state.session.primary.targets.length === 0
          ? 'No regression targets were detected at the bad ref'
          : 'Compare bisect session completed',
        {
          foundTargets: state.session.primary.targets
            .filter((target) => target.status === 'found')
            .map((target) => targetLogData(target)),
          invalidTargets: state.session.primary.targets
            .filter((target) => target.status === 'invalid')
            .map((target) => targetLogData(target)),
          unresolvedTargets: state.session.primary.targets
            .filter((target) => target.status === 'active')
            .map((target) => targetLogData(target)),
          summaryPath: path.join(input.resultsDirectory, 'summary.json'),
        },
      );
    } else {
      context.logDecision(
        'session-failed',
        `Compare bisect ${loggedStatus}: ${state.session.failure}`,
      );
    }
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `decision log persistence failed: ${errorMessage(error)}`,
      { cause: error },
    ));
    state.session = terminalSession(
      state.session,
      state.primaryError,
      state.cleanupErrors,
      deps.now(),
    );
  }
}

function persistTerminalBisectState(context: BisectExecutionContext): boolean {
  const { deps, state } = context;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      context.persistSessionAndReport();
      return true;
    } catch (error) {
      state.cleanupErrors.push(new Error(
        `session persistence failed: ${errorMessage(error)}`,
        { cause: error },
      ));
      state.session = terminalSession(
        state.session,
        state.primaryError,
        state.cleanupErrors,
        deps.now(),
      );
    }
  }
  return false;
}

function writeTerminalBisectSummary(context: BisectExecutionContext): void {
  const { input, deps, state } = context;
  try {
    deps.writeSummary(state.session, {
      dryRun: input.dryRun || undefined,
      validateGoodRef: input.validateGoodRef || undefined,
      nextAction: state.nextAction,
    });
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `summary persistence failed: ${errorMessage(error)}`,
      { cause: error },
    ));
    state.session = terminalSession(
      state.session,
      state.primaryError,
      state.cleanupErrors,
      deps.now(),
    );
    persistTerminalBisectState(context);
  }
}

function bisectExecutionResult(context: BisectExecutionContext): BisectSession {
  const { primaryError, cleanupErrors, session } = context.state;
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
  manifest?: BuildManifest;
  gitRange: PreparedGitRange;
  headed: boolean;
  controlURL: string;
  experimentURL: string;
}): ExecuteBisectDependencies {
  const bisectSessionId = randomUUID();
  const reportPipeline = createComparePipeline(comparePipelineConfigFromAbTests(options.config));
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
    startNativeBisect: (group) => startNativeBisect({
      repoDir: options.twinServers.experimentDir,
      goodSha: group.goodSha,
      badSha: group.badSha,
      firstParent: true,
      allowedPaths: [options.resultsDirectory],
    }),
    markNativeBisect: (verdict) => markNativeBisect(
      options.twinServers.experimentDir,
      verdict,
    ),
    resetNativeBisect: () => resetNativeBisect(options.twinServers.experimentDir),
    previewNativeBisect: async (group) => {
      try {
        return await startNativeBisect({
          repoDir: options.twinServers.experimentDir,
          goodSha: group.goodSha,
          badSha: group.badSha,
          firstParent: true,
          noCheckout: true,
          allowedPaths: [options.resultsDirectory],
        });
      } finally {
        await resetNativeBisect(options.twinServers.experimentDir);
      }
    },
    restore: ({ previouslySyncedSha, originalSha }) => restoreExperimentState({
      restoreCheckout: () => restoreCheckout(
        options.twinServers.experimentDir,
        options.gitRange.originalExperiment,
        { allowedPaths: [options.resultsDirectory] },
      ),
      syncVolume: async () => {
        if (previouslySyncedSha === null) {
          await reconcileExperimentVolume({
            sourceDir: options.twinServers.dockerBuildDir,
            volumeDir: options.twinServers.volumes.experiment,
            manifest: requireManifest(options.manifest),
            candidateSha: originalSha,
          });
          return;
        }
        await syncCommitDelta({
          sourceDir: options.twinServers.dockerBuildDir,
          volumeDir: options.twinServers.volumes.experiment,
          manifest: requireManifest(options.manifest),
          previousSha: previouslySyncedSha,
          candidateSha: originalSha,
        });
      },
      reloadExperiment: async () => {
        await reloadExperimentViaMenu(
          options.twinServers,
          options.config,
          preferredExperimentReloadMode(options.config),
          bisectSessionId,
        );
      },
    }),
    clearSummary: () => {
      fs.rmSync(path.join(options.resultsDirectory, 'summary.json'), { force: true });
    },
    clearPriorReportOutput: () => {
      clearPriorBisectReportOutput(options.resultsDirectory);
    },
    syncCandidateFilesToExperimentVolume: async ({ previouslySyncedSha, candidateSha }) => {
      if (previouslySyncedSha === null) {
        await reconcileExperimentVolume({
          sourceDir: options.twinServers.dockerBuildDir,
          volumeDir: options.twinServers.volumes.experiment,
          manifest: requireManifest(options.manifest),
          candidateSha,
        });
        return;
      }
      await syncCommitDelta({
        sourceDir: options.twinServers.dockerBuildDir,
        volumeDir: options.twinServers.volumes.experiment,
        manifest: requireManifest(options.manifest),
        previousSha: previouslySyncedSha,
        candidateSha,
      });
    },
    reloadExperiment: (request) => reloadExperimentViaMenu(
      options.twinServers,
      options.config,
      request.preferredExperimentReloadMode,
      bisectSessionId,
    ),
    runCandidateComparisons: (request) => runCandidateComparisons({
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
    writeReport: (session, badRefTests) => {
      const generatedAt = new Date().toISOString();
      writeBisectReport({
        resultsDirectory: options.resultsDirectory,
        data: {
          meta: {
            title: `${path.basename(options.cwd)} · compare bisect`,
            pipelineName: reportPipeline.name,
            generatedAt,
            controlUrl: options.controlURL,
            experimentUrl: options.experimentURL,
            durationMs: 0,
            cwd: options.cwd,
            errors: [],
            reportOnly: false,
            pipelineConfig: reportPipeline.pipelineConfig,
            reportMode: 'full',
          },
          tests: [...badRefTests],
          bisect: buildBisectReportModel(session, badRefTests, generatedAt),
        },
        stages: reportPipeline.stages,
      });
    },
    writeSummary: (session) => writeSummary(path.join(options.resultsDirectory, 'summary.json'), session),
    writeBadRefTests: (tests) => writeBadRefTestsAtomic(
      path.join(options.resultsDirectory, 'bad-ref-tests.json'),
      tests,
    ),
    recordDecision: createDecisionLogWriter(options.resultsDirectory),
    logProgress: (message) => console.log(`[compare bisect] ${message}`),
    now: () => new Date().toISOString(),
  };
}

async function runCandidateComparisons(options: {
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
    config: options.config,
    tests,
    controlURL: options.controlURL,
    experimentURL: options.experimentURL,
    categories: [...options.categories],
    skipReport: true,
    headed: options.headed,
    retries: options.config.shared.retries,
    retryDelay: options.config.shared.retryDelay,
    timeoutMs: options.config.shared.timeoutMs,
  });
  return {
    testResults: result.testResults,
    compareResultsPath: result.resultsRoot,
  };
}

async function reloadExperimentViaMenu(
  twinServers: ResolvedConfig,
  config: AbTestsConfig,
  preferredExperimentReloadMode: ExperimentReloadMode,
  sessionId: string,
): Promise<ExperimentReloadResult> {
  return proxyBisect<BisectExperimentReloadResult>(twinServers, {
    cmd: 'bisect-refresh',
    sessionId,
    mode: preferredExperimentReloadMode,
    rebuildCommands: configuredRebuildCommands(config).map((command) => command.command),
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
  const rebuildStrategy = input.rebuildStrategy ?? persistedRebuildStrategy(input.config);
  const identity = input.repositorySnapshot?.identity ?? {
    controlRoot: input.twinServers.controlDir ?? input.cwd,
    experimentRoot: input.twinServers.experimentDir ?? input.cwd,
    controlGitCommonDir: input.twinServers.controlDir ?? input.cwd,
    experimentGitCommonDir: input.twinServers.experimentDir ?? input.cwd,
    controlOrigin: null,
    experimentOrigin: null,
  };
  const compatibility = input.compatibility ?? buildCompatibility({
    config: input.config,
    categories: input.selectedCategories,
    tests: frozenTestSelections(input.frozenTests, input.cwd),
    rebuildStrategy,
    range: { goodSha: input.gitRange.goodSha, badSha: input.gitRange.badSha },
  });
  return {
    status: 'running',
    mode: 'primary',
    identity,
    compatibility,
    control: input.repositorySnapshot?.control ?? { branch: null, sha: input.gitRange.goodSha },
    rebuildStrategy,
    reportInput: { filename: 'bad-ref-tests.json', sha256: '' },
    primary: {
      id: 'primary',
      status: 'pending',
      goodSha: input.gitRange.goodSha,
      badSha: input.gitRange.badSha,
      orderedCommits: input.gitRange.orderedCommits,
      commitSubjects: input.gitRange.commitSubjects,
      commitParents: input.gitRange.commitParents,
      targets: [],
      attempts: [],
    },
    mergeQueue: [],
    mergeInvestigations: {},
    originalExperiment: input.gitRange.originalExperiment,
    commitRuns: {},
    startedAt,
  };
}

function resumedSession(saved: BisectSession): BisectSession {
  return {
    ...saved,
    status: 'running',
    mode: saved.primary.status === 'complete' ? 'complete' : 'primary',
    failure: undefined,
    finishedAt: undefined,
  };
}

function persistedRebuildStrategy(config: AbTestsConfig): PersistedRebuildStrategy {
  return {
    mode: preferredExperimentReloadMode(config),
    commands: configuredRebuildCommands(config).map((command) => command.command),
  };
}

function frozenTestSelections(
  tests: readonly AbTestDefinition[],
  cwd: string,
): BisectTestSelection[] {
  return tests.flatMap((test) => test.file ? [{
    testFile: normalizeRelativeTestFile(cwd, test.file),
    testName: test.name,
  }] : []);
}

function validateGoodEndpoint(
  session: BisectSession,
  targetEvaluations: readonly TargetEvaluationAtCommit[],
): BisectSession {
  const byTarget = new Map(targetEvaluations.map((evaluation) => [evaluation.targetId, evaluation]));
  return withPrimaryTargets(session, session.primary.targets.map((target) => {
    const evaluation = byTarget.get(target.id);
    if (!evaluation) return target;
    if (evaluation.regressionDetected) {
      return {
        ...target,
        status: 'invalid',
        invalidReason: 'regression is already detected at the good ref',
        recordedTargetEvaluations: {
          ...target.recordedTargetEvaluations,
          [evaluation.commitSha]: evaluation,
        },
      };
    }
    return {
      ...target,
      recordedTargetEvaluations: {
        ...target.recordedTargetEvaluations,
        [evaluation.commitSha]: evaluation,
      },
    };
  }));
}

function recordEndpointTargetEvaluations(
  session: BisectSession,
  targetEvaluations: readonly TargetEvaluationAtCommit[],
): BisectSession {
  const byTarget = new Map(targetEvaluations.map((evaluation) => [evaluation.targetId, evaluation]));
  return withPrimaryTargets(session, session.primary.targets.map((target) => {
    const evaluation = byTarget.get(target.id);
    if (!evaluation) return target;
    return {
      ...target,
      recordedTargetEvaluations: {
        ...target.recordedTargetEvaluations,
        [evaluation.commitSha]: evaluation,
      },
    };
  }));
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
    mode: 'complete',
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
  return session.primary.targets.filter((target) => target.status === 'active');
}

function withPrimaryTargets(
  session: BisectSession,
  targets: BisectTarget[],
): BisectSession {
  return {
    ...session,
    primary: {
      ...session.primary,
      targets,
    },
  };
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

function preferredExperimentReloadMode(config: AbTestsConfig): ExperimentReloadMode {
  if (config.bisect.rebuildContainer || configuredRebuildCommands(config).length === 0) {
    return 'container';
  }
  return 'commands';
}

function configuredRebuildCommands(config: AbTestsConfig) {
  return config.twinServers?.rebuildCommands ?? [];
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

function requireManifest(manifest: BuildManifest | undefined): BuildManifest {
  if (!manifest) throw new Error('compare bisect work requires an experiment build manifest');
  return manifest;
}

function resumeRequiresWork(session: BisectSession, investigateMerges: boolean): boolean {
  if (session.primary.status !== 'complete') return true;
  if (!investigateMerges) return false;
  return session.mergeQueue.some((sha) => {
    const status = session.mergeInvestigations[sha]?.status;
    return status !== 'complete' && status !== 'octopus-unsupported';
  });
}

function printBisectSummary(
  session: BisectSession,
  resultsDirectory: string,
  options: { dryRun: boolean; validateGoodRef: boolean },
): void {
  const targets = session.primary.targets;
  const found = targets.filter((target) => target.status === 'found');
  const invalid = targets.filter((target) => target.status === 'invalid');
  const unresolved = targets.filter((target) => target.status === 'active');
  console.log('');
  const reportPath = path.join(resultsDirectory, BISECT_REPORT_FILENAME);
  if (fs.existsSync(reportPath)) console.log(`Report: ${reportPath}`);
  if (options.dryRun) {
    const nextAction = dryRunNextAction(session, options.validateGoodRef);
    console.log('Compare bisect dry run complete.');
    console.log(`Range: ${session.primary.goodSha}..${session.primary.badSha}`);
    console.log(`Summary: ${path.join(resultsDirectory, 'summary.json')}`);
    console.log(`Decision log: ${path.join(resultsDirectory, 'decision-log.md')}`);
    console.log(`Targets discovered: ${targets.length}`);
    for (const target of targets) {
      console.log(`  ${target.category} ${target.testName} ${target.viewport} ${target.subject}`);
    }
    if (nextAction) {
      const action = nextAction.kind === 'validate-good-ref'
        ? 'validate good ref'
        : 'measure native bisect candidate';
      console.log(
        `Next: ${action} ${shortSha(nextAction.sha)} ` +
        `for ${nextAction.targetIds.length} target(s)`,
      );
      console.log(`Categories: ${nextAction.categories.join(', ')}`);
      if (nextAction.tests) {
        console.log(`Tests: ${nextAction.tests
          .map((test) => `${test.testFile} :: ${test.testName}`)
          .join(', ')}`);
      } else if (nextAction.testFiles) {
        console.log(`Test files: ${nextAction.testFiles.join(', ')}`);
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
    if (targets.length === 0) console.log('No regression targets were detected at the bad ref.');
    return;
  }
  console.log('Regressions by commit:');
  printFoundTargetsByCommit(session, found);
  const hasUninvestigatedMerge = Object.values(session.mergeInvestigations ?? {})
    .some((investigation) => investigation.status === 'merge-uninvestigated');
  if (hasUninvestigatedMerge) {
    console.log(
      `shaka-perf compare bisect --categories ` +
      `${session.compatibility.effective.categories.join(',')} --resume --investigate-merges`,
    );
  }
}

function printFoundTargetsByCommit(
  session: BisectSession,
  found: readonly BisectTarget[],
): void {
  const targetsByCommit = groupBy(found, (target) => target.firstBadSha!);
  const orderedShas = session.primary.orderedCommits.filter((sha) => targetsByCommit.has(sha));
  for (const sha of targetsByCommit.keys()) {
    if (!orderedShas.includes(sha)) orderedShas.push(sha);
  }

  for (const sha of orderedShas) {
    const commitTargets = targetsByCommit.get(sha)!;
    const subject = session.primary.commitSubjects[sha];
    const investigation = session.mergeInvestigations?.[sha];
    const commitDetails = [subject, mergeInvestigationSummary(investigation?.status)]
      .filter((detail): detail is string => Boolean(detail));
    console.log(`  ${shortSha(sha)}${commitDetails.length > 0 ? ` ${commitDetails.join(' · ')}` : ''}`);

    const targetsByCategory = groupBy(commitTargets, (target) => target.category);
    for (const [category, categoryTargets] of targetsByCategory) {
      console.log(`    ${category}`);
      const targetsByTest = groupBy(
        categoryTargets,
        (target) => `${target.testFile}\0${target.testName}`,
      );
      for (const testTargets of targetsByTest.values()) {
        console.log(`      ${testTargets[0].testName}`);
        for (const target of testTargets) {
          const mergeResult = investigation?.targetResults[target.id];
          console.log(
            `        ${target.viewport}: ${target.subject}${mergeTargetResultSummary(mergeResult)}`,
          );
        }
      }
    }
  }
}

function groupBy<T, K>(values: readonly T[], keyFor: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

function mergeInvestigationSummary(
  status: MergeInvestigation['status'] | undefined,
): string | undefined {
  if (!status) return undefined;
  const labels: Record<MergeInvestigation['status'], string> = {
    'merge-uninvestigated': 'merge · investigation not started',
    running: 'merge · investigation running',
    complete: 'merge · investigation complete',
    'octopus-unsupported': 'merge · octopus investigation unsupported',
    failed: 'merge · investigation failed',
  };
  return labels[status];
}

function mergeTargetResultSummary(result: MergeTargetResult | undefined): string {
  if (!result || result.kind === 'merge-uninvestigated') return '';
  if (result.kind === 'source-found' || result.kind === 'nested-merge') {
    const label = result.kind === 'source-found' ? 'source found' : 'nested merge';
    return ` → source ${shortSha(result.sourceSha)} (${label})`;
  }
  if (result.kind === 'merge-introduced') return ' (introduced by merge)';
  return ' (octopus investigation unsupported)';
}

function dryRunNextAction(
  session: BisectSession,
  validateGoodRef: boolean,
): BisectNextAction | undefined {
  const targets = activeTargets(session);
  if (targets.length === 0) return undefined;
  if (validateGoodRef) {
    return {
      kind: 'validate-good-ref',
      sha: session.primary.goodSha,
      categories: categoriesForTargets(targets),
      tests: testsForTargets(targets),
      targetIds: targets.map((target) => target.id),
    };
  }
  const group = session.primary.groups?.find((candidate) => candidate.previewCandidateSha);
  if (!group?.previewCandidateSha) return undefined;
  return {
    kind: 'measure-candidate',
    ...candidatePlanForGroup(group, session.primary.targets, group.previewCandidateSha),
  };
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

function targetLogData(target: BisectTarget): Record<string, unknown> {
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
  };
}
