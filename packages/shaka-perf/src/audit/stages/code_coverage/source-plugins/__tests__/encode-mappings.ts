/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Test-side encoder, so a fixture map reads as numbers rather than as `AAAA;CACC`.
// A segment is [generatedColumn, sourceIndex, originalLine (1-based), originalColumn];
// one inner array per generated line. Deltas are the encoder's job, as in the spec.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
  let rest = value < 0 ? (-value) * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = rest % 32;
    rest = Math.floor(rest / 32);
    if (rest > 0) digit += 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

export function encodeMappings(lines: readonly (readonly (readonly number[])[])[]): string {
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  return lines.map((segments) => {
    let generatedColumn = 0;
    return segments.map((segment) => {
      const [column, source, line, originalCol] = segment;
      let text = vlq(column - generatedColumn);
      generatedColumn = column;
      if (segment.length >= 4) {
        text += vlq(source - sourceIndex) + vlq(line - 1 - originalLine) + vlq(originalCol - originalColumn);
        sourceIndex = source;
        originalLine = line - 1;
        originalColumn = originalCol;
      }
      return text;
    }).join(',');
  }).join(';');
}
