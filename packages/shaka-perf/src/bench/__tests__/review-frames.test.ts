/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  frameSignature,
  matchFrames,
  pairUnmatchedFrames,
  type SignedFrame,
} from '../core/frame-matching';
import {
  LARGEST_DIFF_FACTOR,
  REVIEW_FRAMES_DIR,
  reviewFramesSummarySection,
  selectReviewPairs,
  writeReviewFrames,
} from '../core/review-frames';

const FIXTURES = join(__dirname, 'frame-fixtures');

interface Side {
  signed: SignedFrame[];
  jpegs: Buffer[];
}

function loadSide(name: string, which: 'control' | 'experiment'): Side {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, name, 'frames.json'), 'utf-8')) as Record<'control' | 'experiment', number[]>;
  const dir = join(FIXTURES, name, which);
  const jpegs = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => readFileSync(join(dir, f)));
  return {
    jpegs,
    signed: jpegs.map((buf, i) => ({ timeMs: manifest[which][i], signature: frameSignature(buf) })),
  };
}

function describePairs(pairs: ReturnType<typeof selectReviewPairs>): string[] {
  return pairs.map((p) => `${p.kind} ${p.role} ${p.controlIndex}->${p.experimentIndex}`);
}

describe('selectReviewPairs', () => {
  function fixture(name: string) {
    const control = loadSide(name, 'control');
    const experiment = loadSide(name, 'experiment');
    const { matches } = matchFrames(control.signed, experiment.signed);
    const mismatches = pairUnmatchedFrames(matches, control.signed.length, experiment.signed.length);
    const frames = (side: Side) => side.signed.map((f, i) => ({ timeMs: f.timeMs, dataUri: '', snapshot: side.jpegs[i] }));
    return {
      matches,
      mismatches,
      control: frames(control),
      experiment: frames(experiment),
    };
  }

  it('gives every stripe its own ends, matching and mismatching alike', () => {
    const { matches, mismatches, control, experiment } = fixture('homepage-desktop');

    const pairs = selectReviewPairs(matches, mismatches, control, experiment);

    // Walk the timeline and count the stripes: runs of neighbouring lines of
    // one kind. Every stripe must be represented.
    const lines = [
      ...matches.map((m) => ({ kind: 'match', c: m.controlIndex })),
      ...mismatches.map((p) => ({ kind: 'mismatch', c: Math.round(p.controlIndex) })),
    ].sort((a, b) => a.c - b.c);
    const stripes = lines.filter((l, i) => i === 0 || l.kind !== lines[i - 1].kind).length;
    expect(stripes).toBeGreaterThan(1);

    const firsts = pairs.filter((p) => p.role === 'first');
    expect(firsts.length).toBe(stripes);
    expect(pairs.filter((p) => p.role === 'last').length).toBeLessThanOrEqual(stripes);
    expect(new Set(pairs.map((p) => p.kind))).toEqual(new Set(['match', 'mismatch']));
  });

  it('adds the biggest-differing pair of a stripe only when it stands clear of that stripe\'s ends', () => {
    const { matches, mismatches, control, experiment } = fixture('homepage-desktop');
    const pairs = selectReviewPairs(matches, mismatches, control, experiment);

    for (const largest of pairs.filter((p) => p.role === 'largest')) {
      expect(largest.kind).toBe('mismatch');
      // Its own stripe's ends are the pairs around it in the returned order.
      const at = pairs.indexOf(largest);
      const ends = pairs.slice(0, at).reverse().find((p) => p.role === 'first')!;
      expect(largest.changedPixels).toBeGreaterThanOrEqual(ends.changedPixels * LARGEST_DIFF_FACTOR);
    }
  });

  it('returns nothing for two empty runs', () => {
    expect(selectReviewPairs([], [], [], [])).toEqual([]);
  });
});

