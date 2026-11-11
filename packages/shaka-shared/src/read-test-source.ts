/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import * as fs from 'fs';

/**
 * Reads the source file at `file` and returns the verbatim text of the
 * test registration that starts at `line`. Returns null
 * if the file cannot be read or the call cannot be located.
 *
 * For the usual one-registration-per-line style, counts parentheses while
 * ignoring quoted text and comments. This is a lightweight display reader,
 * not a full JavaScript parser.
 */
export function readTestSource(file: string | null, line: number | null): string | null {
  if (!file || !line || line < 1) return null;

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const lines = text.split('\n');
  if (line > lines.length) return null;
  // Lines are 1-indexed in stack traces.
  const startIdx = line - 1;

  let depth = 0;
  let endIdx: number | null = null;
  let started = false;
  let quote: string | null = null;
  let blockComment = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      const next = lines[i][j + 1];
      if (blockComment) {
        if (ch === '*' && next === '/') { blockComment = false; j++; }
        continue;
      }
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') { blockComment = true; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') {
        depth--;
        if (started && depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx != null) break;
  }

  if (endIdx == null) return null;
  return lines.slice(startIdx, endIdx + 1).join('\n');
}
