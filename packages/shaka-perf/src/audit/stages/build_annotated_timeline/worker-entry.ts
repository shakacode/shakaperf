/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import { writeFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import {
  attachPwInteractionsToKeptFrames,
  bucketEventsToFrames,
  copyPreviousFramesForAnnotations,
  deriveInteractionsPath,
  deriveScreencastVideoPath,
  deriveScreencastStartPath,
  frameImageFilename,
  loadPlaywrightInteractions,
  loadScreenshotsFromVideo,
  parseProfile,
  profileFramesWithAnnotations,
  syncDedupedVideoToTraceViaPixelmatchAnchors,
  type ArrowSpec,
  type FrameAnnotation,
  type ProfileData,
  type ProfileFrame,
  type Screenshot,
} from '../../../bench/core';
import type { RecordedInteraction } from '../../../bench/core/interaction-recorder';
import type {
  WorkerRequest,
  WorkerResponse,
  FrameImageOutputEntry,
  ComputeFramesResult,
  ComputeDebugAllFramesResult,
  DebugFrameMetadata,
  FrameMetadata,
  SyncScreencastToTraceResult,
} from './worker-protocol';

// pixelmatch is CJS-only; require it the same way timeline-comparison.ts does.
// Used only by the diagnostics `computeDebugAllFrames` path to measure each
// full-stream frame's delta vs its predecessor.
const pixelmatch = require('pixelmatch') as (
  img1: Uint8Array,
  img2: Uint8Array,
  output: Uint8Array | null,
  width: number,
  height: number,
  options?: { threshold?: number },
) => number;

// Long-lived worker that backs one annotated-timeline build. Each
// stage of the build is its own RPC from the parent: the parent posts
// `{ id, type, params }`, the worker runs that step against
// accumulated state, and posts `{ id, type: 'result', value }` (or
// `'error'`) back. The parent's pool slot is held for the duration of
// each step, so every step shows up as its own task in the runner's
// sticky-status panel — the heavy CPU itself runs here, off the host
// pipeline's main thread.
//
// State lives in this module's closure: the parsed profile, decoded
// screenshots, computed frames, etc. flow from one step into the next
// without re-serialisation across the worker boundary.

if (!parentPort) {
  throw new Error('annotated-timeline worker must run inside a worker_threads Worker');
}

// libvips uses this concurrency for per-image processing — here the
// per-frame WebP encode in writeFrameImage and the metadata probes.
// Capped so the pool's parallel workers don't oversubscribe the CPU.
sharp.concurrency(2);
// Disable libvips's internal operation cache (default ~100 MB per
// libvips context). The pool reuses one worker per slot across many
// audits, so the cache would otherwise hold pixel buffers from earlier
// audits long after the next reset() dropped the JS-side state. We
// don't re-process the same source buffer twice within a build, so the
// cache buys nothing — only memory.
sharp.cache(false);

const FRAME_WEBP_QUALITY = 40;

const port = parentPort;

interface WorkerState {
  profile?: ProfileData;
  screencastShots?: Screenshot[] | undefined;
  rawSyncedScreencastShots?: Screenshot[] | undefined;
  playwrightInteractions?: RecordedInteraction[] | undefined;
  rawFrames?: ProfileFrame[];
  rawBuckets?: FrameAnnotation[][];
  frames?: ProfileFrame[];
  arrows?: ArrowSpec[][];
  keptBuckets?: FrameAnnotation[][];
  frameImages?: FrameImageOutputEntry[];
  outDir?: string;
}

const state: WorkerState = {};

port.on('message', (msg: WorkerRequest) => {
  void handleRequest(msg).then(
    (value) => port.postMessage({ id: msg.id, type: 'result', value } as WorkerResponse),
    (err: Error) => port.postMessage({
      id: msg.id,
      type: 'error',
      message: err.message,
      stack: err.stack,
    } as WorkerResponse),
  );
});

async function handleRequest(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'reset': return runReset();
    case 'parseProfile': return runParseProfile(msg.params.profilePath);
    case 'loadScreencastVideo': return runLoadScreencastVideo(msg.params.profilePath);
    case 'syncScreencastToTrace': return runSyncScreencastToTrace(msg.params.limitVideoFramesCount);
    case 'computeFrames': return runComputeFrames(msg.params.profilePath, msg.params.interactionsPath);
    case 'computeDebugAllFrames': return runComputeDebugAllFrames(msg.params.outDir, msg.params.metadataPath);
    case 'writeFrameImage': return runWriteFrameImage(msg.params.index, msg.params.outDir);
    case 'writeFramesMetadata': return runWriteFramesMetadata(msg.params);
    default: {
      const exhaustive: never = msg;
      throw new Error(`unknown worker request type: ${(exhaustive as { type: string }).type}`);
    }
  }
}

