/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { decodeJpeg } from './decode-jpeg';

/**
 * Match the control run's screenshots against the experiment run's: which
 * frame on one side shows the same page state as a frame on the other, and
 * how much later it arrived. The timeline comparison draws one arrow per
 * match, so the matching must be monotonic (arrows cannot cross) while
 * leaving frames with no counterpart unmatched.
 *
 * Two facts about real runs shape this:
 *
 * - The same state is usually PIXEL-IDENTICAL on both sides (same app, two
 *   builds), while genuinely different states sit far away. Measured over
 *   real profiles: same state 0.000, different state around 0.065, with
 *   nothing in between. So "same state" is a strict threshold, not a ranking.
 * - Because so many distances are 0, image distance alone cannot pick a
 *   partner; nearly every frame ties with several candidates. Order and
 *   timing have to break those ties, or the arrows come out as an arbitrary
 *   staircase instead of a comb.
 */

/** Side of the grid each signature is reduced to. 32x32 greyscale is 1 KB per
 *  frame. Finer grids were measured on real runs and do not reduce the
 *  ambiguity, because the ties are real identical pictures, not lost detail. */
export const SIGNATURE_DIM = 32;

/** Distance below which two frames count as the same page state. Sits in the
 *  empty band between the measured 0.000 (same state) and 0.065 (different
 *  state), so it separates them without ranking near-misses. */
export const SAME_STATE_MAX_DISTANCE = 0.02;

/** How much of a grid cell's brightness must move before the cell counts as
 *  repainted, out of 255. Below this is JPEG and antialiasing noise. */
const CELL_CHANGED_DELTA = 8;

/** Share of the grid that may be repainted while two frames still count as the
 *  same page state. The mean distance alone lets a real change through when it
 *  is faint but wide - pale skeleton blocks giving way to text measured 0.017
 *  across two real runs, under the distance cut, though a tenth of the pixels
 *  had changed. Counting cells separates those: on the same runs a different
 *  state moved at least 3% of the grid. The cut sits well below that, which on
 *  real runs also drops pairs differing only in a row of content, and leaves
 *  every match of the test fixtures standing. */
export const SAME_STATE_MAX_CHANGED_CELLS = 0.01;

// Weights of the two tie-breakers. Both together stay below the reward for
// making a match at all, so the search never trades a match away to improve
// regularity or image distance: matches first, regular comb second, closest
// picture third.
const MATCH_REWARD = 1;
const DISTANCE_WEIGHT = 0.2;
const OFFSET_WEIGHT = 0.5;

// How far a pair's time delta may stray from the run's typical delta before
// its penalty saturates. Wide enough that a genuinely slower side still
// matches, tight enough to order a field of identical frames.
const OFFSET_DEVIATION_SCALE_MS = 250;

// Scores accumulate as integers so the result never depends on the host's
// floating-point summation order.
const SCORE_SCALE = 1e6;

export interface FrameSignature {
  dim: number;
  /** `dim * dim` greyscale samples, row-major. */
  gray: Uint8Array;
}

export interface SignedFrame {
  timeMs: number;
  signature: FrameSignature;
}

export interface FrameMatch {
  controlIndex: number;
  experimentIndex: number;
  distance: number;
  /** Experiment time minus control time. Positive means the experiment
   *  reached this state later. */
  deltaMs: number;
}

/** Two frames joined by a line in the timeline's middle column. */
export interface FramePair {
  controlIndex: number;
  experimentIndex: number;
}

export interface FrameMatchResult {
  matches: FrameMatch[];
  /** The run's typical delta, the median over the matches. */
  offsetMs: number;
}

export interface SignatureDifference {
  /** Mean absolute difference, 0 (identical) to 1. */
  distance: number;
  /** Share of grid cells whose brightness moved more than a noise floor. */
  changedCells: number;
}

export interface FrameMatchOptions {
  maxDistance?: number;
  maxChangedCells?: number;
  /** Refinement passes re-estimating the typical delta. */
  offsetPasses?: number;
}

/**
 * Reduce a frame to a small greyscale grid by box-averaging the decoded
 * pixels. Deliberately not sharp: keeping this synchronous keeps the whole
 * timeline generator synchronous, and a box filter was measured against
 * sharp's resize on real frames with identical same-state verdicts.
 *
 * The grid is a fixed size regardless of the source, so the two sides compare
 * even when the trace captured them at different resolutions.
 */
export function frameSignature(jpegBuf: Buffer, dim: number = SIGNATURE_DIM): FrameSignature {
  const { width, height, data } = decodeJpeg(jpegBuf);
  const gray = new Uint8Array(dim * dim);
  if (width === 0 || height === 0) return { dim, gray };
  for (let gy = 0; gy < dim; gy++) {
    const y0 = Math.floor((gy * height) / dim);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / dim));
    for (let gx = 0; gx < dim; gx++) {
      const x0 = Math.floor((gx * width) / dim);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / dim));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
        }
      }
      gray[gy * dim + gx] = Math.round(sum / count);
    }
  }
  return { dim, gray };
}

/** How two signatures differ: on average, and over how much of the grid. */
export function signatureDifference(a: FrameSignature, b: FrameSignature): SignatureDifference {
  if (a.dim !== b.dim) {
    throw new Error(`shaka-perf: cannot compare frame signatures of different sizes (${a.dim} vs ${b.dim})`);
  }
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < a.gray.length; i++) {
    const delta = Math.abs(a.gray[i] - b.gray[i]);
    sum += delta;
    if (delta > CELL_CHANGED_DELTA) changed++;
  }
  return { distance: sum / (a.gray.length * 255), changedCells: changed / a.gray.length };
}

