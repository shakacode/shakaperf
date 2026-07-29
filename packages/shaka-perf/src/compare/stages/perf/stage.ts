/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { PerfConfig, Viewport } from '../../../config';
import type { Outcome } from '../../../pipeline/outcome';
import type {
  JsonValue,
  Stage,
  StageName,
  StageRenderEntry,
  StageRenderContext,
  TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import type { PerfArtifact } from '../perf';
import { PerfArtifactView } from '../shared/perf-report';

export interface PerfStageConfig extends Omit<PerfConfig, 'viewports'> {
  readonly saveArtifacts: boolean;
  readonly statisticalAnalysis: boolean;
}

export interface PerfEngineStageOptions<M> {
  name: StageName;
  description: string;
  /** Short display name for the report's section-filter chips. */
  label: string;
  /** Human-readable heading shown above this stage's artifacts in the report. */
  artifactTitle: string;
  config: PerfStageConfig;
  applies?(
    test: AbTestDefinition,
    viewport: Viewport,
    priorOutcomes: ReadonlyMap<StageName, Outcome>,
  ): boolean;
  machineReadableSummary(measurement: M, ctx: StageRenderContext): JsonValue;
}

export class PerfEngineStage<M> implements Stage<M> {
  readonly category = 'perf';
  readonly name: StageName;
  readonly label: string;
  readonly description: string;
  readonly selfContainedReportStrip = {
    controlLighthouseHref: true,
    experimentLighthouseHref: true,
    timelineHref: true,
    benchReportHref: true,
    diffHrefs: true,
  };

  constructor(private readonly options: PerfEngineStageOptions<M>) {
    this.name = options.name;
    this.label = options.label;
    this.description = options.description;
  }

  applies(
    test: AbTestDefinition,
    viewport: Viewport,
    priorOutcomes: ReadonlyMap<StageName, Outcome>,
  ): boolean {
    return this.options.applies?.(test, viewport, priorOutcomes) ?? true;
  }

  async run(
    ctx: TestContext,
    pool: WorkerPool,
  ): Promise<M> {
    const runImpl = './engine';
    const { runPerfEngineStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runPerfEngineStage(ctx, pool, this.options.config) as Promise<M>;
  }

  renderArtifacts(measurements: readonly StageRenderEntry<M>[]) {
    return createElement(PerfArtifactView, {
      measurements: measurements as readonly StageRenderEntry<PerfArtifact>[],
      title: this.options.artifactTitle,
    });
  }

  machineReadableSummary(measurement: M, ctx: StageRenderContext): JsonValue {
    return this.options.machineReadableSummary(measurement, ctx);
  }
}
