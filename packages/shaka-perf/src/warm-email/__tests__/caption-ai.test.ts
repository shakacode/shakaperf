/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseCaptionResponse } from '../caption-ai';
import type { CaptionRefineRequest } from '../client-report';

function req(n: number, name = 'Page'): CaptionRefineRequest {
  return {
    pageName: name,
    problem: 'slow',
    cues: Array.from({ length: n }, (_, i) => ({ kind: 'blank', atSec: `${i}.0s`, text: `beat ${i}` })),
  };
}

describe('parseCaptionResponse', () => {
  const reqs = [req(3), req(2)];

  it('returns per-page caption arrays aligned to the requests', () => {
    const raw = JSON.stringify([['a', 'b', 'c'], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });

  it('strips a ```json code fence', () => {
    const raw = '```json\n[["a","b","c"],["d","e"]]\n```';
    expect(parseCaptionResponse(raw, reqs)).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });

  it('normalizes em/en-dashes the model may slip in', () => {
    const raw = JSON.stringify([['a—b', 'b', 'c'], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)![0]![0]).toBe('a - b');
  });

  it('rejects the whole reply when the page count does not match', () => {
    expect(parseCaptionResponse(JSON.stringify([['a', 'b', 'c']]), reqs)).toBeNull();
  });

  it('keeps a per-page null (deterministic fallback) when ONE page miscounts', () => {
    // Page 0 has the wrong number of captions; page 1 is fine.
    const raw = JSON.stringify([['a', 'b'], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)).toEqual([null, ['d', 'e']]);
  });

  it('returns null when EVERY page falls back (nothing gained)', () => {
    const raw = JSON.stringify([['a'], ['d', 'e', 'f']]);
    expect(parseCaptionResponse(raw, reqs)).toBeNull();
  });

  it('rejects empty-string captions (treats that page as a fallback)', () => {
    const raw = JSON.stringify([['a', '', 'c'], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)).toEqual([null, ['d', 'e']]);
  });

  it('rejects an over-long caption that would overflow the overlay (too many words)', () => {
    const longCap = 'this caption runs on and on with far more than ten words total here';
    const raw = JSON.stringify([['a', 'b', longCap], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)).toEqual([null, ['d', 'e']]);
  });

  it('rejects an over-long caption by character count (one giant word)', () => {
    const raw = JSON.stringify([['a', 'b', 'x'.repeat(120)], ['d', 'e']]);
    expect(parseCaptionResponse(raw, reqs)).toEqual([null, ['d', 'e']]);
  });

  it('returns null on non-array or unparseable output', () => {
    expect(parseCaptionResponse('not json', reqs)).toBeNull();
    expect(parseCaptionResponse(JSON.stringify({ a: 1 }), reqs)).toBeNull();
  });
});
