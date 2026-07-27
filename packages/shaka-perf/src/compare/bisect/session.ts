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
import type { AbTestDefinition } from 'shaka-shared';
import { loadTests } from '../../config-loader';
import { parseAbTestsConfig, type AbTestsConfig } from '../../config';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import type { TestResult } from '../../pipeline/report';
import { withAbTestsConfigPath } from '../../before-navigate';
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
  inspectBisectRepositories,
  prepareGitRange,
  type BisectRepositorySnapshot,
  type PreparedGitRange,
} from './git';
import {
  candidatePlanForGroup,
  createInitialTargetGroup,
  testsForTargets,
} from './search';
import { NativeBisectPhaseRunner } from './native-phase-runner';
import { PrimaryPhaseStore } from './phase-store';
import type { PhaseTransition } from './phase-transition';
import { CompareBisectSession } from './session-owner';
import {
  buildMergeQueue,
  MergeInvestigationRunner,
} from './merge-investigation';
import { BISECT_REPORT_FILENAME } from './report';
import { regenerateBisectReport } from './report-only';
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
  PersistedRebuildStrategy,
  TargetEvaluationAtCommit,
} from './types';
import { resolveConfig } from '../../twin-servers/config';
import type { ResolvedConfig } from '../../twin-servers/types';
import {
  BisectInterruptedError,
  CandidateEvaluator,
  containsBisectInterruption,
  findCandidateEvaluationError,
  type CandidateResult,
  type CompareRunRequest,
  type CompareRunResult,
  type ExperimentReloadRequest,
  type ExperimentReloadResult,
} from './run-candidate';
import {
  EndpointMeasurementRunner,
  EndpointRestoreError,
  EndpointValidator,
} from './endpoint-validator';
import { BisectRunEnvironment } from './run-environment';
import { normalizeRelativeTestFile } from './test-selection';
export { filterFrozenTests } from './test-selection';
import {
  configuredRebuildCommands,
  createDefaultBisectDependencies,
  preferredExperimentReloadMode,
  type BisectDecisionLogEntry,
  type ExecuteBisectDependencies,
} from './execution-services';
export type {
  BisectArtifactStore,
  BisectClock,
  BisectDecisionLogEntry,
  BisectDecisionLogger,
  BisectServerSession,
  BisectSignalHandlers,
  ExecuteBisectDependencies,
  ExperimentRestoration,
  ReusableCompareResults,
  ReuseCurrentResultsRequest,
} from './execution-services';
import {
  buildCompatibility,
  prepareResume,
  readBisectSession,
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
  ExperimentReloadRequest,
  ExperimentReloadResult,
} from './run-candidate';

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
  parseConfig?: typeof parseAbTestsConfig;
  resolveTwinServers?: typeof resolveConfig;
  loadFrozenTests?: typeof loadTests;
  run?: typeof runBisect;
  regenerateReport?: typeof regenerateBisectReport;
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
  const dependencies = options.dependencies ?? createDefaultBisectDependencies({
    cwd: options.cwd,
    config: options.config,
    twinServers: options.twinServers,
    frozenTests: options.frozenTests,
    resultsDirectory,
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
  return new CompareBisectOrchestrator(input, deps).run();
}

interface CandidateMeasureOptions {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
  targets: readonly BisectTarget[];
}

interface BisectExecutionState {
  session: BisectSession;
  owner: CompareBisectSession;
  badRefTests: readonly TestResult[] | null;
  endpointValidator: EndpointValidator;
  candidateEvaluator: CandidateEvaluator;
  endpointRestoreError: EndpointRestoreError | null;
  requiresExperimentRestore: boolean;
  leaseAcquired: boolean;
  primaryError: unknown;
  cleanupErrors: Error[];
  environment: BisectRunEnvironment;
  disposeSignalHandlers: (() => void) | null;
  nextAction: BisectNextAction | undefined;
}

/** Owns the complete compare-bisect command lifecycle and its live object graph. */
class CompareBisectOrchestrator {
  readonly state: BisectExecutionState;

  constructor(
    readonly input: ExecuteBisectInput,
    readonly deps: ExecuteBisectDependencies,
  ) {
    fs.mkdirSync(input.resultsDirectory, { recursive: true });
    if (!input.resumeSession) deps.artifacts.clearPrevious();
    const initial = input.resumeSession
      ? resumedSession(input.resumeSession)
      : initialSession(input, deps.clock.now());
    const environment = new BisectRunEnvironment(() => deps.clock.now());
    const owner = new CompareBisectSession(initial, {
      persistence: {
        async write(session) {
          deps.artifacts.writeSession(session);
        },
      },
      transitions: {
        record: async (transition, session) => recordPhaseDecision(this, transition, session),
      },
      reports: {
        write: async (session) => {
          if (this.state.badRefTests) {
            deps.artifacts.writeReport(session, this.state.badRefTests);
          }
        },
      },
    });
    const endpointValidator = new EndpointValidator(
      deps.exactCheckout,
      new EndpointMeasurementRunner(
        deps.server,
        deps.comparison,
        environment,
        preferredExperimentReloadMode(input.config),
      ),
    );
    this.state = {
      get session() {
        return owner.current();
      },
      set session(next: BisectSession) {
        owner.replace(next);
      },
      owner,
      badRefTests: input.resumeBadRefTests ?? null,
      endpointValidator,
      candidateEvaluator: new CandidateEvaluator(
        deps.nativeGit,
        deps.server,
        deps.comparison,
        environment,
        preferredExperimentReloadMode(input.config),
      ),
      endpointRestoreError: null,
      requiresExperimentRestore: false,
      leaseAcquired: false,
      primaryError: null,
      cleanupErrors: [],
      environment,
      disposeSignalHandlers: null,
      nextAction: undefined,
    };
  }

  async run(): Promise<BisectSession> {
    try {
      await startBisectExecution(this);
      await acquireBisectLease(this);
      await initializeBisectTargets(this);
      await runPrimaryBisectWorkflow(this);
      await runMergeBisectWorkflow(this);
      this.checkCancellation();
    } catch (error) {
      this.state.primaryError = error;
    } finally {
      await finalizeBisectExecution(this);
    }
    return bisectExecutionResult(this);
  }

  save(): Promise<void> {
    return this.state.owner.save(this.state.session);
  }

  checkCancellation(): void {
    this.state.environment.checkCancellation();
  }

  logDecision(event: string, message: string, data?: Record<string, unknown>): void {
    this.deps.decisions.progress(message);
    this.deps.decisions.record({
      timestamp: this.state.environment.now(),
      event,
      message,
      data,
    });
  }

  async measureEndpoint(options: CandidateMeasureOptions): Promise<CandidateResult> {
    this.state.requiresExperimentRestore = true;
    try {
      return await this.state.endpointValidator.validate({
        sha: options.sha,
        categories: [...options.categories],
        tests: [...options.tests],
        targetIds: options.targets.map((target) => target.id),
        targets: [...options.targets],
      });
    } catch (error) {
      if (error instanceof EndpointRestoreError) {
        this.state.endpointRestoreError = error;
        return error.result;
      }
      const evaluationError = findCandidateEvaluationError(error);
      if (evaluationError) {
        this.state.session = recordCommitRun(this.state.session, evaluationError.commitRun);
        await this.save();
        if (error === evaluationError
          && evaluationError.originalError instanceof BisectInterruptedError) {
          throw evaluationError.originalError;
        }
      }
      throw error;
    }
  }

  throwEndpointRestoreError(): void {
    const error = this.state.endpointRestoreError;
    this.state.endpointRestoreError = null;
    if (error) throw error;
  }
}

type BisectExecutionContext = CompareBisectOrchestrator;

async function startBisectExecution(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  state.disposeSignalHandlers = deps.signals.install((signal) => {
    state.environment.cancel(signal);
  });
  await context.save();
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
  await context.deps.server.begin();
  context.state.leaseAcquired = true;
  context.logDecision(
    'lease-acquired',
    'Acquired twin-server bisect lease; unrelated lifecycle actions are paused',
  );
  await context.save();
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
  state.session = recordCommitRun(state.session, badRun.commitRun);
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
  state.session = {
    ...state.session,
    reportInput: {
      filename: 'bad-ref-tests.json',
      sha256: deps.artifacts.writeBadRefTests(state.badRefTests),
    },
  };
  context.logDecision(
    'bad-ref-targets',
    `Discovered ${state.session.primary.targets.length} regression target(s) at the bad ref`,
    {
      sha: input.gitRange.badSha,
      targetCount: state.session.primary.targets.length,
      targets: state.session.primary.targets.map((target) => targetLogData(target)),
    },
  );
  await context.save();
  context.throwEndpointRestoreError();
}

async function measureOrReuseBadRef(
  context: BisectExecutionContext,
): Promise<CompareRunResult & { commitRun: CommitRun }> {
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
    const startedAt = state.environment.now();
    const badRun = await deps.reusableResults.load({
      sha: input.gitRange.badSha,
      categories: input.selectedCategories,
    });
    assertNoPipelineErrors(badRun.testResults, input.gitRange.badSha);
    const commitRun: CommitRun = {
      sha: input.gitRange.badSha,
      compareCompleted: true,
      requestedCategories: [...input.selectedCategories],
      requestedTests: [],
      experimentReloadMode: preferredExperimentReloadMode(input.config),
      usedFallback: false,
      compareResultsPath: badRun.compareResultsPath,
      startedAt,
      finishedAt: state.environment.now(),
      reusedResults: true,
    };
    return { ...badRun, commitRun };
  }
  context.logDecision(
    'bad-ref-start',
    `Measuring bad ref ${shortSha(input.gitRange.badSha)} to discover regression targets`,
    {
      sha: input.gitRange.badSha,
      categories: input.selectedCategories,
    },
  );
  const result = await context.measureEndpoint({
    sha: input.gitRange.badSha,
    categories: input.selectedCategories,
    tests: [],
    targets: [],
  });
  return {
    testResults: result.testResults,
    compareResultsPath: result.commitRun.compareResultsPath,
    commitRun: result.commitRun,
  };
}

