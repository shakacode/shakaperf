/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AbTestDefinition } from 'shaka-shared';
import type { AbTestsConfig } from '../../config';
import { viewportsByStageCategory } from '../../config';
import { runPipeline } from '../../pipeline/runner';
import type { TestResult } from '../../pipeline/report';
import {
  comparePipelineConfigFromAbTests,
  createComparePipeline,
} from '../compare-pipeline';
import { requireBisectProxy } from '../../twin-servers/ipc/client';
import { PROTOCOL_VERSION, type ProxyRequestPayload } from '../../twin-servers/ipc/protocol';
import type { BisectExperimentReloadResult } from '../../twin-servers/commands/bisect-session';
import type { ResolvedConfig } from '../../twin-servers/types';
import { ExactCheckout, NativeGitBisectDriver, restoreCheckout, type PreparedGitRange } from './git';
import { GitMergeRangeSource, type MergeRangeSource } from './merge-investigation';
import { writeSessionAtomic, writeSummary, type BisectSummaryMetadata } from './persistence';
import { clearPriorBisectReportOutput, writeBisectReport } from './report';
import { buildBisectReportModel } from './report-model';
import { loadReusableCompareResults } from './reuse-results';
import {
  type BisectCandidateServer,
  type CandidateComparison,
  type CompareRunRequest,
  type CompareRunResult,
  type ExperimentReloadMode,
  type ExperimentReloadRequest,
  type ExperimentReloadResult,
} from './run-candidate';
import { filterFrozenTests } from './test-selection';
import { writeBadRefTestsAtomic } from './state';
import type { BisectCategory, BisectSession } from './types';

export interface ReuseCurrentResultsRequest {
  sha: string;
  categories: readonly BisectCategory[];
}

export interface BisectDecisionLogEntry {
  timestamp: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface BisectClock {
  now(): string;
}

export interface BisectSignalHandlers {
  install(handler: (signal: NodeJS.Signals) => void): () => void;
}

export interface BisectServerSession extends BisectCandidateServer {
  begin(): Promise<void>;
  end(): Promise<void>;
}

export interface BisectArtifactStore {
  clearPrevious(): void;
  writeSession(session: BisectSession): void;
  writeReport(session: BisectSession, badRefTests: readonly TestResult[]): void;
  writeSummary(session: BisectSession, metadata?: BisectSummaryMetadata): void;
  writeBadRefTests(tests: readonly TestResult[]): string;
}

export interface ExperimentRestoration {
  restore(): Promise<void>;
}

export interface BisectDecisionLogger {
  progress(message: string): void;
  record(entry: BisectDecisionLogEntry): void;
}

export interface ReusableCompareResults {
  load(request: ReuseCurrentResultsRequest): Promise<CompareRunResult>;
}

export interface ExecuteBisectDependencies {
  clock: BisectClock;
  signals: BisectSignalHandlers;
  server: BisectServerSession;
  artifacts: BisectArtifactStore;
  restoration: ExperimentRestoration;
  decisions: BisectDecisionLogger;
  reusableResults: ReusableCompareResults;
  comparison: CandidateComparison;
  mergeRangeSource: MergeRangeSource;
  nativeGit: NativeGitBisectDriver;
  exactCheckout: ExactCheckout;
}

export interface DefaultBisectDependenciesOptions {
  cwd: string;
  config: AbTestsConfig;
  twinServers: ResolvedConfig;
  frozenTests: readonly AbTestDefinition[];
  resultsDirectory: string;
  gitRange: PreparedGitRange;
  headed: boolean;
  controlURL: string;
  experimentURL: string;
}

class ProcessBisectSignals implements BisectSignalHandlers {
  install(handler: (signal: NodeJS.Signals) => void): () => void {
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    return () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    };
  }
}

/** Owns the twin-server lease and refresh lifecycle for one bisect session. */
class TwinServerBisectSession implements BisectServerSession {
  constructor(
    private readonly twinServers: ResolvedConfig,
    private readonly config: AbTestsConfig,
    private readonly sessionId: string,
  ) {}

  begin(): Promise<void> {
    return proxyBisect<void>(this.twinServers, {
      cmd: 'bisect-begin', sessionId: this.sessionId, ownerPid: process.pid,
    });
  }

  end(): Promise<void> {
    return proxyBisect<void>(this.twinServers, { cmd: 'bisect-end', sessionId: this.sessionId });
  }