// Drop every reference the previous build accumulated so V8 can collect
// the old profile / decoded screencast frames / per-frame image buffers
// before the next audit's parseProfile allocates the replacements. The host
// pool reuses one worker per slot across many audits — without this
// the worker's heap would keep the prior build's >100 MB working set
// live across the (sub-second) gap between audits.
function runReset(): void {
  state.profile = undefined;
  state.screencastShots = undefined;
  state.rawSyncedScreencastShots = undefined;
  state.playwrightInteractions = undefined;
  state.rawFrames = undefined;
  state.rawBuckets = undefined;
  state.frames = undefined;
  state.arrows = undefined;
  state.keptBuckets = undefined;
  state.frameImages = undefined;
  state.outDir = undefined;
}

function runParseProfile(profilePath: string): { hasViewport: boolean } {
  state.profile = parseProfile(profilePath);
  return { hasViewport: state.profile.viewport != null };
}

async function runLoadScreencastVideo(profilePath: string): Promise<{ shotCount: number }> {
  state.screencastShots = await loadScreenshotsFromVideo(
    deriveScreencastVideoPath(profilePath),
    deriveScreencastStartPath(profilePath),
  );
  return { shotCount: state.screencastShots?.length ?? 0 };
}

async function runSyncScreencastToTrace(limitVideoFramesCount: number): Promise<SyncScreencastToTraceResult> {
  if (!state.profile) throw new Error('syncScreencastToTrace called before parseProfile');
  const rawShots = state.screencastShots;
  if (!rawShots || rawShots.length === 0) {
    // Nothing to sync — leave the profile's trace screenshots in place.
    return {
      screenshotCount: state.profile.screenshots.length,
      rawSyncedFrameCount: state.profile.screenshots.length,
      inputFrameCount: state.profile.screenshots.length,
      keptFrameCount: state.profile.screenshots.length,
      removedFrameCount: 0,
      anchorCount: 0,
      frameCapDropped: 0,
    };
  }
  // Hard cap BEFORE dedupe: if the raw screencast has more frames than
  // `limitVideoFramesCount`, evenly downsample it to the cap first. Dedupe is
  // O(frames) of pixel work, so an unbounded screencast (slow page, long flow)
  // can blow the per-task timeout; this bounds it regardless of input length.
  // Even downsampling keeps the first and last frame and spreads the survivors
  // uniformly, so the timeline still spans the whole load.
  const shots = downsampleEvenly(rawShots, limitVideoFramesCount);
  const frameCapDropped = rawShots.length - shots.length;
  const synced = await syncDedupedVideoToTraceViaPixelmatchAnchors(
    state.profile.screenshots,
    shots,
  );
  state.profile.screenshots = synced.screenshots.filter((s) => s.timeMs >= 0);
  state.rawSyncedScreencastShots = synced.rawSyncedScreenshots.filter((s) => s.timeMs >= 0);
  state.profile.maxTimeMs = state.profile.screenshots.length > 0
    ? Math.max(...state.profile.screenshots.map((s) => s.timeMs))
    : state.profile.maxTimeMs;
  return {
    screenshotCount: state.profile.screenshots.length,
    rawSyncedFrameCount: state.rawSyncedScreencastShots.length,
    inputFrameCount: synced.stats.inputFrameCount,
    keptFrameCount: synced.stats.keptFrameCount,
    removedFrameCount: synced.stats.removedFrameCount,
    anchorCount: synced.stats.anchorCount,
    frameCapDropped,
  };
}

