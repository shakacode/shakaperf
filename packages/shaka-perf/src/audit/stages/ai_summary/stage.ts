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
import type { Viewport } from '../../../config';
import type { Outcome } from '../../../pipeline/outcome';
import {
  type JsonValue,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { AiSummaryArtifactView } from './report';

export interface AiSummaryResult {
  /** ≤280-char plain-language summary (performance-led, plus a11y/agent when present), or ''. */
  summary: string;
}

/**
 * Reviews the prior audit stages' results and produces a short, jargon-free
 * summary for non-technical readers, via `claude -p` (haiku). Registered LAST
 * in the audit pipeline so it runs after every other stage (and can read their
 * results through `ctx.readPriorResult`), but `renderingPriority` floats it to
 * the TOP of each card.
 */
export class AiSummaryStage implements Stage<AiSummaryResult> {
  readonly category = 'audit';
  readonly name: StageName = 'ai_summary';
  readonly label = 'Summary';
  readonly description = 'Summarise the audit results in plain language via an AI model.';
  readonly selfContainedReportStrip = {};
  // Runs last, renders first.
  readonly renderingPriority = 100;

  applies(_test: AbTestDefinition, _viewport: Viewport, priorOutcomes: ReadonlyMap<StageName, Outcome>): boolean {
    // Nothing to summarise unless the audit produced metrics.
    return priorOutcomes.get('audit')?.kind === 'ok';
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<AiSummaryResult> {
    // Lazy-import keeps the node-only engine (child_process) out of the
    // report-shell bundle, mirroring the other audit stages.
    const runImpl = './engine';
    const { runAiSummaryStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runAiSummaryStage(ctx, pool);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AiSummaryResult>[]) {
    return createElement(AiSummaryArtifactView, { measurements });
  }

  machineReadableSummary(measurement: AiSummaryResult): JsonValue {
    return { summary: measurement.summary };
  }
}
