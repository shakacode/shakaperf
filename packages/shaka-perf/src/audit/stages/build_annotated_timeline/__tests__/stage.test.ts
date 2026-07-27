/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BuildAnnotatedTimelineResult } from '../stage';

describe('BuildAnnotatedTimelineStage artifact ownership', () => {
  it('leaves every persisted path for report generation to handle', () => {
    const measurement: BuildAnnotatedTimelineResult = {
      frames: [{
        timeMs: 123,
        imgW: 320,
        imgH: 180,
        imageHref: 'checkout-desktop/artifacts/timeline_frame_123.00ms.webp',
        annotations: [{ kind: 'lcp', label: 'LCP' }],
      }],
      screencastHref: 'checkout-desktop/artifacts/screencast.mp4',
      debugAllFrames: [{
        timeMs: 116,
        imgW: 320,
        imgH: 180,
        imageHref: 'checkout-desktop/artifacts/debug_allframe_00001_116.7ms.webp',
        keptByDedupe: false,
        prevDiff: { fraction: 0.0003, pixels: 17 },
      }],
    };

    expect(measurement).toEqual({
      frames: [{
        timeMs: 123,
        imgW: 320,
        imgH: 180,
        imageHref: 'checkout-desktop/artifacts/timeline_frame_123.00ms.webp',
        annotations: [{ kind: 'lcp', label: 'LCP' }],
      }],
      screencastHref: 'checkout-desktop/artifacts/screencast.mp4',
      debugAllFrames: [{
        timeMs: 116,
        imgW: 320,
        imgH: 180,
        imageHref: 'checkout-desktop/artifacts/debug_allframe_00001_116.7ms.webp',
        keptByDedupe: false,
        prevDiff: { fraction: 0.0003, pixels: 17 },
      }],
    });
  });
});
