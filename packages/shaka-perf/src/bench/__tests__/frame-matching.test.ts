/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  frameSignature,
  matchFrames,
  pairUnmatchedFrames,
  SAME_STATE_MAX_DISTANCE,
  SIGNATURE_DIM,
  signatureDistance,
  signFrames,
  type FrameMatch,
  type SignedFrame,
} from '../core/frame-matching';

const jpeg = require('jpeg-js') as {
  encode(raw: { data: Buffer; width: number; height: number }, quality?: number): { data: Buffer };
};

// Fixtures are real trace screenshots from two compare runs, re-encoded
// narrow enough to commit. See frame-fixtures/README.md.
const FIXTURES = join(__dirname, 'frame-fixtures');

interface Fixture {
  control: SignedFrame[];
  experiment: SignedFrame[];
}

function loadFixture(name: string): Fixture {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, name, 'frames.json'), 'utf-8')) as {
    control: number[];
    experiment: number[];
  };
  const side = (which: 'control' | 'experiment'): SignedFrame[] => {
    const dir = join(FIXTURES, name, which);
    const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
    return files.map((file, i) => ({
      timeMs: manifest[which][i],
      signature: frameSignature(readFileSync(join(dir, file))),
    }));
  };
  return { control: side('control'), experiment: side('experiment') };
}

function pairs(matches: readonly FrameMatch[]): string[] {
  return matches.map((m) => `${m.controlIndex}->${m.experimentIndex}`);
}

function expectNoCrossing(matches: readonly FrameMatch[]): void {
  for (let i = 1; i < matches.length; i++) {
    expect(matches[i].controlIndex).toBeGreaterThan(matches[i - 1].controlIndex);
    expect(matches[i].experimentIndex).toBeGreaterThan(matches[i - 1].experimentIndex);
  }
}

/** A synthetic frame whose picture is decided by `shade`. */
function frame(timeMs: number, shade: number): SignedFrame {
  const w = 8;
  const h = 8;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // A shade-dependent pattern, so different shades are far apart rather
    // than a uniform ramp that could land inside the same-state threshold.
    const v = (i * 7 + shade * 53) % 256;
    data[o] = v;
    data[o + 1] = (v + shade * 31) % 256;
    data[o + 2] = (v + shade * 97) % 256;
    data[o + 3] = 255;
  }
  const snapshot = Buffer.from(jpeg.encode({ data, width: w, height: h }, 95).data);
  return { timeMs, signature: frameSignature(snapshot) };
}

describe('frameSignature and signatureDistance', () => {
  const desktopNative = readFileSync(join(FIXTURES, 'native', 'desktop-native.jpg'));
  const phoneNative = readFileSync(join(FIXTURES, 'native', 'phone-native.jpg'));

  it('reduces a real trace screenshot to a fixed grid', () => {
    const signature = frameSignature(desktopNative);
    expect(signature.dim).toBe(SIGNATURE_DIM);
    expect(signature.gray).toHaveLength(SIGNATURE_DIM * SIGNATURE_DIM);
    expect(frameSignature(desktopNative).gray).toEqual(signature.gray);
  });

  it('compares frames captured at different resolutions', () => {
    // 250x156 against 140x248: the grid normalises both, so this is a
    // distance rather than a throw.
    const distance = signatureDistance(frameSignature(desktopNative), frameSignature(phoneNative));
    expect(distance).toBeGreaterThanOrEqual(0);
    expect(distance).toBeLessThanOrEqual(1);
  });

  it('is zero for a frame against itself and symmetric', () => {
    const a = frameSignature(desktopNative);
    const b = frameSignature(phoneNative);
    expect(signatureDistance(a, a)).toBe(0);
    expect(signatureDistance(a, b)).toBe(signatureDistance(b, a));
  });

  it('scales a single-sample difference by the grid size', () => {
    const a = { dim: 2, gray: new Uint8Array([0, 0, 0, 0]) };
    const b = { dim: 2, gray: new Uint8Array([255, 0, 0, 0]) };
    expect(signatureDistance(a, b)).toBeCloseTo(1 / 4, 10);
  });

  it('refuses to compare different grid sizes', () => {
    expect(() => signatureDistance(frameSignature(desktopNative), frameSignature(desktopNative, 16)))
      .toThrow('different sizes');
  });
});

