/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AI_ANALYSIS_DIFF_FILENAME, writeAiAnalysisDiff } from '../core/html-diff';

describe('writeAiAnalysisDiff', () => {
  it('writes the plain unified diff of the two profile summaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-diff-'));
    writeFileSync(join(dir, 'control_performance_profile.summary.txt'), 'a\nb\nc\n');
    writeFileSync(join(dir, 'experiment_performance_profile.summary.txt'), 'a\nB\nc\n');

    const out = writeAiAnalysisDiff(dir);

    expect(out).toBe(join(dir, AI_ANALYSIS_DIFF_FILENAME));
    const text = readFileSync(out!, 'utf-8');
    expect(text).toContain('-b');
    expect(text).toContain('+B');
    expect(text).not.toContain('<');
  });

  it('says so when the summaries are identical', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-diff-'));
    writeFileSync(join(dir, 'control_performance_profile.summary.txt'), 'same\n');
    writeFileSync(join(dir, 'experiment_performance_profile.summary.txt'), 'same\n');
    expect(readFileSync(writeAiAnalysisDiff(dir)!, 'utf-8')).toContain('identical');
  });

  it('writes nothing when a side is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-diff-'));
    writeFileSync(join(dir, 'control_performance_profile.summary.txt'), 'only\n');
    expect(writeAiAnalysisDiff(dir)).toBeNull();
    expect(existsSync(join(dir, AI_ANALYSIS_DIFF_FILENAME))).toBe(false);
  });
});
