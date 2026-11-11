/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { LoadedRunMetadata, RunMetadata } from './run-metadata';
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
  readonly runId: string;
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
  runMetadata?: LoadedRunMetadata;
}

/** New outcomes cannot persist metadata without a captured source. */
export type RecordedOutcome = Omit<Outcome, 'runMetadata'> & {
  runMetadata?: RunMetadata;
};

/** Read the current saved outcome contract without legacy conversions. */
export function parseOutcome(json: string): Outcome {
  return JSON.parse(json) as Outcome;
}
