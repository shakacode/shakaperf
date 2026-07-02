/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { StageLogger } from '../stage/stage';

/**
 * Process-wide console.log/warn/error override that routes each call
 * through the per-unit `StageLogger` bound to `consoleCaptureStorage`.
 *
 * Output composition happens once, here. Consumers contribute additional
 * prefix segments (column-aligned tags like visreg's `[control]` /
 * `[experiment]`) by calling `registerPrefixSource`; sources are pure
 * functions that read AsyncLocalStorage on demand. The logger's own
 * subject prefix is added downstream by `StageLogger.log` so this
 * module stays decoupled from runner internals.
 */

export const consoleCaptureStorage = new AsyncLocalStorage<StageLogger>();

export type PrefixSource = () => string | undefined;

const prefixSources: PrefixSource[] = [];

export function registerPrefixSource(source: PrefixSource): () => void {
  prefixSources.push(source);
  return () => {
    const i = prefixSources.indexOf(source);
    if (i >= 0) prefixSources.splice(i, 1);
  };
}

function collectPrefix(): string {
  let composed = '';
  for (const source of prefixSources) {
    const segment = source();
    if (segment) composed += segment;
  }
  // Trailing space separates the prefix column from the message; subject
  // intentionally has no trailing space so consecutive prefix segments
  // pack tight: `subject:sample-19[control]    message`.
  return `${composed} `;
}

function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack ?? arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

let installed = false;
let emitFallback: (line: string) => void = (line) => console.log(line);

/**
 * Original `console.log` captured at install time — used by buffered
 * loggers to emit a final composed line without going back through the
 * wrap. Returns the un-overridden `console.log` before install.
 */
export function getFallbackEmit(): (line: string) => void {
  return emitFallback;
}

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  const originals = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  emitFallback = originals.log;
  const wrap = (original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const logger = consoleCaptureStorage.getStore();
      if (!logger) {
        original(...args);
        return;
      }
      logger.log(`${collectPrefix()}${formatConsoleArgs(args)}`);
    };
  console.log = wrap(originals.log);
  console.warn = wrap(originals.warn);
  console.error = wrap(originals.error);
}
