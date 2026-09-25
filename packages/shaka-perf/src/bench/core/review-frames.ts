/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  matchFrames,
  pairUnmatchedFrames,
  signFrames,
  type FrameMatch,
  type FramePair,
} from './frame-matching';
import { decodeJpeg } from './decode-jpeg';
import { parseProfile, type Screenshot } from './timeline-comparison';

const { PNG } = require('pngjs') as typeof import('pngjs');

/**
 * The handful of frame pairs worth a reviewer's eyes. The timeline draws a
 * line per frame; a reviewer (or an agent reading the summary diff) needs a
 * few pictures, not hundreds. Matching frames are stood for by the first and
 * the last of them, mismatching ones by the first, the last, and the pair that
 * differs most when it stands well clear of those two.
 */
export interface ReviewPair {
  kind: 'match' | 'mismatch';
  /** Why this pair was kept. */
  role: 'first' | 'last' | 'largest';
  controlIndex: number;
  experimentIndex: number;
  /** Pixels that differ between the two frames at full size. */
  changedPixels: number;
}

/** A pair must differ this much more than the ends to earn a third picture. */
export const LARGEST_DIFF_FACTOR = 1.3;

export const REVIEW_FRAMES_DIR = 'review_frames';

export function selectReviewPairs(
  matches: readonly FrameMatch[],
  mismatches: readonly FramePair[],
  control: readonly Screenshot[],
  experiment: readonly Screenshot[],
): ReviewPair[] {
  const decoded = new Map<string, ReturnType<typeof decodeJpeg>>();
  const frame = (side: 'control' | 'experiment', index: number) => {
    const key = `${side}:${index}`;
    const cached = decoded.get(key);
    if (cached) return cached;
    const image = decodeJpeg((side === 'control' ? control : experiment)[index].snapshot);
    decoded.set(key, image);
    return image;
  };
  const changedPixels = (controlIndex: number, experimentIndex: number): number => {
    const a = frame('control', controlIndex);
    const b = frame('experiment', experimentIndex);
    if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
    let changed = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const moved = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (moved > 8) changed++;
    }
    return changed;
  };
  const pairOf = (kind: ReviewPair['kind'], role: ReviewPair['role'], controlIndex: number, experimentIndex: number): ReviewPair => ({
    kind,
    role,
    controlIndex,
    experimentIndex,
    changedPixels: changedPixels(controlIndex, experimentIndex),
  });

  // Every line of the timeline in order, each tagged with its kind. A line
  // across a one-sided gap ends between two frames; the nearest one is the
  // picture a reviewer would hold against the other side.
  const lines = [
    ...matches.map((m) => ({
      kind: 'match' as const,
      controlIndex: m.controlIndex,
      experimentIndex: m.experimentIndex,
    })),
    ...mismatches.map((p) => ({
      kind: 'mismatch' as const,
      controlIndex: Math.round(p.controlIndex),
      experimentIndex: Math.round(p.experimentIndex),
    })),
  ].sort((a, b) => a.controlIndex - b.controlIndex || a.experimentIndex - b.experimentIndex);

  // A stripe is a run of neighbouring lines of the same kind - one stretch
  // where the runs agree, or one stretch where they part. Each stripe gets its
  // own pictures, so a reviewer sees every place the two runs diverged rather
  // than the first and last of the whole profile.
  const stripes: (typeof lines)[] = [];
  for (const line of lines) {
    const current = stripes[stripes.length - 1];
    if (current && current[0].kind === line.kind) current.push(line);
    else stripes.push([line]);
  }

  const pairs: ReviewPair[] = [];
  for (const stripe of stripes) {
    const kind = stripe[0].kind;
    const first = pairOf(kind, 'first', stripe[0].controlIndex, stripe[0].experimentIndex);
    pairs.push(first);
    const end = stripe[stripe.length - 1];
    const last = stripe.length > 1
      ? pairOf(kind, 'last', end.controlIndex, end.experimentIndex)
      : undefined;
    if (last) pairs.push(last);
    if (kind !== 'mismatch' || stripe.length <= 2) continue;

    let largest = first;
    for (const line of stripe) {
      const candidate = pairOf(kind, 'largest', line.controlIndex, line.experimentIndex);
      if (candidate.changedPixels > largest.changedPixels) largest = candidate;
    }
    const ends = Math.max(first.changedPixels, last?.changedPixels ?? 0);
    const isEnd = largest.controlIndex === first.controlIndex
      || (last != null && largest.controlIndex === last.controlIndex);
    if (!isEnd && largest.changedPixels >= ends * LARGEST_DIFF_FACTOR) {
      pairs.push({ ...largest, role: 'largest' });
    }
  }

  return pairs.sort((a, b) => a.controlIndex - b.controlIndex || a.experimentIndex - b.experimentIndex);
}

/** The control-vs-experiment diff a reviewer opens to triage a mismatch. */
export function reviewDiffFilename(controlTimeMs: number, experimentTimeMs: number): string {
  return `control_experiment_diff_${controlTimeMs.toFixed(2)}ms_${experimentTimeMs.toFixed(2)}ms.png`;
}

