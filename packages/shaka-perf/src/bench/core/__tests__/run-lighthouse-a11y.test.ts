/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describe, it, expect } from '@jest/globals';
import type { RunnerResult } from 'lighthouse';
import { accessibilityScoreFromLhr } from '../run-lighthouse';
import { makeNavigationSample } from '../lighthouse-config';

type Lhr = RunnerResult['lhr'];

// Minimal lhr stub - the helper only reads `categories.<name>.score`.
const lhr = (categories: Record<string, { score: number | null } | undefined>): Lhr =>
  ({ categories } as unknown as Lhr);

describe('accessibilityScoreFromLhr', () => {
  it('scales a 0-1 category score to the familiar /100 number', () => {
    expect(accessibilityScoreFromLhr(lhr({ accessibility: { score: 0.95 } }))).toBe(95);
    expect(accessibilityScoreFromLhr(lhr({ accessibility: { score: 0.842 } }))).toBeCloseTo(84.2);
    expect(accessibilityScoreFromLhr(lhr({ accessibility: { score: 1 } }))).toBe(100);
  });

  it('keeps a worst-case score of 0 (not treated as missing)', () => {
    // A fully inaccessible page scores 0; the != null / isFinite guards
    // downstream must let it through rather than dropping it as falsy.
    expect(accessibilityScoreFromLhr(lhr({ accessibility: { score: 0 } }))).toBe(0);
  });

  it('returns null when the run had no accessibility category (perf-only / compare)', () => {
    expect(accessibilityScoreFromLhr(lhr({ performance: { score: 0.5 } }))).toBeNull();
  });

  it('returns null when the category score is null', () => {
    expect(accessibilityScoreFromLhr(lhr({ accessibility: { score: null } }))).toBeNull();
  });
});

describe('makeNavigationSample', () => {
  it('carries a worst-case score of 0 (not dropped by the conditional spread)', () => {
    expect(makeNavigationSample([], 0).accessibilityScore).toBe(0);
  });

  it('keeps a real score', () => {
    expect(makeNavigationSample([], 95).accessibilityScore).toBe(95);
  });

  it('omits the field when there is no score (null -> compare samples)', () => {
    const sample = makeNavigationSample([], null);
    expect(sample.accessibilityScore).toBeUndefined();
    expect('accessibilityScore' in sample).toBe(false);
  });
});
