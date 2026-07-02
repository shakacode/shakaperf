/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import chalk, { Instance } from 'chalk';
import { registerPrefixSource } from '../../../pipeline/console-capture';

// Forced-color chalk instance for log-line composition. The captured log
// stream is serialised into the HTML report, where the report shell parses
// ANSI codes back into styled spans. We can't rely on the parent process's
// stdout TTY detection (CI, pipes, yarn wrappers all drop colours) — without
// this, every log line ships to the report as flat grey. Use the default
// `chalk` (TTY-respecting) for messages that ALSO have to read well on the
// user's terminal; use this `logChalk` for content that's destined for the
// report.
const logChalk = new Instance({ level: 2 });

const logPrefixStorage = new AsyncLocalStorage<string[]>();
const subjectColors = [
  logChalk.cyan,
  logChalk.green,
  logChalk.magenta,
  logChalk.yellow,
  logChalk.blue,
  logChalk.white,
] as const;
const subjectColorIndexes = new Map<string, number>();
const viewportColorIndexes = new Map<string, number>();
const categoryColorIndexes = new Map<string, number>();
const sourcePrefixParts = new Map<string, {
  source: string;
  viewportLabel?: string;
  testCategory?: string;
  sampleLabel?: string;
}>();

function colorFor(map: Map<string, number>, key: string): (value: string) => string {
  let colorIndex = map.get(key);
  if (colorIndex == null) {
    colorIndex = map.size % subjectColors.length;
    map.set(key, colorIndex);
  }
  return subjectColors[colorIndex];
}

export function testSourcePrefix(
  file: string | null | undefined,
  line: number | null | undefined,
  fallback: string,
  viewportLabel?: string,
  testCategory?: string,
  sampleLabel?: string,
): string {
  const relativeFile = file ? path.relative(process.cwd(), file) : null;
  const base = relativeFile && line != null ? `${relativeFile}:${line}` : fallback;
  const prefix = [base, viewportLabel, testCategory, sampleLabel].filter(Boolean).join(':');
  sourcePrefixParts.set(prefix, { source: base, viewportLabel, testCategory, sampleLabel });
  return prefix;
}

export function colorizedLogPrefix(subject: string): string {
  return `${composeColorizedSubject(subject)}${elapsedTag()}`;
}

/**
 * `<X.Ys>` suffix appended to every emitted log line — wall-clock seconds
 * (one decimal) since the `shaka-perf` process started. Lets you read an
 * interleaved log stream and immediately see how far into the run a line
 * was emitted without scrolling back for context. Dim so the column reads
 * as secondary metadata next to the colored subject prefix.
 */
function elapsedTag(): string {
  return logChalk.dim(`<${process.uptime().toFixed(1)}s>`);
}

function composeColorizedSubject(subject: string): string {
  const parts = sourcePrefixParts.get(subject);
  if (parts) {
    const source = colorFor(subjectColorIndexes, parts.source)(parts.source);
    if (parts.viewportLabel) {
      const viewport = colorFor(viewportColorIndexes, parts.viewportLabel)(parts.viewportLabel);
      if (parts.testCategory) {
        const category = colorFor(categoryColorIndexes, parts.testCategory)(parts.testCategory);
        return `${source}:${viewport}:${category}:${parts.sampleLabel ? `${parts.sampleLabel}:` : ''}`;
      }
      return `${source}:${viewport}:${parts.sampleLabel ? `${parts.sampleLabel}:` : ''}`;
    }
    if (parts.testCategory) {
      const category = colorFor(categoryColorIndexes, parts.testCategory)(parts.testCategory);
      return `${source}:${category}:${parts.sampleLabel ? `${parts.sampleLabel}:` : ''}`;
    }
    return `${source}:${parts.sampleLabel ? `${parts.sampleLabel}:` : ''}`;
  }
  return colorFor(subjectColorIndexes, subject)(`${subject}:`);
}

/**
 * Scope a synchronous or async operation under an additional log-prefix
 * column. Multiple nested calls accumulate left-to-right in render order,
 * so every line emitted inside the scope gets `subject: outer inner ...`
 * via the shared console-capture wrap.
 *
 * On error, the prefix is also prepended to `err.message` before
 * re-throwing — outer catches running outside the AsyncLocalStorage
 * scope still surface the column in every downstream `String(err)` log.
 */
export function withLogPrefix<T>(prefix: string, fn: () => T): T {
  const existing = logPrefixStorage.getStore() ?? [];
  return logPrefixStorage.run([...existing, prefix], () => {
    const annotate = (err: unknown): void => {
      if (err instanceof Error) err.message = `${prefix} ${err.message}`;
    };
    let result: T;
    try {
      result = fn();
    } catch (err) {
      annotate(err);
      throw err;
    }
    if (result instanceof Promise) {
      return result.catch((err) => { annotate(err); throw err; }) as T;
    }
    return result;
  });
}

registerPrefixSource(() => {
  const prefixes = logPrefixStorage.getStore();
  return prefixes && prefixes.length > 0 ? prefixes.join('') : undefined;
});

