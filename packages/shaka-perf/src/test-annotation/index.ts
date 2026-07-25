/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TestAnnotate } from 'shaka-shared';

const annotationStorage = new AsyncLocalStorage<{ lastAnnotation?: string }>();

/**
 * Maximum length of an `annotate(label)` string. The label is surfaced verbatim
 * in the UX report (visreg diff banner, audit/perf error banner, timeline mark),
 * so it has to read as a short test-step name - not a sentence or a dumped value.
 */
export const MAX_ANNOTATION_LENGTH = 50;

/**
 * Run `body` in its own isolated annotation scope. Each call gets a fresh
 * single-slot store, so concurrent bodies never share a `lastAnnotation` - the
 * visreg engine prepares the control and experiment pages side by side under a
 * common stage-level context, and the accessibility engine scans each side in
 * sibling scopes too. A shared slot would let whichever side ran `annotate()`
 * last stamp the other side's failure. On a throw the label is attached to the
 * error itself, so normal wrapper errors can find it via the cause chain; the
 * Lighthouse worker process forwards the plain `lastAnnotation` field
 * explicitly over IPC. The trade-off is deliberate: labels decorate errors
 * thrown inside the test body, not engine errors thrown after the body returns.
 */
export function runWithTestAnnotationContext<T>(
  body: () => Promise<T>,
): Promise<T> {
  return annotationStorage.run({}, async () => {
    try {
      return await body();
    } catch (err: unknown) {
      throw attachLatestTestAnnotation(err, getLatestTestAnnotation(err));
    }
  });
}

export function createTestAnnotate(
  onAnnotate?: (label: string) => Promise<void>,
): TestAnnotate {
  return async (label: string): Promise<void> => {
    // Fail fast on over-long labels: the string is displayed verbatim in the UX
    // report, so it must stay concise. Throwing here (before recording it)
    // surfaces the mistake to the test author rather than letting a sentence-
    // length blob leak into the report banner / timeline.
    if (label.length > MAX_ANNOTATION_LENGTH) {
      throw new Error(
        `annotate(${JSON.stringify(label)}) is ${label.length} characters; the ` +
        `limit is ${MAX_ANNOTATION_LENGTH}. This text is displayed verbatim in ` +
        `the UX report, so keep it short - a concise test-step name, not a sentence.`,
      );
    }

    const state = annotationStorage.getStore();
    if (state) state.lastAnnotation = label;

    // Surface the step in the console so a run's progress is legible in the
    // logs and a hung test shows which annotated step it stalled on. Goes
    // through console.log on purpose: the visreg engine captures it and adds
    // the per-test log prefix, and the bench worker forwards it over IPC, so
    // the line lands in the same stream as the rest of that test's output.
    console.log(`annotate: ${label}`);
    if (!onAnnotate) return;
    // Swallow here (not just by convention at the call site): a test author
    // writing `annotate('x')` without `await` would otherwise turn a throwing
    // side effect into an unhandled rejection that could kill the worker.
    try {
      await onAnnotate(label);
    } catch (err) {
      console.warn(`onAnnotate(${JSON.stringify(label)}) threw: ${(err as Error).message}`);
    }
  };
}

export function getLatestTestAnnotation(err?: unknown): string | undefined {
  const fromError = findErrorAnnotation(err);
  if (fromError) return fromError;
  return annotationStorage.getStore()?.lastAnnotation;
}

export function attachLatestTestAnnotation<T>(err: T, lastAnnotation = getLatestTestAnnotation()): T {
  if (!lastAnnotation || !err || typeof err !== 'object') return err;
  try {
    Object.defineProperty(err, 'lastAnnotation', {
      value: lastAnnotation,
      configurable: true,
      writable: true,
    });
  } catch {
    // Never let metadata attachment mask the user's original failure.
  }
  return err;
}

export function messageWithLatestTestAnnotation(message: string, lastAnnotation?: string): string {
  if (!lastAnnotation) return message;
  const suffix = annotationSuffix(lastAnnotation);
  return message.endsWith(suffix) ? message : `${message}${suffix}`;
}

export function stackWithLatestTestAnnotation(err: Error, lastAnnotation = getLatestTestAnnotation(err)): string | undefined {
  const stack = err.stack;
  if (!stack) return undefined;
  const newline = stack.indexOf('\n');
  if (newline === -1) return messageWithLatestTestAnnotation(stack, lastAnnotation);
  return `${messageWithLatestTestAnnotation(stack.slice(0, newline), lastAnnotation)}${stack.slice(newline)}`;
}

function findErrorAnnotation(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cursor = err;
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    const annotation = (cursor as { lastAnnotation?: unknown }).lastAnnotation;
    if (typeof annotation === 'string' && annotation.length > 0) return annotation;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

function annotationSuffix (lastAnnotation: string): string {
  return ` (latest test annotation: ${JSON.stringify(lastAnnotation)})`;
}

/**
 * Run `body` with a fresh `annotate(label)` whose most recent value is recorded
 * in framework state. If `body` throws, the original error is rethrown with
 * that label attached, so log/report formatting can surface the in-flight test
 * step without individual stages constructing annotation wrapper errors.
 *
 * `onAnnotate` lets an engine attach a side effect to each annotation (e.g.
 * the bench worker emits a `performance.mark` for the timeline). Its errors
 * are swallowed here (a warning) rather than left to each caller - tests
 * routinely call `annotate('x')` without `await`, so a rejection would
 * otherwise surface as an unhandled rejection that could kill the worker. The
 * last label is recorded synchronously, before `onAnnotate`, so the step is
 * captured even when the side effect (or the page it touches) is mid-teardown.
 */
export async function runWithLastAnnotation<T>(
  body: (annotate: (label: string) => Promise<void>) => Promise<T>,
  onAnnotate?: (label: string) => Promise<void>,
): Promise<T> {
  return runWithTestAnnotationContext(() => body(createTestAnnotate(onAnnotate)));
}
