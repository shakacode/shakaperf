/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  bucketEventsToFrames,
  progressMaskDataUris,
  bucketPlacedInteractions,
  keepFramesAt,
  placeInteractions,
  copyPreviousFramesForAnnotations,
  parseProfile,
  profileFramesWithAnnotations,
  SHAKA_PERF_ANNOTATION_PREFIX,
  type ProfileData,
  type ProfileFrame,
  type Screenshot,
} from '../core/timeline-comparison';

const jpeg = require('jpeg-js') as {
  encode(raw: { data: Buffer; width: number; height: number }, quality?: number): { data: Buffer };
};

function jpegBuffer(r: number, g: number, b: number): Buffer {
  const data = Buffer.from([r, g, b, 255]);
  return Buffer.from(jpeg.encode({ data, width: 1, height: 1 }, 90).data);
}

// Test helper: build a minimal user-timing TimelineEvent. The literal
// `as const` on `category` narrows it to the union variant so the object
// is structurally assignable to `bucketEventsToFrames`'s parameter without
// the `as any` casts the test previously used.
const timing = (timeMs: number, label: string) =>
  ({ timeMs, label, category: 'user-timing' as const });

describe('annotated timeline frame preparation', () => {
  it('copies the previous screenshot when an annotation lands between kept frames', () => {
    const first = jpegBuffer(0, 0, 0);
    const second = jpegBuffer(255, 255, 255);
    const screenshots: Screenshot[] = [
      { timeMs: 10, dataUri: '', snapshot: first },
      { timeMs: 20, dataUri: '', snapshot: second },
    ];

    const result = copyPreviousFramesForAnnotations(screenshots, [{
      timeMs: 15,
      label: 'largestContentfulPaint::Candidate',
      category: 'paint',
      isLcpFinal: true,
    } as any], undefined);

    expect(result.copiedFrameCount).toBe(1);
    expect(result.screenshots.map((s) => s.timeMs)).toEqual([10, 15, 20]);
    expect(result.screenshots[1].snapshot).toBe(first);
    expect(result.screenshots[1].copiedForAnnotation).toBe(true);
  });

  it('keeps all prepared frames after annotation copy', () => {
    const snapshot = jpegBuffer(20, 20, 20);
    const profile: ProfileData = {
      screenshots: [
        { timeMs: 10, dataUri: '', snapshot },
        { timeMs: 15, dataUri: '', snapshot, copiedForAnnotation: true },
        { timeMs: 20, dataUri: '', snapshot },
      ],
      events: [],
      maxTimeMs: 20,
      baseOrigin: '',
    };

    const result = profileFramesWithAnnotations(profile, [
      [],
      [{ kind: 'lcp', label: 'LCP' }],
      [],
    ]);

    expect(result.frames.map((f) => f.timeMs)).toEqual([10, 15, 20]);
    expect(result.keptBuckets).toEqual([
      [],
      [{ kind: 'lcp', label: 'LCP' }],
      [],
    ]);
  });

  it('puts layout-shift annotations on copied annotation frames instead of the next visual frame', () => {
    const snapshot = jpegBuffer(20, 20, 20);
    const frames: ProfileFrame[] = [
      { timeMs: 10, snapshot, imgW: 0, imgH: 0 },
      { timeMs: 15, snapshot, imgW: 0, imgH: 0, copiedForAnnotation: true },
      { timeMs: 20, snapshot, imgW: 0, imgH: 0 },
    ];

    const buckets = bucketEventsToFrames(frames, [{
      timeMs: 15,
      label: 'LayoutShift',
      category: 'layout-shift',
      score: 0.1234,
      rects: [[1, 2, 3, 4]],
    } as any], undefined);

    expect(buckets[1]).toEqual([{
      kind: 'layout-shift',
      label: 'Layout Shift 0.123',
      rects: [[1, 2, 3, 4]],
    }]);
    expect(buckets[2]).toEqual([]);
  });

  it('extracts shaka-perf-annotation user-timing marks into test-annotation chips on the matching frame', () => {
    const snapshot = jpegBuffer(20, 20, 20);
    const frames: ProfileFrame[] = [
      { timeMs: 10, snapshot, imgW: 0, imgH: 0 },
      { timeMs: 15, snapshot, imgW: 0, imgH: 0, copiedForAnnotation: true },
      { timeMs: 20, snapshot, imgW: 0, imgH: 0 },
    ];

    const buckets = bucketEventsToFrames(frames, [
      // Sentinel-prefixed mark → annotation extracted, prefix stripped.
      timing(15, `${SHAKA_PERF_ANNOTATION_PREFIX}cart added`),
      // Page-internal user-timing mark with no sentinel → ignored, no chip.
      timing(18, 'react-render'),
    ], undefined);

    expect(buckets[0]).toEqual([]);
    expect(buckets[1]).toEqual([{ kind: 'test-annotation', label: 'cart added' }]);
    expect(buckets[2]).toEqual([]);
  });

  it('inserts a copied frame so a test annotation between visual frames lands on its own slot', () => {
    const first = jpegBuffer(0, 0, 0);
    const second = jpegBuffer(255, 255, 255);
    const screenshots: Screenshot[] = [
      { timeMs: 10, dataUri: '', snapshot: first },
      { timeMs: 20, dataUri: '', snapshot: second },
    ];

    const result = copyPreviousFramesForAnnotations(screenshots, [
      timing(15, `${SHAKA_PERF_ANNOTATION_PREFIX}checkout submit`),
    ], undefined);

    expect(result.copiedFrameCount).toBe(1);
    expect(result.screenshots.map((s) => s.timeMs)).toEqual([10, 15, 20]);
    expect(result.screenshots[1].copiedForAnnotation).toBe(true);
  });
});

