/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * Generated `line:column` in a bundle → original source, line, column. The
 * base64 VLQ `mappings` field is decoded here directly: the format is small
 * and fixed, and it saves a dependency in a pinned, reviewed graph.
 */

export interface OriginalPosition {
  source: string;
  /** 1-based. */
  line: number;
  /** 0-based, as the map stores it. */
  column: number;
}

interface RawSourceMap {
  version?: unknown;
  sources?: unknown;
  sourceRoot?: unknown;
  mappings?: unknown;
  sections?: unknown;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map([...BASE64].map((char, index) => [char, index]));

// Segments of one line are stored flat: [generatedColumn, sourceIndex,
// originalLine, originalColumn] × n, all 0-based.
const SEGMENT = 4;

export class SourceMapLookup {
  private constructor(
    private readonly sources: readonly string[],
    private readonly lines: readonly (readonly number[])[],
  ) {}

  static parse(json: string): SourceMapLookup {
    const map = JSON.parse(json) as RawSourceMap;
    if (map.sections !== undefined) {
      throw new Error('indexed source maps (with "sections") are not supported');
    }
    if (!Array.isArray(map.sources) || typeof map.mappings !== 'string') {
      throw new Error('not a source map: expected "sources" and "mappings"');
    }
    const root = typeof map.sourceRoot === 'string' && map.sourceRoot !== ''
      ? map.sourceRoot.replace(/\/?$/, '/')
      : '';
    const sources = map.sources.map((source) => (typeof source === 'string' ? root + source : ''));
    return new SourceMapLookup(sources, decodeMappings(map.mappings, sources.length));
  }

  /** `line` 1-based, `column` 0-based — V8 stack frames report columns 1-based. */
  originalPositionFor(line: number, column: number): OriginalPosition | null {
    const segments = this.lines[line - 1];
    if (!segments || segments.length === 0) return null;
    let low = 0;
    let high = segments.length / SEGMENT - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid * SEGMENT] <= column) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) return null;
    const at = found * SEGMENT;
    return {
      source: this.sources[segments[at + 1]],
      line: segments[at + 2] + 1,
      column: segments[at + 3],
    };
  }
}

function decodeMappings(mappings: string, sourceCount: number): number[][] {
  const lines: number[][] = [];
  let current: number[] = [];
  // Only the generated column resets per line; the other deltas run across lines.
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let i = 0;
  const end = mappings.length;
  // One extra step with a ';' sentinel flushes the last line.
  while (i <= end) {
    const char = i < end ? mappings[i] : ';';
    if (char === ';') {
      lines.push(current);
      current = [];
      generatedColumn = 0;
      i += 1;
      continue;
    }
    if (char === ',') {
      i += 1;
      continue;
    }
    const fields: number[] = [];
    while (i < end && mappings[i] !== ',' && mappings[i] !== ';') {
      let value = 0;
      let shift = 0;
      let digit: number;
      do {
        const found = BASE64_VALUE.get(mappings[i]);
        if (found === undefined) {
          throw new Error(`invalid base64 VLQ character ${JSON.stringify(mappings[i])} in mappings`);
        }
        digit = found;
        i += 1;
        value += (digit & 31) * 2 ** shift;
        shift += 5;
      } while (digit & 32);
      fields.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
    }
    generatedColumn += fields[0] ?? 0;
    // A one-field segment maps to nothing original.
    if (fields.length >= 4) {
      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      if (sourceIndex >= 0 && sourceIndex < sourceCount) {
        current.push(generatedColumn, sourceIndex, originalLine, originalColumn);
      }
    }
  }
  return lines;
}
