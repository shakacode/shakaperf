/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import { type AbTestDefinition } from 'shaka-shared';
import type { ReactNode } from 'react';
import type { Viewport } from '../config';
import type { ChipDescriptor, ReportMeta, SortDescriptor, TestResult } from './report';
import type { Outcome } from './outcome';
import type { StageArtifactTestMeta } from './stage-report-components';
import type { Stage, StageCategory, StageName, StageRenderEntry } from '../stage/stage';

type StageMeasurement<S> = S extends Stage<infer M> ? M : never;

export interface PipelineWorkerPool {
  readonly id: string;
  readonly parallelism: number;
}

export interface PipelineRunStageStep {
  readonly kind: 'run-stage';
  readonly pool: PipelineWorkerPool;
  readonly stage: Stage;
}

export interface PipelineDisposeWorkerPoolStep {
  readonly kind: 'dispose-worker-pool';
  readonly pool: PipelineWorkerPool;
}

export type ChipStageOutcome<M> = Outcome & {
  readonly kind: 'ok';
  readonly measurement: M;
};

export interface ChipStageResult<M> {
  readonly stage: StageName;
  readonly viewport: Viewport;
  readonly measurement: M;
  readonly outcome: ChipStageOutcome<M>;
}

export type ChipStageResults<M> = readonly ChipStageResult<M>[];

export type ChipResultMap<Measurements extends Record<string, unknown>> = {
  readonly [Name in keyof Measurements & string]: ChipStageResults<Measurements[Name]>;
};

export interface ChipTestEntry<Measurements extends Record<string, unknown>> {
  readonly test: AbTestDefinition;
  readonly results: ChipResultMap<Measurements>;
}

export interface PipelineChipContext {
  readJsonArtifact<T>(artifactPath: string): T | undefined;
}

export interface PipelineChipBuilder<Measurements extends Record<string, unknown>> {
  // Bulk chip computation for the whole run. Receives every test's
  // stage results in a single call; lets the builder construct any
  // cross-test indexes locally (rank-by-metric, worst-of, etc.) without
  // the framework having to inject them per test. Return undefined for
  // a test to fall back to no chips.
  chipsForAllTests(
    perTest: readonly ChipTestEntry<Measurements>[],
    context?: PipelineChipContext,
  ): ReadonlyMap<AbTestDefinition, readonly ChipDescriptor[]>;
}

export interface PipelineSortBuilder<Measurements extends Record<string, unknown>> {
  // Bulk sort-dimension computation for the whole run, registered the same way
  // as chips (`buildSorts`). Receives every test's stage results and returns,
  // per test, the values it exposes for sorting (one `SortDescriptor` per
  // dimension). Return an empty array — or omit a test — for nothing sortable.
  sortsForAllTests(
    perTest: readonly ChipTestEntry<Measurements>[],
  ): ReadonlyMap<AbTestDefinition, readonly SortDescriptor[]>;
}

export type PipelineStep =
  | PipelineRunStageStep
  | PipelineDisposeWorkerPoolStep;

export interface PipelineReport {
  readonly reportLabel: string;
  renderHeaderUrls(meta: ReportMeta): ReactNode;
  renderTestCardUrls(test: TestResult): ReactNode;
  renderDialogMetaUrls(test: StageArtifactTestMeta): ReactNode;
}

export interface PipelineMachineReportMeta {
  readonly throttleProfile?: string;
  readonly viewport?: { width: number; height: number };
}

export interface PipelineMachineReportRow {
  readonly viewport: Viewport;
  readonly outcomes: readonly Outcome[];
}

export interface PipelineMachineReportMetaContext {
  readonly rows: readonly PipelineMachineReportRow[];
  readonly reportOnly: boolean;
}

interface PipelineOptions {
  readonly name: string;
  readonly description: string;
  readonly artifactRoot?: string;
  readonly pipelineConfig?: unknown;
  readonly report: PipelineReport;
  /**
   * Run-level derived dirs (relative to the results root) that this
   * pipeline's stages accumulate into across units — e.g. the audit stage
   * mirrors per-unit coverage into `.nyc_output/`. The runner's wipe
   * authority clears them before a fresh measuring run (never on
   * `--report-only`, `--skip-report` shards, `--keep-old-results`, or
   * restart), so entries from renamed/deleted tests can't leak into later
   * runs. Stages must not wipe these themselves.
   */
  readonly derivedResultsDirs?: readonly string[];
  readonly machineReportMeta?: (ctx: PipelineMachineReportMetaContext) => PipelineMachineReportMeta;
}

