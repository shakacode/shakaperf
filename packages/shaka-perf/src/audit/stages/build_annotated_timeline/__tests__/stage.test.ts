/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { BuildAnnotatedTimelineStage, type BuildAnnotatedTimelineResult } from '../stage';

describe('BuildAnnotatedTimelineStage report stripping', () => {
  const measurement: BuildAnnotatedTimelineResult = {
    frames: [
      {
        timeMs: 123,
        imgW: 320,
        imgH: 180,
        imageDataUri: 'data:image/avif;base64,thumb',
        imageHref: 'artifacts/timeline_frame_123.00ms.webp',
        annotations: [{ kind: 'lcp', label: 'LCP' }],
      },
    ],
    screencastHref: 'artifacts/screencast.mp4',
  };

  it('lightweight keeps the inline thumbnail and drops hrefs + screencast', () => {
    const stage = new BuildAnnotatedTimelineStage();
    expect(stage.stripMeasurementForLightweight(measurement)).toEqual({
      frames: [
        {
          timeMs: 123,
          imgW: 320,
          imgH: 180,
          imageDataUri: 'data:image/avif;base64,thumb',
          annotations: [{ kind: 'lcp', label: 'LCP' }],
        },
      ],
    });
  });

  it('full keeps the on-disk href + screencast and drops the inline thumbnail', () => {
    const stage = new BuildAnnotatedTimelineStage();
    expect(stage.stripMeasurementForFull(measurement)).toEqual({
      frames: [
        {
          timeMs: 123,
          imgW: 320,
          imgH: 180,
          imageHref: 'artifacts/timeline_frame_123.00ms.webp',
          annotations: [{ kind: 'lcp', label: 'LCP' }],
        },
      ],
      screencastHref: 'artifacts/screencast.mp4',
    });
  });

  describe('--debug-show-all-frames debugAllFrames', () => {
    const debugMeasurement: BuildAnnotatedTimelineResult = {
      ...measurement,
      debugAllFrames: [
        {
          timeMs: 100,
          imgW: 320,
          imgH: 180,
          imageDataUri: 'data:image/avif;base64,thumbA',
          imageHref: 'artifacts/debug_allframe_00000_100.0ms.webp',
          keptByDedupe: true,
          prevDiff: { fraction: 0.0421, pixels: 2400 },
        },
        {
          timeMs: 116,
          imgW: 320,
          imgH: 180,
          imageDataUri: 'data:image/avif;base64,thumbB',
          imageHref: 'artifacts/debug_allframe_00001_116.7ms.webp',
          keptByDedupe: false,
          prevDiff: { fraction: 0.0003, pixels: 17 },
        },
      ],
    };

    it('lightweight keeps debug frames with the thumbnail + diff signals, drops hrefs', () => {
      const stage = new BuildAnnotatedTimelineStage();
      expect(stage.stripMeasurementForLightweight(debugMeasurement).debugAllFrames).toEqual([
        {
          timeMs: 100,
          imgW: 320,
          imgH: 180,
          imageDataUri: 'data:image/avif;base64,thumbA',
          keptByDedupe: true,
          prevDiff: { fraction: 0.0421, pixels: 2400 },
        },
        {
          timeMs: 116,
          imgW: 320,
          imgH: 180,
          imageDataUri: 'data:image/avif;base64,thumbB',
          keptByDedupe: false,
          prevDiff: { fraction: 0.0003, pixels: 17 },
        },
      ]);
    });

    it('full keeps debug frames with the href + diff signals, drops the thumbnail', () => {
      const stage = new BuildAnnotatedTimelineStage();
      const full = stage.stripMeasurementForFull(debugMeasurement);
      expect(full.debugAllFrames).toEqual([
        {
          timeMs: 100,
          imgW: 320,
          imgH: 180,
          imageHref: 'artifacts/debug_allframe_00000_100.0ms.webp',
          keptByDedupe: true,
          prevDiff: { fraction: 0.0421, pixels: 2400 },
        },
        {
          timeMs: 116,
          imgW: 320,
          imgH: 180,
          imageHref: 'artifacts/debug_allframe_00001_116.7ms.webp',
          keptByDedupe: false,
          prevDiff: { fraction: 0.0003, pixels: 17 },
        },
      ]);
    });

    it('omits debugAllFrames entirely when the flag was not set', () => {
      const stage = new BuildAnnotatedTimelineStage();
      expect(stage.stripMeasurementForLightweight(measurement).debugAllFrames).toBeUndefined();
      expect(stage.stripMeasurementForFull(measurement).debugAllFrames).toBeUndefined();
    });
  });
});
