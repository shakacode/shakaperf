/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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

export interface Outcome {
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
  runId?: string;
  /**
   * True when the worker pool ran this stage task more than once — it crashed
   * or timed out on an earlier attempt but a retry succeeded. Set by the runner
   * (not by any stage), and surfaced as the cross-cutting "flaky (recovered
   * after retries)" chip. Only meaningful on `kind === 'ok'`.
   */
  recoveredAfterRetries?: boolean;
}