describe('parseProfile user-timing measures vs marks', () => {
  const NAV = 1_000_000; // navigationStart ts, microseconds
  const at = (ms: number) => NAV + ms * 1000;

  function writeTrace(traceEvents: object[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'shaka-measure-'));
    const file = join(dir, 'trace.json');
    writeFileSync(file, JSON.stringify({ traceEvents }));
    return file;
  }

  it('pairs a measure begin/end into a single span and keeps boundary marks as points', () => {
    const file = writeTrace([
      { cat: 'blink.user_timing', name: 'navigationStart', ph: 'R', ts: NAV },
      { cat: 'blink.user_timing', name: 'popmenu-hydration-start', ph: 'I', ts: at(100) },
      { cat: 'blink.user_timing', name: 'popmenu-hydration', ph: 'b', ts: at(100), id: '0x1' },
      { cat: 'blink.user_timing', name: 'popmenu-hydration', ph: 'e', ts: at(180), id: '0x1' },
      { cat: 'blink.user_timing', name: 'popmenu-hydration-end', ph: 'I', ts: at(180) },
    ]);
    const events = parseProfile(file).events.filter(e => e.category === 'user-timing');

    const measure = events.find(e => e.label === 'popmenu-hydration');
    expect(measure).toMatchObject({ timeMs: 100, durationMs: 80 });

    // The boundary marks stay as instantaneous points (no duration).
    for (const name of ['popmenu-hydration-start', 'popmenu-hydration-end']) {
      const mark = events.find(e => e.label === name);
      expect(mark).toBeDefined();
      expect(mark!.durationMs).toBeUndefined();
    }
  });

  it('reads a measure emitted as a single complete (X) event with dur', () => {
    const file = writeTrace([
      { cat: 'blink.user_timing', name: 'navigationStart', ph: 'R', ts: NAV },
      { cat: 'blink.user_timing', name: 'legacy-measure', ph: 'X', ts: at(50), dur: 30_000 },
    ]);
    const measure = parseProfile(file).events.find(e => e.label === 'legacy-measure');
    expect(measure).toMatchObject({ category: 'user-timing', timeMs: 50, durationMs: 30 });
  });

  it('pairs nested same-name measures LIFO', () => {
    const file = writeTrace([
      { cat: 'blink.user_timing', name: 'navigationStart', ph: 'R', ts: NAV },
      { cat: 'blink.user_timing', name: 'work', ph: 'b', ts: at(10), id: 'outer' },
      { cat: 'blink.user_timing', name: 'work', ph: 'b', ts: at(20), id: 'inner' },
      { cat: 'blink.user_timing', name: 'work', ph: 'e', ts: at(30), id: 'inner' },
      { cat: 'blink.user_timing', name: 'work', ph: 'e', ts: at(90), id: 'outer' },
    ]);
    const spans = parseProfile(file).events
      .filter(e => e.label === 'work')
      .map(e => ({ timeMs: e.timeMs, durationMs: e.durationMs }))
      .sort((a, b) => a.timeMs - b.timeMs);
    expect(spans).toEqual([
      { timeMs: 10, durationMs: 80 }, // outer
      { timeMs: 20, durationMs: 10 }, // inner
    ]);
  });
});

