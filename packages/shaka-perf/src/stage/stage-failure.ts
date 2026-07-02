/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ArtifactScope } from '../pipeline/artifact-store';

/**
 * Artifacts a stage captured at the moment it observed a failure. JSON-shaped
 * because the runner persists it inside `Outcome.failure` and the report
 * shell re-reads it from disk.
 *
 * Media is stored as a base64 `data:` URI (via
 * `ArtifactScope.inlineDataUri(name)`) rather than a relative href — the
 * report HTML is bundled with vite-plugin-singlefile and has no way to
 * resolve a sibling file when opened standalone. The source file is still
 * written to disk for debugging, but the report carries its bytes inline.
 */
export interface StageFailureArtifacts {
  /**
   * `data:` URI of a single media artifact captured at the failure — either a
   * `video/mp4` screencast of the run up to the throw (preferred, when frames
   * were recorded) or a `image/png` screenshot of the final state (the
   * fallback, e.g. the perf path or when no screencast frames exist). The MIME
   * type in the URI tells the report which element to render.
   */
  media?: string;
}

/**
 * Throw from inside a Stage's `run()` (or the worker task it submits) when
 * you've captured failure artifacts that should surface in the HTML report.
 * The runner unwraps the `failureArtifacts` field into `Outcome.failure`;
 * the original error is preserved as `cause` so `errorInfo()`'s cause-chain
 * walk still produces the underlying stack.
 *
 * Always persist your bytes via `ctx.artifacts.writeFile(...)` BEFORE
 * throwing — `failureArtifacts.media` is just an inline data URI of those bytes.
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
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.name}: ${firstLine(message)}\nCaused by: ${cause.stack}`;
    }
  }
}

function firstLine(message: string): string {
  const newline = message.indexOf('\n');
  return newline === -1 ? message : message.slice(0, newline);
}

/**
 * Convenience for the common case: persist a screenshot via the test
 * context, then return a `StageFailureError` that references it. Use inside
 * a stage's catch:
 *
 *     } catch (err) {
 *       throw await failWithScreenshot(ctx.artifacts, err, () => page.screenshot());
 *     }
 *
 * If the capture itself fails (browser already torn down, OOM, …) the
 * original error is wrapped without artifacts rather than masked by the
 * capture failure.
 */
export async function failWithScreenshot(
  artifacts: ArtifactScope,
  cause: unknown,
  capture: () => Promise<Buffer> | Buffer,
  filename = 'failure-screenshot.png',
): Promise<StageFailureError> {
  try {
    const png = await capture();
    await artifacts.writeFile(filename, png);
    return new StageFailureError(cause, { media: artifacts.inlineDataUri(filename) });
  } catch (captureErr) {
    // Surface the capture failure so it isn't a silent black hole — but
    // still propagate the original cause unmasked.
    console.warn(
      `[shaka-perf failure-screenshot] capture failed: ${
        captureErr instanceof Error ? (captureErr.stack ?? captureErr.message) : String(captureErr)
      }`,
    );
    return new StageFailureError(cause, {});
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