async function runPrimaryBisectWorkflow(
  context: BisectExecutionContext,
): Promise<void> {
  if (context.input.dryRun) {
    await planBisectDryRun(context);
    return;
  }
  if (context.state.session.primary.targets.length === 0) {
    await completeEmptyPrimary(context);
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
    const step = await deps.nativeGit.preview(group);
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
        : 'measuring native Git candidate'} ${shortSha(state.nextAction.sha)}`
      : 'Dry run found no regression targets and has no next action',
    state.nextAction ? { nextAction: state.nextAction } : { targetCount: 0 },
  );
  await context.save();
}

async function completeEmptyPrimary(context: BisectExecutionContext): Promise<void> {
  const { deps, state } = context;
  deps.decisions.progress('No regression targets were detected at the bad ref');
  const primary = state.session.primary;
  state.session = {
    ...state.session,
    primary: {
      ...primary,
      status: 'complete',
      targets: [],
      startedAt: primary.startedAt ?? state.environment.now(),
      finishedAt: state.environment.now(),
    },
  };
  await context.save();
}

async function runPrimaryBisectSearch(context: BisectExecutionContext): Promise<void> {
  await validateBisectGoodRef(context);
  const { input, deps, state } = context;
  const owner = phaseSessionOwner(context);
  state.requiresExperimentRestore = true;
  try {
    await new NativeBisectPhaseRunner(
      new PrimaryPhaseStore(owner),
      deps.nativeGit,
      state.candidateEvaluator,
      state.environment,
    ).run();
  } finally {
    state.session = owner.current();
  }
}

function phaseSessionOwner(context: BisectExecutionContext): CompareBisectSession {
  return context.state.owner;
}

function recordPhaseDecision(
  context: BisectExecutionContext,
  transition: PhaseTransition,
  session: BisectSession,
): void {
  const sha = typeof transition.details?.sha === 'string' ? transition.details.sha : undefined;
  const activeGroup = transition.phase.groups?.find((group) => (
    group.id === transition.phase.activeGroupId
  ));
  const event = transition.event === 'attempt-started'
    ? 'candidate-selected'
    : transition.event === 'candidate-classified' || transition.event === 'group-split'
      ? 'candidate-observed'
      : `phase-${transition.event}`;
  const message = transition.event === 'attempt-started' && sha
    ? `Selected Git candidate ${shortSha(sha)} for ${activeGroup?.targetIds.length ?? 0} active target(s)`
    : (transition.event === 'candidate-classified' || transition.event === 'group-split') && sha
      ? `Classified Git candidate ${shortSha(sha)} for phase ${transition.phase.id}`
      : `Bisect phase ${transition.phase.id}: ${transition.event}`;
  context.deps.decisions.progress(message);
  context.deps.decisions.record({
    timestamp: context.state.environment.now(),
    event,
    message,
    data: {
      ...transition.details,
      ...(transition.event === 'attempt-started'
        ? {
          targets: transition.phase.targets
            .filter((target) => Array.isArray(transition.details?.targetIds)
              && transition.details.targetIds.includes(target.id))
            .map((target) => ({
              ...targetLogData(target),
              group: transition.details?.group,
            })),
        }
        : {}),
      phaseId: transition.phase.id,
      activeGroupId: transition.phase.activeGroupId,
      sessionMode: session.mode,
    },
  });
}

async function validateBisectGoodRef(context: BisectExecutionContext): Promise<void> {
  const { input, state } = context;
  if (!input.validateGoodRef) {
    context.logDecision('good-ref-validation-skipped', 'Skipping experiment-side good-ref validation', {
      sha: input.gitRange.goodSha,
    });
    return;
  }
  const goodSha = input.gitRange.goodSha;
  const savedGoodRun = state.session.commitRuns[goodSha];
  const completedGoodRun = savedGoodRun?.compareCompleted === true
    && savedGoodRun.infrastructureError === undefined;
  const allTargetsRecorded = state.session.primary.targets.every((target) => (
    target.recordedTargetEvaluations[goodSha]?.commitSha === goodSha
  ));
  if (completedGoodRun && allTargetsRecorded) {
    context.logDecision(
      'good-ref-validation-reused',
      `Reusing completed good-ref validation at ${shortSha(goodSha)}`,
      { sha: goodSha, targetCount: state.session.primary.targets.length },
    );
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
  const goodRun = await context.measureEndpoint({
    sha: input.gitRange.goodSha,
    categories: categoriesForTargets(goodTargets),
    tests: testsForTargets(goodTargets),
    targets: goodTargets,
  });
  state.session = recordCommitRun(
    validateGoodEndpoint(state.session, goodRun.targetEvaluations),
    goodRun.commitRun,
  );
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
  await context.save();
  context.throwEndpointRestoreError();
}

async function runMergeBisectWorkflow(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  state.session = buildMergeQueue(state.session);
  await context.save();
  if (!input.investigateMerges || (state.session.mergeQueue?.length ?? 0) === 0) return;
  if (state.badRefTests) deps.artifacts.writeSummary(state.session);
  state.session = { ...state.session, mode: 'merge-investigation' };
  state.requiresExperimentRestore = true;
  state.session = await new MergeInvestigationRunner(
    state.owner,
    deps.mergeRangeSource,
    state.endpointValidator,
    deps.nativeGit,
    state.candidateEvaluator,
    state.environment,
  ).run();
}

async function finalizeBisectExecution(context: BisectExecutionContext): Promise<void> {
  await restoreExperimentAfterBisect(context);
  await releaseBisectLease(context);
  promoteBisectCancellation(context);
  disposeBisectSignalHandlers(context);
  setTerminalBisectSession(context);
  logTerminalBisectStatus(context);
  const terminalPersisted = await persistTerminalBisectState(context);
  if (terminalPersisted && context.state.cleanupErrors.length === 0) {
    await writeTerminalBisectSummary(context);
  }
}

async function restoreExperimentAfterBisect(context: BisectExecutionContext): Promise<void> {
  const { deps, state } = context;
  try {
    await deps.nativeGit.reset();
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `native Git bisect reset failed: ${errorMessage(error)}`,
      { cause: error },
    ));
  }
  if (!state.requiresExperimentRestore) return;
  try {
    await deps.restoration.restore();
  } catch (error) {
    state.cleanupErrors.push(asError(error));
  }
}

async function releaseBisectLease(context: BisectExecutionContext): Promise<void> {
  const { deps, state } = context;
  if (!state.leaseAcquired) return;
  try {
    await deps.server.end();
  } catch (error) {
    state.cleanupErrors.push(new Error(
      `lease release failed: ${errorMessage(error)}`,
      { cause: error },
    ));
  }
}

function promoteBisectCancellation(context: BisectExecutionContext): void {
  const { state } = context;
  const signal = state.environment.signal();
  if (!state.primaryError && signal) {
    state.primaryError = new BisectInterruptedError(signal);
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
    state.environment.now(),
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
      state.environment.now(),
    );
  }
}

async function persistTerminalBisectState(context: BisectExecutionContext): Promise<boolean> {
  const { deps, state } = context;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await context.save();
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
        state.environment.now(),
      );
    }
  }
  return false;
}

async function writeTerminalBisectSummary(context: BisectExecutionContext): Promise<void> {
  const { input, deps, state } = context;
  try {
    deps.artifacts.writeSummary(state.session, {
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
      state.environment.now(),
    );
    await persistTerminalBisectState(context);
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
      status: containsBisectInterruption(primaryError) ? 'interrupted' : 'failed',
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
      console.log(`Tests: ${nextAction.tests
        .map((test) => `${test.testFile} :: ${test.testName}`)
        .join(', ')}`);
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
  for (const target of found) {
    const investigation = target.firstBadSha
      ? session.mergeInvestigations?.[target.firstBadSha]
      : undefined;
    const mergeResult = investigation?.targetResults[target.id];
    const source = mergeResult && 'sourceSha' in mergeResult
      ? `; source ${shortSha(mergeResult.sourceSha)} (${mergeResult.kind})`
      : mergeResult ? `; ${mergeResult.kind}` : '';
    console.log(
      `  ${target.category} ${target.testName} ${target.viewport} ${target.subject}: ` +
      `${shortSha(target.firstBadSha!)}${source}`,
    );
  }
  const hasUninvestigatedMerge = Object.values(session.mergeInvestigations ?? {})
    .some((investigation) => investigation.status === 'merge-uninvestigated');
  if (hasUninvestigatedMerge) {
    console.log(
      `shaka-perf compare bisect --categories ` +
      `${session.compatibility.effective.categories.join(',')} --resume --investigate-merges`,
    );
  }
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
