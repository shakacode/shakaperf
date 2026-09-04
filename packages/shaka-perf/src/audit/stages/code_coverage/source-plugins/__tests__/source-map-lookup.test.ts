/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { SourceMapLookup } from '../source-map-lookup';
import { encodeMappings } from './encode-mappings';

const map = (mappings: string, sources = ['a.ts', 'b.ts'], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 3, sources, names: [], mappings, ...extra });

describe('SourceMapLookup', () => {
  // Generated line 1: col 0 → a.ts 1:0, col 10 → b.ts 3:4. Line 2: nothing.
  // Line 3: col 5 → a.ts 2:1.
  const lookup = SourceMapLookup.parse(map(encodeMappings([
    [[0, 0, 1, 0], [10, 1, 3, 4]],
    [],
    [[5, 0, 2, 1]],
  ])));

  it('maps a generated position to its original source, line, and column', () => {
    expect(lookup.originalPositionFor(1, 0)).toEqual({ source: 'a.ts', line: 1, column: 0 });
    expect(lookup.originalPositionFor(1, 10)).toEqual({ source: 'b.ts', line: 3, column: 4 });
    expect(lookup.originalPositionFor(3, 5)).toEqual({ source: 'a.ts', line: 2, column: 1 });
  });

  it('gives a column between two segments to the one before it', () => {
    expect(lookup.originalPositionFor(1, 7)?.source).toBe('a.ts');
    expect(lookup.originalPositionFor(1, 500)?.source).toBe('b.ts');
  });

  it('knows nothing about a column before the first segment, or a line with none', () => {
    expect(lookup.originalPositionFor(3, 4)).toBeNull();
    expect(lookup.originalPositionFor(2, 0)).toBeNull();
    expect(lookup.originalPositionFor(4, 0)).toBeNull();
    expect(lookup.originalPositionFor(0, 0)).toBeNull();
  });

  it('decodes negative deltas — a later segment mapping to an EARLIER original line', () => {
    const back = SourceMapLookup.parse(map(encodeMappings([
      [[0, 0, 40, 12], [8, 0, 3, 0]],
    ])));
    expect(back.originalPositionFor(1, 0)).toEqual({ source: 'a.ts', line: 40, column: 12 });
    expect(back.originalPositionFor(1, 8)).toEqual({ source: 'a.ts', line: 3, column: 0 });
  });

  it('carries source-index and line deltas across generated lines', () => {
    const across = SourceMapLookup.parse(map(encodeMappings([
      [[0, 1, 7, 0]],
      [[0, 0, 9, 2]],
    ])));
    expect(across.originalPositionFor(2, 0)).toEqual({ source: 'a.ts', line: 9, column: 2 });
  });

  it('ignores one-field segments, which map to nothing', () => {
    const sparse = SourceMapLookup.parse(map(`A,${encodeMappings([[[4, 0, 1, 0]]])}`));
    expect(sparse.originalPositionFor(1, 0)).toBeNull();
    expect(sparse.originalPositionFor(1, 4)).toEqual({ source: 'a.ts', line: 1, column: 0 });
  });

  it('prefixes sources with sourceRoot', () => {
    const rooted = SourceMapLookup.parse(map(encodeMappings([[[0, 0, 1, 0]]]), ['x.ts'], { sourceRoot: 'webpack://demo' }));
    expect(rooted.originalPositionFor(1, 0)?.source).toBe('webpack://demo/x.ts');
  });

  it('refuses what it cannot read rather than answering wrongly', () => {
    expect(() => SourceMapLookup.parse(JSON.stringify({ version: 3, sections: [] })))
      .toThrow(/sections/);
    expect(() => SourceMapLookup.parse(JSON.stringify({ version: 3 })))
      .toThrow(/not a source map/);
    expect(() => SourceMapLookup.parse(map('A*A')))
      .toThrow(/invalid base64 VLQ character/);
  });
});