describe('matchFrames on real runs', () => {
  it('combs the desktop run, skipping frames with no counterpart', () => {
    const { control, experiment } = loadFixture('homepage-desktop');
    expect(control).toHaveLength(16);
    expect(experiment).toHaveLength(13);

    const { matches, offsetMs } = matchFrames(control, experiment);

    expect(pairs(matches)).toEqual([
      '0->0', '1->1', '2->2', '4->3', '5->4', '6->5', '7->6', '8->7', '9->8', '10->9', '11->10',
    ]);
    expectNoCrossing(matches);
    expect(matches.every((m) => m.distance <= SAME_STATE_MAX_DISTANCE)).toBe(true);
    // Control frame 3 and the tail 12-15 have no counterpart, as do the last
    // two experiment frames.
    expect(Math.round(offsetMs)).toBe(18);
  });

  it('combs the phone run, where every frame has a counterpart', () => {
    const { control, experiment } = loadFixture('homepage-phone');
    const { matches, offsetMs } = matchFrames(control, experiment);

    expect(matches).toHaveLength(18);
    expect(pairs(matches)).toEqual(control.map((_, i) => `${i}->${i}`));
    expectNoCrossing(matches);
    // The experiment run trails the control one by a steady 50ms. The opening
    // pair is the exception: both runs show a blank page at 0ms, so those two
    // frames are simultaneous rather than 50ms apart.
    expect(Math.round(offsetMs)).toBe(-50);
    expect(Math.round(matches[0].deltaMs)).toBe(-1);
    expect(matches.slice(1).every((m) => Math.abs(m.deltaMs - offsetMs) < 5)).toBe(true);
  });

  it('leaves one control frame without an arrow when a counterpart disappears', () => {
    const { control, experiment } = loadFixture('homepage-phone');
    const withoutFifth = experiment.filter((_, i) => i !== 5);

    const { matches } = matchFrames(control, withoutFifth);

    // Every experiment frame still finds a partner; one control frame is the
    // odd one out. Which one is not fixed: these frames are near-identical,
    // so the comb absorbs the hole wherever the deltas stay closest to the
    // run's offset.
    expect(matches).toHaveLength(withoutFifth.length);
    expect(new Set(matches.map((m) => m.experimentIndex)).size).toBe(withoutFifth.length);
    expectNoCrossing(matches);
    expect(pairs(matches)).toEqual([
      '0->0', '1->1', '2->2', '3->3', '4->4', '5->5', '6->6', '7->7', '8->8',
      '9->9', '10->10', '11->11', '12->12', '13->13', '14->14', '15->15', '17->16',
    ]);
  });

  it('keeps the same pairs when one side stalls halfway through', () => {
    const { control, experiment } = loadFixture('homepage-phone');
    const stalled = experiment.map((f, i) => (i >= 9 ? { ...f, timeMs: f.timeMs + 800 } : f));

    const { matches } = matchFrames(control, stalled);

    expect(pairs(matches)).toEqual(pairs(matchFrames(control, experiment).matches));
    expectNoCrossing(matches);
    // The stall shows up as the delta, not as a lost match.
    expect(matches[matches.length - 1].deltaMs).toBeGreaterThan(700);
  });

  it('tells a blank frame from a rendered one', () => {
    const { control } = loadFixture('homepage-phone');
    const distance = signatureDistance(control[0].signature, control[control.length - 1].signature);
    expect(distance).toBeGreaterThan(SAME_STATE_MAX_DISTANCE * 10);
  });

  it('pairs only the blank openings of two unrelated runs', () => {
    const desktop = loadFixture('homepage-desktop');
    const phone = loadFixture('homepage-phone');

    const { matches } = matchFrames(desktop.control, phone.experiment);

    // Both runs open on a blank page, and those frames genuinely are the same
    // picture, so they pair. What must NOT pair is the rendered content: the
    // two runs end on different pages.
    expectNoCrossing(matches);
    expect(matches.some((m) => m.controlIndex === desktop.control.length - 1)).toBe(false);
    expect(matches.some((m) => m.experimentIndex === phone.experiment.length - 1)).toBe(false);
  });
});

