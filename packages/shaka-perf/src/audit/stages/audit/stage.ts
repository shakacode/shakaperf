/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
  /**
   * Sorted `${absFile}:${statementId}` keys for every istanbul statement
   * executed during this test, drained off `window.__coverage__`. Populated
   * only when the served bundle is instrumented (otherwise absent — a missing
   * field is treated as "no signal", not "no coverage"). Used by the audit
   * chip pass to flag tests whose JS coverage is a subset of another's. Never
   * rendered; stripped from both report modes.
   */
  coverageStatementIds?: readonly string[];
}

export class AuditStage implements Stage<AuditResult> {
  readonly category = 'audit';
  readonly name: StageName = 'audit';
  readonly label = 'Audit';
  readonly description = 'Capture one absolute Lighthouse measurement on the target URL.';

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

  stripMeasurementForReport(measurement: AuditResult): AuditResult {
    // `coverageStatementIds` is a chip-pass-only signal — the renderer never
    // reads it. A typical instrumented SPA produces ~50–100k strings per test,
    // so leaving it in either report bloats the embedded JSON payload.
    const { coverageStatementIds: _cov, ...rest } = measurement;
    return rest;
  }
}