  refreshExperiment(request: ExperimentReloadRequest): Promise<ExperimentReloadResult> {
    return proxyBisect<BisectExperimentReloadResult>(this.twinServers, {
      cmd: 'bisect-refresh',
      sessionId: this.sessionId,
      mode: request.preferredExperimentReloadMode,
      rebuildCommands: configuredRebuildCommands(this.config).map((command) => command.command),
      noCache: false,
    });
  }
}

/** Restores both the experiment checkout and the server built from it. */
class OriginalExperimentRestoration implements ExperimentRestoration {
  constructor(
    private readonly experimentDir: string,
    private readonly original: PreparedGitRange['originalExperiment'],
    private readonly allowedPaths: readonly string[],
    private readonly server: BisectServerSession,
    private readonly reloadMode: ExperimentReloadMode,
  ) {}

  async restore(): Promise<void> {
    const errors: Error[] = [];
    try {
      await restoreCheckout(this.experimentDir, this.original, {
        allowedPaths: this.allowedPaths,
      });
    } catch (error) {
      errors.push(asError(error));
    }
    try {
      await this.server.refreshExperiment({
        sha: this.original.sha,
        preferredExperimentReloadMode: this.reloadMode,
      });
    } catch (error) {
      errors.push(asError(error));
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to restore experiment state');
    }
  }
}

interface ArtifactStoreOptions {
  cwd: string;
  config: AbTestsConfig;
  resultsDirectory: string;
  controlURL: string;
  experimentURL: string;
}

/** Owns all bisect files and report rendering under one result root. */
class FileBisectArtifactStore implements BisectArtifactStore {
  private readonly reportPipeline;

  constructor(private readonly options: ArtifactStoreOptions) {
    this.reportPipeline = createComparePipeline(comparePipelineConfigFromAbTests(options.config));
  }

  clearPrevious(): void {
    fs.rmSync(path.join(this.options.resultsDirectory, 'summary.json'), { force: true });
    fs.rmSync(path.join(this.options.resultsDirectory, 'decision-log.jsonl'), { force: true });
    fs.rmSync(path.join(this.options.resultsDirectory, 'decision-log.md'), { force: true });
    clearPriorBisectReportOutput(this.options.resultsDirectory);
  }

  writeSession(session: BisectSession): void {
    writeSessionAtomic(path.join(this.options.resultsDirectory, 'session.json'), session);
  }

  writeReport(session: BisectSession, badRefTests: readonly TestResult[]): void {
    const generatedAt = new Date().toISOString();
    writeBisectReport({
      resultsDirectory: this.options.resultsDirectory,
      data: {
        meta: {
          title: `${path.basename(this.options.cwd)} · bisect`,
          pipelineName: this.reportPipeline.name,
          generatedAt,
          controlUrl: this.options.controlURL,
          experimentUrl: this.options.experimentURL,
          durationMs: 0,
          cwd: this.options.cwd,
          errors: [],
          reportOnly: false,
          pipelineConfig: this.reportPipeline.pipelineConfig,
          reportMode: 'full',
        },
        tests: [...badRefTests],
        bisect: buildBisectReportModel(session, badRefTests, generatedAt),
      },
      stages: this.reportPipeline.stages,
    });
  }

  writeSummary(session: BisectSession, metadata?: BisectSummaryMetadata): void {
    writeSummary(path.join(this.options.resultsDirectory, 'summary.json'), session, metadata);
  }

  writeBadRefTests(tests: readonly TestResult[]): string {
    return writeBadRefTestsAtomic(
      path.join(this.options.resultsDirectory, 'bad-ref-tests.json'), tests,
    );
  }
}

interface CandidateCompareOptions {
  cwd: string;
  config: AbTestsConfig;
  frozenTests: readonly AbTestDefinition[];
  resultsDirectory: string;
  headed: boolean;
  controlURL: string;
  experimentURL: string;
}

/** Owns candidate-specific compare pipeline construction and frozen test selection. */
class CandidateCompareRunner implements CandidateComparison {
  constructor(private readonly options: CandidateCompareOptions) {}

