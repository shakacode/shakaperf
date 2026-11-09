/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Viewport } from '../config';
import type { Outcome } from './outcome';
import type { ReportOutcome } from './report';
import type { StageRenderEntry } from '../stage/stage';

/** Outcomes from this test, including stages hidden by report filters. */
export interface StageReportContext {
  readonly outcomes: readonly ReportOutcome[];
}

function viewportIdentity(viewport: Viewport | undefined): string | undefined {
  if (!viewport || typeof viewport.label !== 'string' || !viewport.label ||
    !Number.isFinite(viewport.width) || viewport.width <= 0 ||
    !Number.isFinite(viewport.height) || viewport.height <= 0 ||
    !['mobile', 'desktop'].includes(viewport.formFactor) ||
    !Number.isFinite(viewport.deviceScaleFactor) || viewport.deviceScaleFactor <= 0 ||
    (viewport.userAgent !== undefined && typeof viewport.userAgent !== 'string')) return undefined;
  return JSON.stringify([
    viewport.label, viewport.width, viewport.height,
    viewport.formFactor, viewport.deviceScaleFactor, viewport.userAgent ?? null,
  ]);
}

/** Resolve a saved sibling stage only when its run and viewport are unambiguous. */
export function relatedStageOutcome(
  entry: StageRenderEntry,
  stage: string,
  context: StageReportContext,
): Outcome | undefined {
  if (entry.outcome?.stage === stage) return entry.outcome;
  const runId = entry.outcome?.runMetadata?.runId ?? entry.outcome?.runId;
  if (typeof runId !== 'string' || !runId) return undefined;
  const viewport = viewportIdentity(entry.outcome?.runMetadata?.viewport);
  if (!viewport) return undefined;
  const matches = context.outcomes.filter((outcome) => outcome.kind === 'ok' &&
    outcome.stage === stage &&
    (outcome.runMetadata?.runId ?? outcome.runId) === runId &&
    viewportIdentity(outcome.runMetadata?.viewport) === viewport);
  return matches.length === 1 ? matches[0] : undefined;
}