describe('reviewFramesSummarySection', () => {
  it('lists the side\'s own frame of each pair, and a diff to open for a mismatch', () => {
    const pairs = [
      { kind: 'match' as const, role: 'first' as const, controlIndex: 1, experimentIndex: 0, changedPixels: 0 },
      { kind: 'mismatch' as const, role: 'last' as const, controlIndex: 2, experimentIndex: 1, changedPixels: 1234 },
    ];
    const frame = (timeMs: number) => ({ timeMs, dataUri: '', snapshot: Buffer.alloc(0) });
    const control = [frame(0), frame(100), frame(250.5)];
    const experiment = [frame(120), frame(260)];
    const controlSection = reviewFramesSummarySection('control', pairs, control, experiment, true);
    const experimentSection = reviewFramesSummarySection('experiment', pairs, control, experiment, true);

    const strip = (s: string) => s.replace(/review_frames\/(control|experiment)_\S+\.jpg/g, 'FRAME');
    expect(strip(controlSection)).toBe(strip(experimentSection));
    expect(controlSection).toContain('review_frames/control_100.00ms.jpg');
    expect(experimentSection).toContain('review_frames/experiment_120.00ms.jpg');
    expect(controlSection).toContain('mismatch (last)');
    expect(controlSection).toContain('1234 px differ');
    // Both sides name the same diff image, built from both frames' times, on
    // the mismatch's own line.
    const mismatchLine = controlSection.split('\n').find((l) => l.includes('mismatch (last)'))!;
    expect(mismatchLine).toContain('review_frames/control_250.50ms.jpg  triage diff: review_frames/control_experiment_diff_250.50ms_260.00ms.png');
    expect(experimentSection).toContain('review_frames/experiment_260.00ms.jpg  triage diff: review_frames/control_experiment_diff_250.50ms_260.00ms.png');
    expect(controlSection).not.toContain('WARNING');
  });

  it('warns on each side when the runs do not end on the same picture', () => {
    const pairs = [{ kind: 'mismatch' as const, role: 'last' as const, controlIndex: 0, experimentIndex: 0, changedPixels: 9 }];
    const frame = (timeMs: number) => ({ timeMs, dataUri: '', snapshot: Buffer.alloc(0) });
    const section = (side: 'control' | 'experiment') =>
      reviewFramesSummarySection(side, pairs, [frame(0)], [frame(10)], false);

    expect(section('control')).toContain('WARNING (control): the last frame is different.');
    expect(section('experiment')).toContain('Consider re-launching the low-noise perf-test.');
  });
});

describe('writeReviewFrames', () => {
  function writeProfile(dir: string, side: 'control' | 'experiment', jpegs: Buffer[], timesMs: number[]): string {
    const traceEvents = [
      { name: 'navigationStart', cat: 'blink.user_timing', ph: 'R', ts: 1_000_000 },
      ...jpegs.map((buf, i) => ({
        name: 'Screenshot',
        cat: 'disabled-by-default-devtools.screenshot',
        ph: 'O',
        ts: 1_000_000 + timesMs[i] * 1000,
        args: { snapshot: buf.toString('base64') },
      })),
    ];
    const profilePath = join(dir, `${side}_performance_profile.json`);
    writeFileSync(profilePath, JSON.stringify({ traceEvents }));
    writeFileSync(join(dir, `${side}_performance_profile.summary.txt`), 'Performance Profile Summary\n');
    return profilePath;
  }

  it('writes the chosen frames and appends their paths to both summaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-frames-'));
    const control = loadSide('homepage-desktop', 'control');
    const experiment = loadSide('homepage-desktop', 'experiment');
    const controlProfilePath = writeProfile(dir, 'control', control.jpegs, control.signed.map((f) => f.timeMs));
    const experimentProfilePath = writeProfile(dir, 'experiment', experiment.jpegs, experiment.signed.map((f) => f.timeMs));

    const pairs = writeReviewFrames({ controlProfilePath, experimentProfilePath, artifactsDir: dir });

    expect(pairs.length).toBeGreaterThanOrEqual(3);
    const controlSummary = readFileSync(join(dir, 'control_performance_profile.summary.txt'), 'utf-8');
    const experimentSummary = readFileSync(join(dir, 'experiment_performance_profile.summary.txt'), 'utf-8');
    expect(controlSummary.startsWith('Performance Profile Summary\n')).toBe(true);
    for (const summary of [controlSummary, experimentSummary]) {
      expect(summary).toContain('Frames to review');
      const paths = summary.match(/review_frames\/\S+/g) ?? [];
      expect(paths.length).toBe(pairs.length + pairs.filter((p) => p.kind === 'mismatch').length);
      for (const p of paths) expect(existsSync(join(dir, p))).toBe(true);
    }
    // Every mismatch got its triage diff written next to the frames.
    for (const pair of pairs.filter((p) => p.kind === 'mismatch')) {
      expect(controlSummary).toContain('control_experiment_diff_');
      expect(pair.changedPixels).toBeGreaterThanOrEqual(0);
    }
    // A written frame is the raw trace JPEG, byte for byte.
    const anyControl = pairs[0].controlIndex;
    expect(readFileSync(join(dir, REVIEW_FRAMES_DIR, `control_${control.signed[anyControl].timeMs.toFixed(2)}ms.jpg`)))
      .toEqual(control.jpegs[anyControl]);
  });
});
