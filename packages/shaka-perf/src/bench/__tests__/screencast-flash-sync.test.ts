/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildFlashClockMap,
  classifyFlashText,
  findFlashMarksInTrace,
  findRuns,
  syncVideoToTraceViaFlashMarkers,
  yellowFraction,
} from '../core/screencast-flash-sync';
import type { Screenshot } from '../core/timeline-comparison';

const jpeg = require('jpeg-js') as {
  encode(raw: { data: Buffer; width: number; height: number }, quality?: number): { data: Buffer };
};

const W = 24;
const H = 16;
function frame(r: number, g: number, b: number, timeMs: number, redBand = false): Screenshot {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBand = redBand && y >= 6 && y < 10;
      data[i] = inBand ? 255 : r;
      data[i + 1] = inBand ? 0 : g;
      data[i + 2] = inBand ? 0 : b;
      data[i + 3] = 255;
    }
  }
  const snapshot = Buffer.from(jpeg.encode({ data, width: W, height: H }, 95).data);
  return { timeMs, dataUri: '', snapshot };
}
const gray = (t: number) => frame(120, 120, 120, t);
const white = (t: number) => frame(250, 250, 250, t);
const flash = (t: number) => frame(255, 255, 0, t, true);
const mark = (label: string, timeMs: number) => ({ timeMs, label, category: 'user-timing' });

describe('flash sync building blocks', () => {
  it('measures yellow coverage and groups candidate runs', () => {
    const decoded = (s: Screenshot) => (require('jpeg-js') as any).decode(s.snapshot, { useTArray: true });
    expect(yellowFraction(decoded(flash(0)))).toBeGreaterThan(0.6);
    expect(yellowFraction(decoded(gray(0)))).toBe(0);
    expect(findRuns([false, true, true, false, true])).toEqual([
      { firstIdx: 1, lastIdx: 2 },
      { firstIdx: 4, lastIdx: 4 },
    ]);
  });

  it('classifies OCR text leniently and reads marks from the trace', () => {
    expect(classifyFlashText('SHAKA-PERF START')).toBe('start');
    expect(classifyFlashText('SHAKA PERF STRT')).toBe('start');
    expect(classifyFlashText('SHAKA-PERF END')).toBe('end');
    expect(classifyFlashText('SHAKA-PERF EN0')).toBe('end');
    expect(classifyFlashText('HOMEPAGE')).toBeNull();
    expect(findFlashMarksInTrace([mark('shaka-perf-start', 900), mark('other', 1), mark('shaka-perf-end', 3000)]))
      .toEqual({ startMs: 900, endMs: 3000 });
    expect(() => findFlashMarksInTrace([mark('shaka-perf-start', 900)])).toThrow('no `shaka-perf-end` mark');
  });

  it('fits the clock map through both markers and rejects a degenerate span', () => {
    const toTraceMs = buildFlashClockMap({ startMs: 100, endMs: 1100 }, { startMs: 400, endMs: 1450 });
    expect(toTraceMs(100)).toBe(400);
    expect(toTraceMs(1100)).toBe(1450);
    expect(toTraceMs(600)).toBe(925);
    expect(() => buildFlashClockMap({ startMs: 100, endMs: 100 }, { startMs: 400, endMs: 1450 })).toThrow('non-positive');
  });
});

describe('syncVideoToTraceViaFlashMarkers', () => {
  const ocrByYellow = async (buf: Buffer): Promise<string> => {
    // Flash frames encode to identical bytes, so key on the buffer identity
    // (the sync hands over the frame's own snapshot buffer).
    const idx = frames.findIndex((f) => f.snapshot === buf);
    return idx <= 3 ? 'SHAKA-PERF START' : 'SHAKA-PERF END';
  };
  // video clock: blank, page, START flash x2, page states..., END flash x2, tail
  const frames: Screenshot[] = [
    white(0), gray(100), flash(200), flash(216), gray(300), white(500), gray(700), flash(900), flash(916), gray(1000),
  ];

  it('remaps frames onto the trace clock through both markers and drops the flash frames', async () => {
    const events = [mark('shaka-perf-start', 1200), mark('shaka-perf-end', 1970)];
    const result = await syncVideoToTraceViaFlashMarkers(events, frames, { ocr: ocrByYellow, log: () => {} });

    // video 200->1200, video 900->1970: rate 1.1
    expect(result.rawSyncedScreenshots.map((s) => Math.round(s.timeMs))).toEqual([980, 1090, 1310, 1530, 1750, 2080]);
    expect(result.stats.inputFrameCount).toBe(10);
    expect(result.screenshots.length).toBeGreaterThan(1);
    expect(result.screenshots.every((s) => !frames.slice(2, 4).concat(frames.slice(7, 9)).some((f) => f.snapshot === s.snapshot))).toBe(true);
  });

  it.each([1, 2, 4])('preserves original marker times with a %i-frame cap', async (limitVideoFramesCount) => {
    const result = await syncVideoToTraceViaFlashMarkers(
      [mark('shaka-perf-start', 1200), mark('shaka-perf-end', 1970)],
      frames,
      { limitVideoFramesCount, ocr: ocrByYellow, log: () => {} },
    );

    // A cap of 2 discards both flashes; a cap of 4 retains only the
    // START flash's second frame. Neither may change the clock map.
    const expectedTimes = limitVideoFramesCount === 1 ? [980]
      : limitVideoFramesCount === 2 ? [980, 2080] : [980, 1750, 2080];
    expect(result.rawSyncedScreenshots.map((s) => Math.round(s.timeMs))).toEqual(expectedTimes);
    expect(result.stats.frameCapDropped).toBe(frames.length - limitVideoFramesCount);
    expect(result.stats.inputFrameCount).toBe(limitVideoFramesCount);
    expect(result.stats.removedFrameCount + result.stats.keptFrameCount).toBe(limitVideoFramesCount);
  });

  it('throws when a marker is missing in the trace or in the video', async () => {
    await expect(syncVideoToTraceViaFlashMarkers([mark('shaka-perf-start', 1200)], frames, { ocr: ocrByYellow, log: () => {} }))
      .rejects.toThrow('no `shaka-perf-end` mark');
    const both = [mark('shaka-perf-start', 1), mark('shaka-perf-end', 2)];
    await expect(syncVideoToTraceViaFlashMarkers(both, [gray(0), gray(16)], { ocr: ocrByYellow, log: () => {} }))
      .rejects.toThrow('no SHAKA-PERF START flash');
    await expect(syncVideoToTraceViaFlashMarkers(both, frames.slice(0, 6), { ocr: ocrByYellow, log: () => {} }))
      .rejects.toThrow('no SHAKA-PERF END flash');
  });
});