/**
 * Evenly downsample `items` to at most `limit` elements, keeping the first and
 * last and spreading the survivors uniformly across the sequence. Returns the
 * input unchanged when it's already within the cap (or the cap is non-positive,
 * which disables the cap). Picks `limit` indices at `round(i*(n-1)/(limit-1))`;
 * since `n > limit` the step is > 1, so no index repeats.
 */
function downsampleEvenly<T>(items: T[], limit: number): T[] {
  if (limit <= 0 || items.length <= limit) return items;
  if (limit === 1) return [items[0]];
  const n = items.length;
  const out: T[] = [];
  for (let i = 0; i < limit; i++) {
    out.push(items[Math.round((i * (n - 1)) / (limit - 1))]);
  }
  return out;
}

function runComputeFrames(profilePath: string, interactionsPathParam?: string): ComputeFramesResult {
  const profile = state.profile;
  if (!profile) throw new Error('computeFrames called before parseProfile');
  const interactionsPath = interactionsPathParam ?? deriveInteractionsPath(profilePath);
  const playwrightInteractions = loadPlaywrightInteractions(interactionsPath);
  state.playwrightInteractions = playwrightInteractions;
  const annotationFrames = copyPreviousFramesForAnnotations(
    profile.screenshots,
    profile.events,
    playwrightInteractions,
  );
  profile.screenshots = annotationFrames.screenshots;

  const rawFrames: ProfileFrame[] = profile.screenshots.map((s) => ({
    timeMs: s.timeMs,
    snapshot: s.snapshot,
    imgW: 0,
    imgH: 0,
    copiedForAnnotation: s.copiedForAnnotation,
  }));
  const rawBuckets = bucketEventsToFrames(rawFrames, profile.events, playwrightInteractions);
  const computed = profileFramesWithAnnotations(profile, rawBuckets);
  state.rawFrames = rawFrames;
  state.rawBuckets = rawBuckets;
  state.frames = computed.frames;
  state.arrows = computed.arrows;
  state.keptBuckets = computed.keptBuckets;
  if (playwrightInteractions && playwrightInteractions.length > 0) {
    const interactionRawFrames: ProfileFrame[] = (state.rawSyncedScreencastShots ?? profile.screenshots).map((s) => ({
      timeMs: s.timeMs,
      snapshot: s.snapshot,
      imgW: 0,
      imgH: 0,
      copiedForAnnotation: s.copiedForAnnotation,
    }));
    attachPwInteractionsToKeptFrames(
      interactionRawFrames,
      computed.frames,
      computed.arrows,
      computed.keptBuckets,
      playwrightInteractions,
      profile.events,
    );
  }
  state.frameImages = new Array(computed.frames.length);
  return {
    frameCount: computed.frames.length,
    copiedAnnotationFrameCount: annotationFrames.copiedFrameCount,
  };
}