/** Mean absolute difference of two signatures, 0 (identical) to 1. */
export function signatureDistance(a: FrameSignature, b: FrameSignature): number {
  return signatureDifference(a, b).distance;
}

/** Signatures for a run's frames, in time order. */
export function signFrames(
  frames: readonly { timeMs: number; snapshot: Buffer }[],
  dim: number = SIGNATURE_DIM,
): SignedFrame[] {
  return frames.map((f) => ({ timeMs: f.timeMs, signature: frameSignature(f.snapshot, dim) }));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * One pass of the alignment, with `offsetRefMs` as the delta a well-behaved
 * pair is expected to have.
 *
 * Needleman-Wunsch with free skips: each cell either pairs the two frames,
 * skips the control one, or skips the experiment one. Walking back from the
 * last cell therefore yields pairs whose indices both increase, which is
 * exactly "arrows never cross"; the skipped frames are the gaps in the comb.
 */
function alignOnce(
  control: readonly SignedFrame[],
  experiment: readonly SignedFrame[],
  maxDistance: number,
  maxChangedCells: number,
  offsetRefMs: number,
): FrameMatch[] {
  const n = control.length;
  const m = experiment.length;
  // Scores of the best alignment of the first i control and j experiment
  // frames, and which move produced it.
  const score = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  const MOVE_SKIP_CONTROL = 1;
  const MOVE_SKIP_EXPERIMENT = 2;
  const MOVE_MATCH = 3;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = score[i - 1][j];
      let chosen = MOVE_SKIP_CONTROL;
      if (score[i][j - 1] > best) {
        best = score[i][j - 1];
        chosen = MOVE_SKIP_EXPERIMENT;
      }
      const { distance, changedCells } =
        signatureDifference(control[i - 1].signature, experiment[j - 1].signature);
      if (distance <= maxDistance && changedCells <= maxChangedCells) {
        const deltaMs = experiment[j - 1].timeMs - control[i - 1].timeMs;
        const offsetDeviation = Math.min(1, Math.abs(deltaMs - offsetRefMs) / OFFSET_DEVIATION_SCALE_MS);
        const gain = MATCH_REWARD
          - DISTANCE_WEIGHT * (distance / maxDistance)
          - OFFSET_WEIGHT * offsetDeviation;
        const matched = score[i - 1][j - 1] + Math.round(gain * SCORE_SCALE);
        // `>=` prefers the diagonal on a tie, which keeps runs of identical
        // frames paired in order instead of drifting sideways.
        if (matched >= best) {
          best = matched;
          chosen = MOVE_MATCH;
        }
      }
      score[i][j] = best;
      move[i][j] = chosen;
    }
  }

  const matches: FrameMatch[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const chosen = move[i][j];
    if (chosen === MOVE_MATCH) {
      matches.push({
        controlIndex: i - 1,
        experimentIndex: j - 1,
        distance: signatureDistance(control[i - 1].signature, experiment[j - 1].signature),
        deltaMs: experiment[j - 1].timeMs - control[i - 1].timeMs,
      });
      i--;
      j--;
    } else if (chosen === MOVE_SKIP_CONTROL) {
      i--;
    } else {
      j--;
    }
  }
  matches.reverse();
  return matches;
}

/**
 * Pair the two runs' frames. Runs the alignment a few times, each time
 * re-estimating the run's typical delta from the previous result: the first
 * pass has no idea how far apart the runs are, and without that estimate a
 * field of identical frames has nothing to order it. Stops as soon as the
 * estimate settles.
 */
export function matchFrames(
  control: readonly SignedFrame[],
  experiment: readonly SignedFrame[],
  opts: FrameMatchOptions = {},
): FrameMatchResult {
  const maxDistance = opts.maxDistance ?? SAME_STATE_MAX_DISTANCE;
  const maxChangedCells = opts.maxChangedCells ?? SAME_STATE_MAX_CHANGED_CELLS;
  const passes = opts.offsetPasses ?? 3;
  if (control.length === 0 || experiment.length === 0) return { matches: [], offsetMs: 0 };

  let offsetMs = 0;
  let matches = alignOnce(control, experiment, maxDistance, maxChangedCells, offsetMs);
  for (let pass = 1; pass < passes && matches.length > 0; pass++) {
    const nextOffset = median(matches.map((match) => match.deltaMs));
    if (nextOffset === offsetMs) break;
    offsetMs = nextOffset;
    matches = alignOnce(control, experiment, maxDistance, maxChangedCells, offsetMs);
  }
  return { matches, offsetMs: matches.length > 0 ? median(matches.map((match) => match.deltaMs)) : 0 };
}

/**
 * Pair the frames `matchFrames` left over. Between two consecutive matches
 * each side holds a run of frames with no counterpart; those runs are joined
 * in order, first with first. The shorter run runs out and the rest stay
 * unpaired. Both index sequences still only ever increase, so these pairs
 * cannot cross each other or the matches. The head before the first match and
 * the tail after the last one are treated as gaps too.
 */
export function pairUnmatchedFrames(
  matches: readonly FrameMatch[],
  controlCount: number,
  experimentCount: number,
): FramePair[] {
  const pairs: FramePair[] = [];
  let control = 0;
  let experiment = 0;
  const gapEnds = [...matches, { controlIndex: controlCount, experimentIndex: experimentCount }];
  for (const end of gapEnds) {
    const gap = Math.min(end.controlIndex - control, end.experimentIndex - experiment);
    for (let i = 0; i < gap; i++) {
      pairs.push({ controlIndex: control + i, experimentIndex: experiment + i });
    }
    control = end.controlIndex + 1;
    experiment = end.experimentIndex + 1;
  }
  return pairs;
}