describe('Playwright interaction placement on the synced screencast', () => {
  const shot = (timeMs: number, shade: number): Screenshot => ({ timeMs, dataUri: '', snapshot: jpegBuffer(shade, shade, shade) });
  // 16 and 33 repeat the picture at 0 (the CFR encode's repeated frames);
  // the click's repaint first shows at 50.
  const raw = [shot(0, 10), shot(16, 10), shot(33, 10), shot(50, 200), shot(66, 200), shot(83, 90)];

  it('places a chip on the first new picture at or after the interaction\'s next paint, labelled with its INP', () => {
    const interactions = [{ timeMs: 20, kind: 'click' as const, rect: { x: 1, y: 2, width: 3, height: 4 } }];
    const events = [{ timeMs: 24, label: 'click', category: 'interaction' as const, durationMs: 6, interactionType: 'click' }];
    const placed = placeInteractions(interactions, events, raw);
    expect(placed).toHaveLength(1);
    expect(placed[0].frameTimeMs).toBe(50);
    expect(placed[0].label).toBe('click 6ms');

    const kept = keepFramesAt([raw[0], raw[5]], raw, [50]);
    expect(kept.map((s) => s.timeMs)).toEqual([0, 50, 83]);
    expect(kept[1]).toBe(raw[3]);

    const frames: ProfileFrame[] = kept.map((s) => ({ timeMs: s.timeMs, snapshot: s.snapshot, imgW: 1, imgH: 1 }));
    const buckets = frames.map(() => [] as ReturnType<typeof bucketEventsToFrames>[number]);
    bucketPlacedInteractions(frames, buckets, placed);
    expect(buckets.map((b) => b.length)).toEqual([0, 1, 0]);
    expect(buckets[1][0]).toMatchObject({ kind: 'pw-interaction', label: 'click 6ms', pwRect: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it('takes the first frame at or after the paint when it is already a new picture', () => {
    const events = [{ timeMs: 60, label: 'click', category: 'interaction' as const, durationMs: 20, interactionType: 'click' }];
    const placed = placeInteractions([{ timeMs: 58, kind: 'click' as const }], events, raw);
    expect(placed[0].frameTimeMs).toBe(83);
  });

  it('uses the dispatch time for an interaction without an EventTiming', () => {
    const placed = placeInteractions([{ timeMs: 30, kind: 'fill' as const, text: 'x' }], [], raw);
    expect(placed[0].frameTimeMs).toBe(50);
    expect(placed[0].label).toBe('fill "x"');
  });
});

describe('progressMaskDataUris', () => {
  // 32x16: a left and a right 16x16 half, so each half is its own JPEG block
  // and a change in one cannot bleed into the other.
  const halves = (left: number, right: number): Screenshot => {
    const data = Buffer.alloc(32 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const v = x < 16 ? left : right;
        data.set([v, v, v, 255], (y * 32 + x) * 4);
      }
    }
    return { timeMs: 0, dataUri: '', snapshot: Buffer.from(jpeg.encode({ data, width: 32, height: 16 }, 90).data) };
  };

  it('paints only the pixels that changed since the previous frame red, on a transparent mask', () => {
    const masks = progressMaskDataUris([halves(128, 128), halves(128, 0)]);
    expect(masks[0]).toBeNull();
    const png = PNG.sync.read(Buffer.from(masks[1]!.replace('data:image/png;base64,', ''), 'base64'));
    const pixel = (x: number, y: number) => Array.from(png.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    for (const y of [0, 15]) {
      expect(pixel(0, y)).toEqual([0, 0, 0, 0]);
      expect(pixel(15, y)).toEqual([0, 0, 0, 0]);
      expect(pixel(16, y)).toEqual([255, 0, 0, 255]);
      expect(pixel(31, y)).toEqual([255, 0, 0, 255]);
    }
  });

  it('marks a one-level change, so every frame the dedupe keeps shows why', () => {
    const masks = progressMaskDataUris([halves(128, 128), halves(128, 129)]);
    const png = PNG.sync.read(Buffer.from(masks[1]!.replace('data:image/png;base64,', ''), 'base64'));
    const pixel = (x: number, y: number) => Array.from(png.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    expect(pixel(0, 8)).toEqual([0, 0, 0, 0]);
    expect(pixel(24, 8)).toEqual([255, 0, 0, 255]);
  });
});
