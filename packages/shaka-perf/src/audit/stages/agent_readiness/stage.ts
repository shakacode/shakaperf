/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { Viewport } from '../../../config';
import {
  type JsonValue,
  type Stage,
  type StageName,
  type StageRenderContext,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { type AgentReadinessStageConfig } from './config';
import { AgentReadinessArtifactView } from './report';
import type { AgentReadinessResult } from './types';

// Reads how legible each page is to AI agents / answer engines (see ./types).
// Runs under the `audit` category, but OFF by default: a test opts in via
// `config.agentReadiness.enabled` (or the file enables it for all). When it
// runs, the client report turns its data into the "Agent Ready" tab; with no
// test enabled, the tab is simply absent.
export class AgentReadinessStage implements Stage<AgentReadinessResult> {
  readonly category = 'audit';
  readonly name: StageName = 'agent-readiness';
  readonly label = 'Agent Readiness';
  readonly description = 'Measure how readable the page is to AI agents and answer engines (raw HTML vs rendered DOM, structured data, semantic HTML).';
  readonly selfContainedReportStrip = {};
  private readonly config: AgentReadinessStageConfig;

  constructor(config: AgentReadinessStageConfig) {
    this.config = config;
  }

  applies(test: AbTestDefinition, _viewport: Viewport): boolean {
    // Per-test `config.agentReadiness.enabled` wins over the file-level default;
    // when neither turns it on the runner records a skip outcome for the unit.
    return test.config?.agentReadiness?.enabled ?? this.config.enabled;
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<AgentReadinessResult> {
    const runImpl = './engine';
    const { runAgentReadinessStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runAgentReadinessStage(ctx, pool, this.config);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AgentReadinessResult>[]) {
    return createElement(AgentReadinessArtifactView, { measurements });
  }

  machineReadableSummary(measurement: AgentReadinessResult, _ctx: StageRenderContext): JsonValue {
    const raw = measurement.raw.signals;
    const r = measurement.rendered;
    return {
      url: measurement.url,
      rawOk: measurement.raw.ok,
      rawLikelyBlocked: measurement.raw.likelyBlocked,
      rawTextWords: raw?.textWords ?? 0,
      renderedTextWords: r.textWords,
      structuredDataTypes: r.structuredData.types,
      titlePresent: r.titlePresent,
      metaDescriptionPresent: r.metaDescriptionPresent,
      h1Count: r.headings.h1Count,
    };
  }
}
