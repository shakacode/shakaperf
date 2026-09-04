/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface StackFrame {
  url: string;
  /** 1-based. */
  line: number;
  /** 1-based, as V8 reports it. */
  column: number;
}

/**
 * One line of a V8 stack: `at fn (url:line:col)` or `at url:line:col`. Null
 * for anything without a position (`<anonymous>`, the message line).
 */
export function parseStackFrame(text: string): StackFrame | null {
  const match = /(?:^|[\s(])([^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(text.trim());
  if (!match) return null;
  const [, url, line, column] = match;
  return { url, line: Number(line), column: Number(column) };
}