// Diagnostics-only (`--debug-show-all-frames`). Render the FULL, non-deduped
// stream: every synced screencast frame (`rawSyncedScreenshots`, populated by
// syncScreencastToTrace), each annotated with `prevDiff` and `keptByDedupe`
// (whether the frame also survived into the rendered timeline).
//
// `prevDiff` is measured against the previous KEPT (non-discarded) frame, NOT
// the immediate neighbour — this mirrors the dedupe itself (detectChangeFrames),
// which accumulates change against the last frame it kept rather than the last
// frame it saw. Comparing neighbours would report ~0 % for every frame of a slow
// animation (each step is tiny) and make a kept frame look identical to its
// predecessor; comparing against the last kept frame shows the accumulated delta
// that actually crossed the threshold, so the green "kept" frames line up with
// the diffs that justified keeping them.
//
// Must run AFTER syncScreencastToTrace and BEFORE computeFrames, while
// `profile.screenshots` still holds exactly the deduped change-frame set (so
// `keptByDedupe` is an exact timestamp-membership test) and before computeFrames
// mutates it with annotation-copied frames. When there was no screencast the
// full stream degenerates to the trace screenshots themselves (all kept).
//
// Width for the diff comparison: downscale to keep per-frame pixelmatch cheap
// over hundreds of frames; the WRITTEN images stay full-resolution for display.
const DEBUG_DIFF_COMPARE_WIDTH = 240;
// Matches the dedupe's per-pixel colour-distance threshold so the displayed Δ
// tracks the same signal the dedupe thresholds on (see
// CHANGE_DETECTION_PIXELMATCH_THRESHOLD in timeline-comparison.ts).
const DEBUG_DIFF_PIXELMATCH_THRESHOLD = 0.175;

async function runComputeDebugAllFrames(
  outDir: string,
  metadataPath: string,
): Promise<ComputeDebugAllFramesResult> {
  if (!state.profile) throw new Error('computeDebugAllFrames called before parseProfile');
  const source = state.rawSyncedScreencastShots ?? state.profile.screenshots;
  const shots = [...source].sort((a, b) => a.timeMs - b.timeMs);
  // Exact membership: deduped frames are a slice of the same synced stream, so
  // their timestamps match the full-stream entries bit-for-bit.
  const keptTimes = new Set(state.profile.screenshots.map((s) => s.timeMs));
  if (shots.length === 0) {
    writeFileSync(metadataPath, JSON.stringify([]));
    return { frameCount: 0, keptCount: 0 };
  }
  // Comparison dims from the first frame; every frame is resized to these so
  // consecutive RGBA buffers are pixelmatch-comparable regardless of source.
  const probe = await sharp(shots[0].snapshot).metadata();
  const srcW = probe.width ?? DEBUG_DIFF_COMPARE_WIDTH;
  const srcH = probe.height ?? DEBUG_DIFF_COMPARE_WIDTH;
  const compareW = Math.min(srcW, DEBUG_DIFF_COMPARE_WIDTH);
  const compareH = Math.max(1, Math.round(srcH * (compareW / Math.max(1, srcW))));
  const comparePixels = compareW * compareH;

  const decodeForDiff = async (buf: Buffer): Promise<Uint8Array> => {
    const raw = await sharp(buf).resize(compareW, compareH, { fit: 'fill' }).raw().ensureAlpha().toBuffer();
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  };

  const metas: DebugFrameMetadata[] = [];
  let keptCount = 0;
  // The previous frame the dedupe KEPT — `prevDiff` is measured against this,
  // not the immediate neighbour, so the reported delta is the accumulated change
  // the dedupe actually thresholds on. Updated only when the current frame is
  // itself kept.
  let lastKeptDecoded: Uint8Array | null = null;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const decoded = await decodeForDiff(shot.snapshot);
    const keptByDedupe = keptTimes.has(shot.timeMs);
    if (keptByDedupe) keptCount++;
    let prevDiff: { fraction: number; pixels: number } | undefined;
    if (lastKeptDecoded && lastKeptDecoded.length === decoded.length) {
      const diffPixels = pixelmatch(lastKeptDecoded, decoded, null, compareW, compareH, {
        threshold: DEBUG_DIFF_PIXELMATCH_THRESHOLD,
      });
      prevDiff = { pixels: diffPixels, fraction: comparePixels > 0 ? diffPixels / comparePixels : 0 };
    }
    const imageFilename = debugFrameImageFilename(i, shot.timeMs);
    const info = await sharp(shot.snapshot).webp({ quality: FRAME_WEBP_QUALITY }).toFile(path.join(outDir, imageFilename));
    metas.push({
      timeMs: shot.timeMs,
      imgW: info.width,
      imgH: info.height,
      imageFilename,
      keptByDedupe,
      ...(prevDiff ? { prevDiff } : {}),
    });
    if (keptByDedupe) lastKeptDecoded = decoded;
  }
  writeFileSync(metadataPath, JSON.stringify(metas));
  return { frameCount: metas.length, keptCount };
}