interface PipelineBuilder {
  registerWorkerPool(parallelism: number): PipelineWorkerPool;
  runStage(pool: PipelineWorkerPool, stage: Stage): void;
  waitForAllTasksFinishAndDispose(pool: PipelineWorkerPool): void;
  buildChips<Measurements extends Record<string, unknown>>(chips: PipelineChipBuilder<Measurements>): void;
  buildSorts<Measurements extends Record<string, unknown>>(sorts: PipelineSortBuilder<Measurements>): void;
}

export interface Pipeline extends PipelineOptions {
  chipsForAllTests(
    perTest: readonly ChipTestEntry<Record<string, unknown>>[],
    context?: PipelineChipContext,
  ): ReadonlyMap<AbTestDefinition, readonly ChipDescriptor[]>;
  sortsForAllTests(
    perTest: readonly ChipTestEntry<Record<string, unknown>>[],
  ): ReadonlyMap<AbTestDefinition, readonly SortDescriptor[]>;
  readonly workerPools: readonly PipelineWorkerPool[];
  readonly steps: readonly PipelineStep[];
  readonly stages: readonly Stage[];
}

export function createPipeline(
  options: PipelineOptions,
  define: (pipeline: PipelineBuilder) => void,
): Pipeline {
  const workerPools: PipelineWorkerPool[] = [];
  const steps: PipelineStep[] = [];
  const registeredPools = new Set<PipelineWorkerPool>();
  const chipStep: { current?: PipelineChipBuilder<Record<string, unknown>> } = {};
  const sortStep: { current?: PipelineSortBuilder<Record<string, unknown>> } = {};
  const builder: PipelineBuilder = {
    registerWorkerPool(parallelism) {
      const pool: PipelineWorkerPool = {
        id: `worker-pool-${workerPools.length + 1}`,
        parallelism,
      };
      workerPools.push(pool);
      registeredPools.add(pool);
      return pool;
    },
    runStage(pool, stage) {
      assertRegisteredPool(registeredPools, pool);
      steps.push({ kind: 'run-stage', pool, stage });
    },
    waitForAllTasksFinishAndDispose(pool) {
      assertRegisteredPool(registeredPools, pool);
      steps.push({ kind: 'dispose-worker-pool', pool });
    },
    buildChips(chips) {
      if (chipStep.current) {
        throw new Error('Pipeline can only register one chip builder.');
      }
      chipStep.current = chips as PipelineChipBuilder<Record<string, unknown>>;
    },
    buildSorts(sorts) {
      if (sortStep.current) {
        throw new Error('Pipeline can only register one sort builder.');
      }
      sortStep.current = sorts as PipelineSortBuilder<Record<string, unknown>>;
    },
  };
  define(builder);
  const chips = chipStep.current;
  if (!chips) {
    throw new Error(`Pipeline "${options.name}" did not register a chip builder.`);
  }
  const sorts = sortStep.current;
  if (!sorts) {
    throw new Error(`Pipeline "${options.name}" did not register a sort builder.`);
  }
  return {
    ...options,
    chipsForAllTests: chips.chipsForAllTests,
    sortsForAllTests: sorts.sortsForAllTests,
    workerPools,
    steps,
    stages: steps.flatMap((step) => step.kind === 'run-stage' ? [step.stage] : []),
  };
}

function assertRegisteredPool(
  registeredPools: ReadonlySet<PipelineWorkerPool>,
  pool: PipelineWorkerPool,
): void {
  if (!registeredPools.has(pool)) {
    throw new Error(`Worker pool ${pool.id} was not registered on this pipeline.`);
  }
}

function renderStageArtifact<S extends Stage>(
  stage: S,
  measurements: readonly StageRenderEntry<StageMeasurement<S>>[],
): ReactNode {
  return stage.renderArtifacts(measurements);
}

