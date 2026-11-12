/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Viewport } from '../config';
import type { RunMetadata, MeasurementThrottling } from './run-metadata';
import type { StageName } from '../stage/stage';
import type { StageFailureArtifacts } from '../stage/stage-failure';

export type OutcomeKind = 'ok' | 'error' | 'skipped';

export interface ErrorInfo {
  message: string;
  stack?: string;
  /**
   * Label of the last test `annotate(...)` reached before the throw (e.g.
   * "Fill email"). Lets the report headline the failure with the in-flight
   * test step instead of the bare stage name. Absent for stages with no
   * test-driven annotations (or failures before the first `annotate`).
   */
  lastAnnotation?: string;
}

export interface ExecutionDetails {
  /** Saved settings reported by this execution, absent when not captured. */
  readonly numberOfMeasurements?: number;
  readonly measurementSideCount?: number;
  readonly throttling?: readonly MeasurementThrottling[];
  readonly runId: string;
  readonly viewport: Viewport;
  readonly testSourceHref: string | null;
  readonly taskRetries?: number;
  readonly taskRetryLimit?: number;
  readonly recoveredAfterRetries: boolean;
}

export interface Outcome {
  executionDetails: ExecutionDetails;
  kind: OutcomeKind;
  stage: StageName;
  measurement?: unknown;
  error?: ErrorInfo;
  /**
   * Diagnostic artifacts the stage captured at the moment of failure (e.g. a
   * screenshot of the live browser). Populated by the runner when the thrown
   * error is a `StageFailureError`. Only present when `kind === 'error'`.
   */
  failure?: StageFailureArtifacts;
  reason?: string;
  logs?: string;
  runMetadata?: RunMetadata;
}

/** Read the current saved outcome contract without legacy conversions. */
export function parseOutcome(json: string): Outcome {
  return JSON.parse(json) as Outcome;
}