function debugFrameImageFilename(index: number, timeMs: number): string {
  // Zero-padded index keeps lexical order == temporal order and disambiguates
  // frames whose timestamps round to the same value.
  const idx = String(index).padStart(5, '0');
  return `debug_allframe_${idx}_${timeMs.toFixed(1)}ms.webp`;
}

async function runWriteFrameImage(index: number, outDir: string): Promise<void> {
  if (!state.profile || !state.frames || !state.arrows || !state.keptBuckets || !state.frameImages) {
    throw new Error('writeFrameImage called before computeFrames');
  }
  state.outDir = outDir;
  const frame = state.frames[index];
  const imageFilename = frameImageFilename(frame.timeMs);
  await sharp(frame.snapshot)
    .webp({ quality: FRAME_WEBP_QUALITY })
    .toFile(path.join(outDir, imageFilename));
  state.frameImages[index] = {
    timeMs: frame.timeMs,
    imgW: frame.imgW,
    imgH: frame.imgH,
    imageFilename,
    annotations: scaleAnnotationsForFrame(state.keptBuckets[index] ?? [], frame, state.profile.viewport),
    arrows: state.arrows[index] ?? [],
  };
}

function scaleAnnotationsForFrame(
  annotations: readonly FrameAnnotation[],
  frame: ProfileFrame,
  viewport: ProfileData['viewport'],
): FrameAnnotation[] {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || frame.imgW <= 0 || frame.imgH <= 0) {
    return annotations.map((ann) => ({ ...ann }));
  }
  const sx = frame.imgW / viewport.width;
  const sy = frame.imgH / viewport.height;
  return annotations.map((ann) => ({
    ...ann,
    ...(ann.rects
      ? { rects: ann.rects.map(([x, y, w, h]) => [x * sx, y * sy, w * sx, h * sy]) }
      : {}),
    ...(ann.pwRect
      ? {
        pwRect: {
          x: ann.pwRect.x * sx,
          y: ann.pwRect.y * sy,
          width: ann.pwRect.width * sx,
          height: ann.pwRect.height * sy,
        },
      }
      : {}),
  }));
}

function runWriteFramesMetadata(params: { outputPath: string }): FrameMetadata[] {
  if (!state.frameImages) throw new Error('writeFramesMetadata called before any writeFrameImage');
  // Every slot must be filled before we can serialise — surface a missing
  // index rather than silently dropping a frame.
  for (let i = 0; i < state.frameImages.length; i++) {
    if (!state.frameImages[i]) {
      throw new Error(`writeFramesMetadata missing frame image at index ${i}`);
    }
  }
  // Lightweight metadata only — the per-frame WebP bytes already live on
  // disk at `<outDir>/timeline_frame_<timeMs>ms.webp` (written by
  // writeFrameImage). The audit engine reads this JSON + the image files at
  // write-time to build the React-rendered `frames` array.
  const metas: FrameMetadata[] = state.frameImages.map((entry) => ({
    timeMs: entry.timeMs,
    imgW: entry.imgW,
    imgH: entry.imgH,
    imageFilename: entry.imageFilename,
    annotations: entry.annotations,
    arrows: entry.arrows,
  }));
  writeFileSync(params.outputPath, JSON.stringify(metas));
  return metas;
}
