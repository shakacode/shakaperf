/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { PerfLighthouseConfig } from '../../../bench/core/lighthouse-config';
import type { Viewport } from '../../../config';
import {
  emptyMachineReadableSummary,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { AuditArtifactView } from './report';

export interface AuditStageConfig {
  readonly lighthouseConfig?: PerfLighthouseConfig | undefined;
}

export type AuditMetricGroup = 'vitals' | 'diagnostics';
export type AuditMetricLevel = 'good' | 'average' | 'bad';

export interface AuditMetric {
  label: string;
  value: number;
  unit: string;
  display: string;
  group: AuditMetricGroup;
  level?: AuditMetricLevel;
}

export interface AuditResult {
  metrics: AuditMetric[];
  lighthouseHref?: string;
  lighthouseThumbHref?: string;
  /** Report-relative path to the executed statement-id JSON artifact. */
  coverageStatementIdsHref?: string;
}

export class AuditStage implements Stage<AuditResult> {
  readonly category = 'audit';
  readonly name: StageName = 'audit';
  readonly label = 'Audit';
  readonly description = 'Capture one absolute Lighthouse measurement on the target URL.';
  readonly selfContainedReportStrip = {
    lighthouseHref: true,
    lighthouseThumbHref: true,
    coverageStatementIdsHref: true,
  };

  constructor(private readonly config: AuditStageConfig) {}

  applies(_test: AbTestDefinition): boolean {
    return true;
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<AuditResult> {
    const runImpl = './engine';
    const { runAuditStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runAuditStage(ctx, pool, this.config);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AuditResult>[]) {
    return createElement(AuditArtifactView, { measurements });
  }

  machineReadableSummary = emptyMachineReadableSummary;
}
