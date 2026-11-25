/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { stageIds } from '../../../stage/stage-ids';
import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { Viewport } from '../../../config';
import type { OutcomeKind } from '../../../pipeline/outcome';
import {
  type JsonValue,
  type Stage,
  type StageRunResult,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { AiSummaryArtifactView, summaryHeadingBadge } from './report';

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
  readonly measuresApplication = false;
  readonly category = 'audit';
  readonly name: StageName = stageIds.aiSummary;
  readonly label = 'Summary';
  readonly description = 'Summarise the audit results in plain language via an AI model.';
  readonly selfContainedReportStrip = {};
  // Runs last, renders first.
  readonly renderingPriority = 100;

  applies(_test: AbTestDefinition, _viewport: Viewport, priorOutcomeKinds: ReadonlyMap<StageName, OutcomeKind>): boolean {
    // Nothing to summarise unless the audit produced metrics.
    return priorOutcomeKinds.get(stageIds.audit) === 'ok';
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<StageRunResult<AiSummaryResult>> {
    // Lazy-import keeps the node-only engine (child_process) out of the
    // report-shell bundle, mirroring the other audit stages.
    const runImpl = './engine';
    const { runAiSummaryStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    const measurement = await runAiSummaryStage(ctx, pool);
    return { measurement, metadata: {} };
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AiSummaryResult>[]) {
    return createElement(AiSummaryArtifactView, { measurements });
  }

  renderHeadingBadge(measurements: readonly StageRenderEntry<AiSummaryResult>[]) {
    return summaryHeadingBadge(measurements);
  }

  machineReadableSummary(measurement: AiSummaryResult): JsonValue {
    return { summary: measurement.summary };
  }
}