/** Red where the two frames disagree, over a pale ghost of the experiment. */
function writeDiffImage(controlJpeg: Buffer, experimentJpeg: Buffer, outputPath: string): void {
  const a = decodeJpeg(controlJpeg);
  const b = decodeJpeg(experimentJpeg);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (image: typeof a) => (y * image.width + x) * 4;
      const ai = at(a);
      const bi = at(b);
      const moved = Math.max(
        Math.abs(a.data[ai] - b.data[bi]),
        Math.abs(a.data[ai + 1] - b.data[bi + 1]),
        Math.abs(a.data[ai + 2] - b.data[bi + 2]),
      );
      const out = (y * width + x) * 4;
      if (moved > 8) {
        png.data[out] = 220;
        png.data[out + 1] = 38;
        png.data[out + 2] = 38;
      } else {
        const faded = 255 - (255 - b.data[bi + 1]) * 0.15;
        png.data[out] = faded;
        png.data[out + 1] = faded;
        png.data[out + 2] = faded;
      }
      png.data[out + 3] = 255;
    }
  }
  writeFileSync(outputPath, PNG.sync.write(png));
}

export function reviewFrameFilename(side: 'control' | 'experiment', timeMs: number): string {
  return `${side}_${timeMs.toFixed(2)}ms.jpg`;
}

/**
 * The lines appended to one side's profile summary. Each side lists its own
 * frame of every pair, in the same order and with the same wording, so the
 * summary diff pairs the two paths on facing `-`/`+` lines.
 */
export function reviewFramesSummarySection(
  side: 'control' | 'experiment',
  pairs: readonly ReviewPair[],
  control: readonly Screenshot[],
  experiment: readonly Screenshot[],
  endsMatch: boolean,
): string {
  const lines = [
    '',
    'Frames to review. The timeline is a run of stripes - a stretch where the two runs agree, then a stretch where they part, and so on. Each stripe is stood for by its first and last pair, and a stripe of mismatches also by the pair that differs most when it stands well clear of the ends of that stripe. LOOK at these images before drawing any conclusion about what the two sides rendered: the numbers above cannot tell you what changed on screen. Each mismatch also names a ready-made control-vs-experiment diff, red where the two disagree:',
  ];
  if (!endsMatch) {
    lines.push(`  WARNING (${side}): the last frame is different. Either the test is unstable or the content has changed (both making perf-comparison unfair). Consider re-launching the low-noise perf-test.`);
  }
  for (const pair of pairs) {
    const frames = side === 'control' ? control : experiment;
    const index = side === 'control' ? pair.controlIndex : pair.experimentIndex;
    const what = `${pair.kind} (${pair.role})`;
    const changed = `${pair.changedPixels} px differ`;
    const triage = pair.kind === 'mismatch'
      ? `  triage diff: ${REVIEW_FRAMES_DIR}/${reviewDiffFilename(control[pair.controlIndex].timeMs, experiment[pair.experimentIndex].timeMs)}`
      : '';
    lines.push(`  ${what.padEnd(20)}  ${changed.padEnd(18)}  ${REVIEW_FRAMES_DIR}/${reviewFrameFilename(side, frames[index].timeMs)}${triage}`);
  }
  return lines.join('\n') + '\n';
}

export interface WriteReviewFramesOptions {
  controlProfilePath: string;
  experimentProfilePath: string;
  /** Where `review_frames/` goes and where the two summary files live. */
  artifactsDir: string;
}

/**
 * Write the review pairs' frames to `<artifactsDir>/review_frames/` and list
 * them at the end of each side's `*_performance_profile.summary.txt`.
 * Must run before the summaries are diffed.
 */
export function writeReviewFrames(options: WriteReviewFramesOptions): ReviewPair[] {
  const control = parseProfile(options.controlProfilePath);
  const experiment = parseProfile(options.experimentProfilePath);
  const { matches } = matchFrames(signFrames(control.screenshots), signFrames(experiment.screenshots));
  const mismatches = pairUnmatchedFrames(matches, control.screenshots.length, experiment.screenshots.length);
  const pairs = selectReviewPairs(matches, mismatches, control.screenshots, experiment.screenshots);
  if (pairs.length === 0) return pairs;

  const framesDir = path.join(options.artifactsDir, REVIEW_FRAMES_DIR);
  mkdirSync(framesDir, { recursive: true });
  const sides = [
    { side: 'control' as const, profile: control, indices: pairs.map((p) => p.controlIndex) },
    { side: 'experiment' as const, profile: experiment, indices: pairs.map((p) => p.experimentIndex) },
  ];
  for (const { side, profile, indices } of sides) {
    for (const index of new Set(indices)) {
      const frame = profile.screenshots[index];
      writeFileSync(path.join(framesDir, reviewFrameFilename(side, frame.timeMs)), frame.snapshot);
    }
  }
  for (const pair of pairs) {
    if (pair.kind !== 'mismatch') continue;
    const controlFrame = control.screenshots[pair.controlIndex];
    const experimentFrame = experiment.screenshots[pair.experimentIndex];
    writeDiffImage(
      controlFrame.snapshot,
      experimentFrame.snapshot,
      path.join(framesDir, reviewDiffFilename(controlFrame.timeMs, experimentFrame.timeMs)),
    );
  }
  // Both runs ending on the same picture is the baseline a perf comparison
  // rests on; when they do not, the summary says so rather than leaving a
  // reader to infer it from the last pair.
  const endsMatch = matches.some((m) => (
    m.controlIndex === control.screenshots.length - 1
    && m.experimentIndex === experiment.screenshots.length - 1
  ));
  for (const { side } of sides) {
    const summaryPath = path.join(options.artifactsDir, `${side}_performance_profile.summary.txt`);
    if (existsSync(summaryPath)) {
      appendFileSync(
        summaryPath,
        reviewFramesSummarySection(side, pairs, control.screenshots, experiment.screenshots, endsMatch),
      );
    }
  }
  return pairs;
}
