/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  ArtifactPath,
  ArtifactScope,
} from '../pipeline/artifact-store';

/**
 * Artifacts a stage captured at the moment it observed a failure. JSON-shaped
 * because the runner persists it inside `Outcome.failure` and the report
 * shell re-reads it from disk.
 *
 * Media is stored as a path relative to the report root. Full reports use
 * that path directly; self-contained report generation replaces it with a
 * data URI at the report boundary.
 */
export interface StageFailureArtifacts {
  /**
   * Report-relative path of a single media artifact captured at the failure —
   * either a screencast video or a screenshot of the final state.
   */
  media?: ArtifactPath;
}

/**
 * Throw from inside a Stage's `run()` (or the worker task it submits) when
 * you've captured failure artifacts that should surface in the HTML report.
 * The runner unwraps the `failureArtifacts` field into `Outcome.failure`;
 * the original error is preserved as `cause` so `errorInfo()`'s cause-chain
 * walk still produces the underlying stack.
 *
 * Always persist your bytes via `ctx.artifacts.writeFile(...)` before
 * throwing — `failureArtifacts.media` is the returned artifact path.
 */
export class StageFailureError extends Error {
  readonly failureArtifacts: StageFailureArtifacts;

  constructor(cause: unknown, artifacts: StageFailureArtifacts) {
    const message = cause instanceof Error
      ? cause.message
      : (typeof cause === 'string' ? cause : 'stage failed');
    super(message, { cause });
    this.name = 'StageFailureError';
    this.failureArtifacts = artifacts;
    const { stack: causeStack } = cause instanceof Error ? cause : {};
    if (!causeStack) return;
    // Composed on every read off the CURRENT message, the way V8 formats a plain
    // Error's stack lazily. `withLogPrefix` prepends its `[ experiment ]` column
    // to `err.message` as the error unwinds — after this wrapper is built, since
    // visreg captures the failure screenshot inside the per-side scope — so a
    // string frozen here would drop the failing side from every printed trace.
    // `Caused by:` stays as captured: Playwright materialised it before then.
    // The setter keeps assignment working for the IPC boundaries that rebuild
    // stacks; without it a get-only property throws.
    let assigned: string | undefined;
    Object.defineProperty(this, 'stack', {
      configurable: true,
      get: () => assigned ?? `${this.name}: ${firstLine(this.message)}\nCaused by: ${causeStack}`,
      set: (value: string) => { assigned = value; },
    });
  }
}

function firstLine(message: string): string {
  const newline = message.indexOf('\n');
  return newline === -1 ? message : message.slice(0, newline);
}

/**
 * Capture and persist a failure screenshot without masking the stage's
 * original error when Playwright or artifact persistence fails.
 */
export async function captureFailureScreenshot(
  artifacts: ArtifactScope,
  capture: () => Promise<Buffer> | Buffer,
  filename = 'failure-screenshot.png',
): Promise<ArtifactPath | undefined> {
  try {
    const png = await capture();
    return await artifacts.writeFile(filename, png);
  } catch (captureErr) {
    console.warn(
      `[shaka-perf failure-screenshot] capture failed: ${
        captureErr instanceof Error ? (captureErr.stack ?? captureErr.message) : String(captureErr)
      }`,
    );
    return undefined;
  }
}

/**
 * Walk an error's `cause` chain, returning the first non-`undefined` value the
 * `pick` predicate extracts from a node. `wrapWithCause` in the worker pool
 * nests the original error as `cause`, so what we're after can be one or more
 * levels deep. Cycle-safe via a `seen` set.
 */
function walkCauseChain<T>(err: unknown, pick: (node: object) => T | undefined): T | undefined {
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    const found = pick(cursor as object);
    if (found !== undefined) return found;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Find the artifacts of a `StageFailureError` anywhere in the cause chain.
 *
 * Not `err instanceof StageFailureError`: a stage that throws from inside a
 * `pool.submit` task has its error wrapped by the worker pool's poison error
 * once the retry budget is spent (`wrapWithCause`), so the StageFailureError
 * arrives as a `cause` and a bare instanceof check silently drops the media.
 * Same reason `findLastAnnotation` walks the chain.
 */
export function findFailureArtifacts(err: unknown): StageFailureArtifacts | undefined {
  return walkCauseChain(err, (node) => (
    node instanceof StageFailureError ? node.failureArtifacts : undefined
  ));
}

/**
 * Find a `failureMediaName` — the filename of a screenshot or screencast the
 * worker captured at the failure — anywhere in the cause chain. Out-of-process
 * workers (e.g. the Lighthouse IPC worker) attach it as a string property to
 * the rebuilt parent-side `Error`.
 */
export function findFailureMediaName(err: unknown): string | undefined {
  return walkCauseChain(err, (node) => {
    const name = (node as { failureMediaName?: unknown }).failureMediaName;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  });
}

/**
 * Find the label of the last `annotate(...)` the test reached before throwing.
 * The framework attaches it as plain error metadata so it survives normal
 * wrapper errors and the out-of-process Lighthouse IPC boundary.
 */
export function findLastAnnotation(err: unknown): string | undefined {
  return walkCauseChain(err, (node) => {
    const label = (node as { lastAnnotation?: unknown }).lastAnnotation;
    return typeof label === 'string' && label.length > 0 ? label : undefined;
  });
}
