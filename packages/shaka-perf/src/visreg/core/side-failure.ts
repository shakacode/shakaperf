/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export type VisregSide = 'control' | 'experiment';

export class VisregSideFailure extends Error {
  readonly side: VisregSide;
  readonly screenshotPath?: string;

  constructor(side: VisregSide, cause: unknown, screenshotPath?: string) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message, { cause });
    this.name = 'VisregSideFailure';
    this.side = side;
    this.screenshotPath = screenshotPath;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.name}: ${message.split('\n', 1)[0]}\nCaused by: ${cause.stack}`;
    }
  }
}

export function findVisregSideFailure(
  error: unknown,
): VisregSideFailure | undefined {
  const seen = new Set<unknown>();
  let cursor = error;
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor instanceof VisregSideFailure) return cursor;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}
