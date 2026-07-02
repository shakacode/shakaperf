/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Wire types shared by the parent (engine.ts / worker-client.ts) and
// the long-lived worker (worker-entry.ts). Kept in its own file so the
// worker side can import the protocol without dragging in any pool /
// pipeline machinery — Worker imports compile to a separate dist file
// and a bigger import graph means a slower worker startup. The bench/core
// imports below are `import type` only, erased at compile time.

import type { ArrowSpec, FrameAnnotation } from '../../../bench/core';

export type WorkerRequest =
  | { id: number; type: 'reset'; params: Record<string, never> }
  | { id: number; type: 'parseProfile'; params: { profilePath: string } }
  | { id: number; type: 'loadScreencastVideo'; params: { profilePath: string } }
  | { id: number; type: 'syncScreencastToTrace'; params: { limitVideoFramesCount: number } }
  | { id: number; type: 'computeFrames'; params: { profilePath: string; interactionsPath?: string | undefined } }
  | { id: number; type: 'computeDebugAllFrames'; params: { outDir: string; metadataPath: string } }
  | { id: number; type: 'writeFrameImage'; params: { index: number; outDir: string } }
  | {
    id: number;
    type: 'writeFramesMetadata';
    params: { outputPath: string };
  };

export type WorkerResponse =
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; stack?: string };

export interface FrameImageOutputEntry {
  timeMs: number;
  imgW: number;
  imgH: number;
  imageFilename: string;
  annotations: FrameAnnotation[];
  arrows: ArrowSpec[];
}

export interface SyncScreencastToTraceResult {
  screenshotCount: number;
  rawSyncedFrameCount: number;
  inputFrameCount: number;
  keptFrameCount: number;
  removedFrameCount: number;
  anchorCount: number;
  /**
   * Frames dropped by the pre-dedupe hard cap (`limitVideoFramesCount`): the
   * raw screencast was evenly downsampled to the cap before dedupe ran. 0 when
   * the raw frame count was already within the cap.
   */
  frameCapDropped: number;
}

export interface ComputeFramesResult {
  frameCount: number;
  copiedAnnotationFrameCount: number;
}

export interface ComputeDebugAllFramesResult {
  frameCount: number;
  keptCount: number;
}

/**
 * One entry of the diagnostics-only, full (non-deduped) timeline written to
 * `timeline_debug_all_frames.json`. Mirrors `FrameMetadata` plus the per-frame
 * dedupe signals: `prevDiff` (delta vs the previous full-stream frame) and
 * `keptByDedupe` (whether this frame also survived into the rendered timeline).
 */
export interface DebugFrameMetadata {
  timeMs: number;
  imgW: number;
  imgH: number;
  imageFilename: string;
  prevDiff?: { fraction: number; pixels: number };
  keptByDedupe: boolean;
}

/**
 * Persisted alongside per-frame images as `timeline_frames.json`. The audit
 * engine reads this at write-time and builds
 * `BuildAnnotatedTimelineResult.frames` from it, pairing each entry with its
 * frame image and passing annotation metadata through to React.
 */
export interface FrameMetadata {
  timeMs: number;
  imgW: number;
  imgH: number;
  imageFilename?: string;
  annotations?: FrameAnnotation[];
  arrows?: ArrowSpec[];
}