  async run(request: CompareRunRequest): Promise<CompareRunResult> {
    const pipeline = createComparePipeline(comparePipelineConfigFromAbTests(this.options.config, {
      artifactRoot: path.join(this.options.resultsDirectory, 'commits', request.sha),
      testPathPattern: this.options.config.shared.testPathPattern,
    }));
    const result = await runPipeline(pipeline, {
      cwd: this.options.cwd,
      config: this.options.config,
      tests: filterFrozenTests(this.options.frozenTests, this.options.cwd, request.tests),
      controlURL: this.options.controlURL,
      experimentURL: this.options.experimentURL,
      categories: [...request.categories],
      skipReport: true,
      headed: this.options.headed,
    });
    return { testResults: result.testResults, compareResultsPath: result.resultsRoot };
  }
}

function createReusableCompareResults(options: {
  cwd: string;
  config: AbTestsConfig;
  frozenTests: readonly AbTestDefinition[];
  controlURL: string;
  experimentURL: string;
}): ReusableCompareResults {
  return {
    async load(request) {
      return loadReusableCompareResults({
        cwd: options.cwd,
        tests: options.frozenTests,
        categories: request.categories,
        controlURL: options.controlURL,
        experimentURL: options.experimentURL,
        viewports: viewportsByStageCategory(options.config),
      });
    },
  };
}

export function createFileBisectDecisionLogger(resultsDirectory: string): BisectDecisionLogger {
  return {
    progress(message) {
      console.log(`[bisect] ${message}`);
    },
    record(entry) {
      const jsonlPath = path.join(resultsDirectory, 'decision-log.jsonl');
      const markdownPath = path.join(resultsDirectory, 'decision-log.md');
      fs.mkdirSync(resultsDirectory, { recursive: true });
      if (!fs.existsSync(markdownPath)) {
        fs.writeFileSync(markdownPath, '# Compare Bisect Decision Log\n\n', 'utf8');
      }
      if (!fs.existsSync(jsonlPath)) {
        fs.writeFileSync(jsonlPath, '', 'utf8');
      }
      fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`, 'utf8');
      fs.appendFileSync(markdownPath, formatDecisionMarkdown(entry), 'utf8');
    },
  };
}

export function createDefaultBisectDependencies(
  options: DefaultBisectDependenciesOptions,
): ExecuteBisectDependencies {
  const server = new TwinServerBisectSession(options.twinServers, options.config, randomUUID());
  const nativeGit = new NativeGitBisectDriver({
    repoDir: options.twinServers.experimentDir,
    allowedPaths: [options.resultsDirectory],
  });
  return {
    clock: { now: () => new Date().toISOString() },
    signals: new ProcessBisectSignals(),
    server,
    artifacts: new FileBisectArtifactStore(options),
    restoration: new OriginalExperimentRestoration(
      options.twinServers.experimentDir,
      options.gitRange.originalExperiment,
      [options.resultsDirectory],
      server,
      preferredExperimentReloadMode(options.config),
    ),
    decisions: createFileBisectDecisionLogger(options.resultsDirectory),
    reusableResults: createReusableCompareResults({
      cwd: options.cwd,
      config: options.config,
      frozenTests: options.frozenTests,
      controlURL: options.controlURL,
      experimentURL: options.experimentURL,
    }),
    comparison: new CandidateCompareRunner(options),
    nativeGit,
    exactCheckout: new ExactCheckout({
      repoDir: options.twinServers.experimentDir,
      allowedPaths: [options.resultsDirectory],
    }),
    mergeRangeSource: new GitMergeRangeSource(options.twinServers.experimentDir),
  };
}

export function preferredExperimentReloadMode(config: AbTestsConfig): ExperimentReloadMode {
  return config.bisect.rebuildContainer || configuredRebuildCommands(config).length === 0
    ? 'container'
    : 'commands';
}

export function configuredRebuildCommands(config: AbTestsConfig) {
  return config.twinServers?.rebuildCommands ?? [];
}

async function proxyBisect<T>(twinServers: ResolvedConfig, payload: ProxyRequestPayload): Promise<T> {
  return requireBisectProxy<T>({
    slug: twinServers.projectSlug,
    request: { v: PROTOCOL_VERSION, ...payload },
    verbose: false,
  });
}

function formatDecisionMarkdown(entry: BisectDecisionLogEntry): string {
  const lines = [`- \`${entry.timestamp}\` **${entry.event}** — ${entry.message}`];
  if (entry.data && Object.keys(entry.data).length > 0) {
    lines.push('', '  ```json');
    lines.push(JSON.stringify(entry.data, null, 2).split('\n').map((line) => `  ${line}`).join('\n'));
    lines.push('  ```');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
