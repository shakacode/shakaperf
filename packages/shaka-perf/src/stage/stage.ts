/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import type { RaceCancellation } from 'race-cancellation';
import type { AbTestDefinition, TestType } from 'shaka-shared';
import type { Viewport } from '../config';
import type { ArtifactScope } from '../pipeline/artifact-store';
import type { Outcome } from '../pipeline/outcome';
import type { WorkerPool } from '../pipeline/worker-pool';

export type StageCategory = TestType;
export type StageName = string;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface StageRuntime {
  readonly resultsRoot: string;
  /**
   * Diagnostics flag (audit `--debug-show-all-frames`): when set, stages that
   * dedupe artifacts also emit the full, non-deduped form. Only
   * `build_annotated_timeline` reads it today.
   */
  readonly debugShowAllFrames?: boolean;
  /**
   * Launch the measurement browser headed (visible) instead of headless. Set
   * from the `--headed` CLI flag; consumed by stages that launch measurement
   * browsers.
   */
  readonly headed?: boolean;
}

export interface StageLogger {
  log(message: string, context?: Record<string, unknown>): void;
  flush(): string;
}

/**
 * Per-test-and-viewport unit of work that the runtime hands to a pipeline.
 * Shared shape across every pipeline: the runtime expands `tests × viewports`
 * against `RuntimeOptions.viewports[stage.category]` and emits one TestUnit
 * per pair, with `controlURL` / `experimentURL` already resolved against
 * `test.startingPath` / `test.experimentPathOverride`.
 */
export interface TestUnit {
  readonly test: AbTestDefinition;
  readonly viewport: Viewport;
  readonly controlURL: string;
  readonly experimentURL: string;
  readonly testAndViewportId: string;
}

export interface StageRenderContext {
  readonly test: AbTestDefinition;
  readonly viewport: Viewport;
  readonly controlURL: string;
  readonly experimentURL: string;
  readonly artifacts: ArtifactScope;
  readonly logger: StageLogger;
  readonly priorOutcomes: ReadonlyMap<StageName, Outcome>;
  readonly runtime: StageRuntime;
}

export interface TestContext extends StageRenderContext {
  readonly testAndViewportId: string;
  /**
   * Read an earlier stage's full result (its `measurement`) for this same
   * test+viewport. Stages run sequentially per unit, so any stage registered
   * before this one has already persisted its outcome by the time `run` is
   * called. The in-memory `priorOutcomes` is deliberately lean (`.kind` only,
   * to keep memory down), so this is how a consequent stage gets the actual
   * data of a previous stage. Returns `undefined` if that stage didn't run,
   * errored, or produced no measurement. `M` is the prior stage's result type,
   * supplied by the caller (e.g. `readPriorResult<AuditResult>('audit')`).
   */
  readPriorResult<M = unknown>(stage: StageName): M | undefined;
  /**
   * Cooperative cancellation token for this stage+test. Threaded through to
   * any long-running browser work (Playwright awaits, Lighthouse samplers,
   * …) via `await raceCancellation(work)` — when the runner cancels it, the
   * await resolves with a Cancellation marker so the stage's catch can take
   * a final screenshot before the browser is torn down. The runner creates
   * a fresh token per `executeStageForUnit`.
   */
  readonly raceCancellation: RaceCancellation;
}

export interface StageRenderEntry<M = unknown> {
  readonly measurement: M;
  readonly viewport: Viewport;
}

export interface Stage<M = unknown> {
  readonly name: StageName;
  /**
   * Human-readable display name for this stage, used by the report's
   * "report sections filter" chips. Owned by the stage definition so the
   * report shell never hardcodes a name→label mapping. Distinct from the
   * in-card artifact heading a stage renders inside `renderArtifacts` (which
   * may be longer/different); this is the short chip label.
   */
  readonly label: string;
  renderArtifacts(measurements: readonly StageRenderEntry<M>[]): ReactNode;
  readonly category: StageCategory;
  readonly description: string;
  /**
   * Render order hint, independent of execution order. Stages render in
   * DESCENDING `renderingPriority` (higher = nearer the top of the card), ties
   * broken by registration order. Defaults to 0 when omitted. Lets a stage that
   * must RUN last — because it reviews earlier stages' results — still be SHOWN
   * first, e.g. the audit AI summary.
   */
  readonly renderingPriority?: number;
  applies(test: AbTestDefinition, viewport: Viewport, priorOutcomes: ReadonlyMap<StageName, Outcome>): boolean;
  run(ctx: TestContext, pool: WorkerPool): Promise<M>;
  machineReadableSummary(measurement: M, ctx: StageRenderContext): JsonValue;
  /**
   * Return a copy of `measurement` shaped for the **lightweight** report —
   * the shareable, self-contained `self-contained-performance-report.html`.
   * Drops relative-path hrefs that would 404 when the file is shipped alone,
   * keeps inlined data URIs (thumbs, AVIF rasterizations) the renderer
   * shows.
   */
  stripMeasurementForLightweight?(measurement: M): M;
  /**
   * Return a copy of `measurement` shaped for the **full** local-dev report.
   * Drops inlined data URIs that the renderer doesn't use in full mode
   * (full uses the lazy-loaded relative-path siblings instead) — keeps the
   * report HTML small.
   */
  stripMeasurementForFull?(measurement: M): M;
}

// DO NOT DELETE: this will be populated later.
export function emptyMachineReadableSummary(): JsonValue {
  return {};
}
