/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseAccessibilityScoreStdout } from '../accessibility-score';

describe('parseAccessibilityScoreStdout', () => {
  it('reads a clean score line', () => {
    expect(parseAccessibilityScoreStdout('{"score":91}')).toBe(91);
    expect(parseAccessibilityScoreStdout('{"score":100}')).toBe(100);
    expect(parseAccessibilityScoreStdout('{"score":0}')).toBe(0);
  });

  it('extracts the score object from surrounding stderr-style noise', () => {
    expect(parseAccessibilityScoreStdout('some chrome log\n{"score":98}\n')).toBe(98);
  });

  it('returns null for an explicit null score (Lighthouse dropped a11y)', () => {
    expect(parseAccessibilityScoreStdout('{"score":null}')).toBeNull();
  });

  it('returns null for empty or malformed output (best-effort, never throws)', () => {
    expect(parseAccessibilityScoreStdout('')).toBeNull();
    expect(parseAccessibilityScoreStdout('not json')).toBeNull();
    expect(parseAccessibilityScoreStdout('{"score":"high"}')).toBeNull();
    expect(parseAccessibilityScoreStdout('{}')).toBeNull();
  });
});