export function renderPipelineStageArtifacts(
  pipeline: Pipeline,
  name: StageName,
  measurements: readonly StageRenderEntry[],
): ReactNode {
  const stage = pipeline.stages.find((candidate) => candidate.name === name);
  if (!stage) {
    throw new Error(`Unknown stage "${name}". Valid: ${stageNames(pipeline).join(', ')}`);
  }
  return renderStageArtifact(stage, measurements);
}

export function stageNames(pipeline: Pipeline): StageName[] {
  return pipeline.stages.map((stage) => stage.name);
}

export function stageCategories(pipeline: Pipeline): StageCategory[] {
  return [...new Set(pipeline.stages.map((stage) => stage.category))];
}


export interface StageSelection {
  stages: Stage[];
  steps: PipelineStep[];
  stageNames: StageName[];
  skippedStages: Array<{ stage: Stage; reason: string; persistOutcome: boolean }>;
  restartFromStage: StageName | null;
}

function splitList(value: string | string[] | undefined, fallback: string[]): string[] {
  if (value == null) return fallback;
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => entry.split(',').map((part) => part.trim()).filter(Boolean));
}

export function resolveStageSelection(
  pipeline: Pipeline,
  opts: {
    categories?: string | string[];
    skipStages?: string | string[];
    restartFromStage?: string | undefined;
  },
): StageSelection {
  const validCategories = stageCategories(pipeline);
  const validStages = stageNames(pipeline);
  const categories = splitList(opts.categories, validCategories);
  const requestedSkipStages = splitList(opts.skipStages, []);
  const restartFromStage = opts.restartFromStage?.trim() || undefined;

  for (const category of categories) {
    if (!validCategories.includes(category as StageCategory)) {
      throw new Error(`Unknown category "${category}". Valid: ${validCategories.join(', ')}`);
    }
  }
  // --skip-stages is forgiving: an unknown stage is a warning, not a crash, so a
  // skip list shared across pipelines (where a stage may not exist) still runs.
  const skipStages = requestedSkipStages.filter((stage) => {
    if (validStages.includes(stage as StageName)) return true;
    console.warn(chalk.yellow(
      `shaka-perf: ignoring unknown stage "${stage}" in --skip-stages. Valid: ${validStages.join(', ')}`,
    ));
    return false;
  });
  if (restartFromStage && !validStages.includes(restartFromStage as StageName)) {
    throw new Error(`Unknown stage "${restartFromStage}". Valid: ${validStages.join(', ')}`);
  }

  const categoryFilter = new Set(categories as StageCategory[]);
  const skippedStages = new Set(skipStages);
  const restartIndex = restartFromStage
    ? pipeline.stages.findIndex((stage) => stage.name === restartFromStage)
    : -1;
  const selectedStages = pipeline.stages.filter((stage) => {
    if (restartIndex >= 0 && pipeline.stages.indexOf(stage) < restartIndex) return false;
    if (!categoryFilter.has(stage.category)) return false;
    if (skippedStages.has(stage.name)) return false;
    return true;
  });
  const selectedStageSet = new Set(selectedStages);
  const selectedSteps = pipeline.steps.filter((step) => (
    step.kind === 'dispose-worker-pool' ||
    selectedStageSet.has(step.stage)
  ));
  const skippedStageEntries = pipeline.stages
    .filter((stage) => !selectedStages.includes(stage))
    .map((stage) => ({
      stage,
      ...(restartIndex >= 0 && pipeline.stages.indexOf(stage) < restartIndex
        ? {
          reason: `retained from previous run by --restart-from-stage ${restartFromStage}`,
          persistOutcome: false,
        }
        : skippedStages.has(stage.name)
          ? {
            reason: `skipped by --skip-stages ${stage.name}`,
            persistOutcome: true,
          }
          : {
            reason: `skipped by --categories ${categories.join(',')}`,
            persistOutcome: true,
          }),
    }));
  if (selectedStages.length === 0) {
    throw new Error('No pipeline stages selected.');
  }
  return {
    stages: selectedStages,
    steps: selectedSteps,
    stageNames: selectedStages.map((stage) => stage.name),
    skippedStages: skippedStageEntries,
    restartFromStage: restartFromStage ? restartFromStage as StageName : null,
  };
}

export type { Stage, StageCategory, StageName };