describe('matchFrames tie-breaking and degenerate input', () => {
  it('pairs identical frames in order rather than drifting sideways', () => {
    const control = [0, 100, 200, 300, 400].map((t) => frame(t, 1));
    const experiment = [50, 150, 250, 350, 450].map((t) => frame(t, 1));

    const { matches, offsetMs } = matchFrames(control, experiment);

    expect(pairs(matches)).toEqual(['0->0', '1->1', '2->2', '3->3', '4->4']);
    expect(offsetMs).toBe(50);
  });

  it('keeps a regular comb when one side has extra identical frames', () => {
    const control = [0, 100, 200, 300, 400].map((t) => frame(t, 1));
    const experiment = [-200, -100, 100, 200, 300, 400, 500].map((t) => frame(t, 1));

    const { matches, offsetMs } = matchFrames(control, experiment);

    // Nothing distinguishes these frames by picture, so the comb is chosen by
    // timing alone: every control frame gets a partner, the extras are left
    // out, and the deltas stay tight around the run's offset instead of
    // wandering.
    expect(matches).toHaveLength(control.length);
    expectNoCrossing(matches);
    expect(matches.every((m) => Math.abs(m.deltaMs - offsetMs) <= 100)).toBe(true);
  });

  it('is deterministic across runs', () => {
    const { control, experiment } = loadFixture('homepage-desktop');
    const first = matchFrames(control, experiment);
    const second = matchFrames(control, experiment);
    expect(second).toEqual(first);
  });

  it('handles an empty side', () => {
    const { control } = loadFixture('homepage-desktop');
    expect(matchFrames(control, [])).toEqual({ matches: [], offsetMs: 0 });
    expect(matchFrames([], control)).toEqual({ matches: [], offsetMs: 0 });
    expect(matchFrames([], [])).toEqual({ matches: [], offsetMs: 0 });
  });

  it('matches at most the shorter side', () => {
    const control = [0, 100, 200, 300, 400, 500].map((t, i) => frame(t, i));
    const experiment = [10, 210].map((t) => frame(t, 0));

    const { matches } = matchFrames(control, experiment);

    expect(matches.length).toBeLessThanOrEqual(2);
    expectNoCrossing(matches);
  });

  it('signs a run of screenshots in one call', () => {
    const snapshot = readFileSync(join(FIXTURES, 'native', 'desktop-native.jpg'));
    const signed = signFrames([{ timeMs: 5, snapshot }, { timeMs: 9, snapshot }]);
    expect(signed.map((s) => s.timeMs)).toEqual([5, 9]);
    expect(signatureDistance(signed[0].signature, signed[1].signature)).toBe(0);
  });
});

describe('pairUnmatchedFrames', () => {
  const match = (controlIndex: number, experimentIndex: number): FrameMatch =>
    ({ controlIndex, experimentIndex, distance: 0, deltaMs: 0 });

  it('spreads the lines over the longer run instead of crowding them', () => {
    // Between the matches at 0 and 10/4 the control ran 9 frames where the
    // experiment ran 3: the three lines land on the first, middle and last.
    const pairs = pairUnmatchedFrames([match(0, 0), match(10, 4)], 11, 5);

    expect(pairs).toEqual([
      { controlIndex: 1, experimentIndex: 1 },
      { controlIndex: 5, experimentIndex: 2 },
      { controlIndex: 9, experimentIndex: 3 },
    ]);
  });

  it('meets the middle when the shorter run is a single frame', () => {
    const pairs = pairUnmatchedFrames([match(0, 0), match(6, 2)], 7, 3);

    expect(pairs).toEqual([{ controlIndex: 3, experimentIndex: 1 }]);
  });

  it('treats the head and the tail as gaps too', () => {
    // Head: control 0,1 against experiment 0 — one line, on the head's middle.
    // Tail: control 3,4 against experiment 2,3 — a line each.
    const pairs = pairUnmatchedFrames([match(2, 1)], 5, 4);

    expect(pairs).toEqual([
      { controlIndex: 0, experimentIndex: 0 },
      { controlIndex: 3, experimentIndex: 2 },
      { controlIndex: 4, experimentIndex: 3 },
    ]);
  });

  it('spans the whole of both runs when nothing matched', () => {
    expect(pairUnmatchedFrames([], 3, 5)).toEqual([
      { controlIndex: 0, experimentIndex: 0 },
      { controlIndex: 1, experimentIndex: 2 },
      { controlIndex: 2, experimentIndex: 4 },
    ]);
  });

  it('never crosses a match or another pair on real frames', () => {
    const { control, experiment } = loadFixture('homepage-desktop');
    const { matches } = matchFrames(control, experiment);
    const lines = [
      ...matches.map((m) => ({ controlIndex: m.controlIndex, experimentIndex: m.experimentIndex })),
      ...pairUnmatchedFrames(matches, control.length, experiment.length),
    ].sort((a, b) => a.controlIndex - b.controlIndex);

    expect(lines.length).toBeGreaterThan(matches.length);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].controlIndex).toBeGreaterThan(lines[i - 1].controlIndex);
      expect(lines[i].experimentIndex).toBeGreaterThan(lines[i - 1].experimentIndex);
    }
  });
});
