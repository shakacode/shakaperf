/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * One argument, safe to paste into a POSIX shell. Test names carry spaces,
 * parentheses and `=>`, so a printed command is only useful quoted. Single
 * quotes take everything literally; an embedded single quote has to leave and
 * re-enter the quoting, which is what `'\''` does.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
