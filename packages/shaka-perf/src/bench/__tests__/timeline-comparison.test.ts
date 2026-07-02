/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bucketEventsToFrames,
  copyPreviousFramesForAnnotations,
  parseProfile,
  profileFramesWithAnnotations,
  SHAKA_PERF_ANNOTATION_PREFIX,
  syncDedupedVideoToTraceViaPixelmatchAnchors,
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

describe('syncDedupedVideoToTraceViaPixelmatchAnchors fail-fast', () => {
  const shot = (timeMs: number): Screenshot => ({ timeMs, dataUri: '', snapshot: jpegBuffer(10, 10, 10) });

  it('throws instead of degrading when there are no screencast frames', async () => {
    await expect(syncDedupedVideoToTraceViaPixelmatchAnchors([shot(0), shot(1)], []))
      .rejects.toThrow('at least one screencast frame');
  });

  it('throws instead of degrading with fewer than two trace screenshots', async () => {
    await expect(syncDedupedVideoToTraceViaPixelmatchAnchors([shot(0)], [shot(0)]))
      .rejects.toThrow('trace screenshots for change detection');
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
