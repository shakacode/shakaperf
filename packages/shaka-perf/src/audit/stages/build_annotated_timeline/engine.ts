/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import sharp from 'sharp';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import { SCREENCAST_FILENAME } from '../../../bench/core/lighthouse-config';
import type { ArtifactScope } from '../../../pipeline/artifact-store';
import type { TestContext } from '../../../stage/stage';
import type { AnnotatedFrame, BuildAnnotatedTimelineResult } from './stage';
import type { DebugFrameMetadata, FrameMetadata } from './worker-protocol';
import { TimelineWorkerClient } from './worker-client';

const FRAMES_METADATA_FILENAME = 'timeline_frames.json';
// Diagnostics-only (`--debug-show-all-frames`): the full, non-deduped stream's
// per-frame metadata, written by the worker's computeDebugAllFrames.
const DEBUG_FRAMES_METADATA_FILENAME = 'timeline_debug_all_frames.json';
// One TimelineWorkerClient per WorkerPool slot, reused across every
// audit that lands on that slot for the run's lifetime. Creating a fresh
// `new Worker(...)` per audit was the dominant native-memory leak: each
// worker_thread is a separate V8 isolate that imports `sharp`, which
// brings up its own libvips threadpool. libvips threads each get a
// dedicated glibc malloc arena that the libc never returns to the OS,
// so 200+ worker_thread create/destroy cycles accumulated GBs of
// arena-resident pages even though every worker's V8 heap was freed.
//
// With per-slot reuse, total `new Worker(...)` calls is bounded to
// `parallelism` for the whole run instead of `units × viewports`. The
// disposer registered via `getWorkerState` cleans up at pool teardown.
interface TimelineSlotState extends PoolWorkerState {
  timelineClient?: TimelineWorkerClient | undefined;
}

async function disposeTimelineClient(state: Record<string, unknown>): Promise<void> {
  const slot = state as TimelineSlotState;
  const client = slot.timelineClient;
  if (!client) return;
  slot.timelineClient = undefined;
  await client.dispose();
}

function clearGeneratedTimelineArtifacts(artifactsDir: string, metadataPath: string): number {
  if (!fs.existsSync(artifactsDir)) return 0;
  let removed = 0;
  for (const p of [metadataPath, path.join(artifactsDir, DEBUG_FRAMES_METADATA_FILENAME)]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed++;
    }
  }
  for (const entry of fs.readdirSync(artifactsDir)) {
    // Both the deduped `timeline_frame_*` images and the diagnostics-only
    // `debug_allframe_*` images (plus their cached thumbnails) are regenerated
    // each run, so clear either form here.
    if (!/^(?:timeline_frame_[\d.]+ms|debug_allframe_\d+_[\d.]+ms)\.(?:jpe?g|avif|webp)(?:\.thumb(?:-v\d+)?\.avif)?$/.test(entry)) continue;
    fs.unlinkSync(path.join(artifactsDir, entry));
    removed++;
  }
  return removed;
}

export async function runBuildAnnotatedTimelineStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  limitVideoFramesCount: number,
): Promise<BuildAnnotatedTimelineResult> {
  const artifactsDir = ctx.artifacts.dir;
  const profilePath = path.join(artifactsDir, 'experiment_performance_profile.json');
  if (!fs.existsSync(profilePath)) {
    console.log(chalk.dim(`annotated-timeline: no performance profile at ${profilePath}; reading cached artifact`));
    return readAnnotatedTimelineArtifact({
      artifacts: ctx.artifacts,
    });
  }

  // The whole build runs inside a single pool submit: it holds the slot
  // for the full timeline (well under the default 120 s per-task timeout
  // for typical audits), and pulls the slot's long-lived worker out of
  // pool state — creating it on first use, `reset`-ing per-audit state
  // on subsequent uses. Bounded peak worker_threads = `parallelism`.
  console.log(chalk.dim(`annotated-timeline: building frames from ${profilePath}`));
  const metadataPath = path.join(artifactsDir, FRAMES_METADATA_FILENAME);
  const removedArtifacts = clearGeneratedTimelineArtifacts(artifactsDir, metadataPath);
  if (removedArtifacts > 0) {
    console.log(chalk.dim(`annotated-timeline: cleared ${removedArtifacts} stale generated artifact${removedArtifacts === 1 ? '' : 's'}`));
  }
  const key = `${ctx.testAndViewportId}:build_annotated_timeline`;
  await workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<TimelineSlotState>(state, disposeTimelineClient);
    if (slot.timelineClient) {
      // Reuse the slot's worker. Drop the prior audit's state inside it
      // before this audit's parseProfile allocates the replacements.
      console.log(chalk.dim('annotated-timeline: resetting reused worker'));
      await slot.timelineClient.reset();
    } else {
      console.log(chalk.dim('annotated-timeline: starting worker'));
      slot.timelineClient = new TimelineWorkerClient();
    }
    const client = slot.timelineClient;
    try {
      console.log(chalk.dim('annotated-timeline: parsing Lighthouse profile'));
      const { hasViewport } = await client.parseProfile(profilePath);
      console.log(chalk.dim(`annotated-timeline: profile parsed${hasViewport ? '' : ' (no viewport metadata)'}`));

      console.log(chalk.dim('annotated-timeline: loading screencast video'));
      const { shotCount } = await client.loadScreencastVideo(profilePath);
      console.log(chalk.dim(`annotated-timeline: loaded ${shotCount} screencast shot${shotCount === 1 ? '' : 's'}`));
      if (shotCount > 0) {
        if (shotCount > limitVideoFramesCount) {
          console.log(chalk.dim(`annotated-timeline: frame hard-cap — evenly dropping ${shotCount - limitVideoFramesCount} of ${shotCount} screencast frames down to ${limitVideoFramesCount} before dedupe`));
        }
        console.log(chalk.dim('annotated-timeline: deduping screencast before trace sync'));
        const syncResult = await client.syncScreencastToTrace(limitVideoFramesCount);
        console.log(chalk.dim(`annotated-timeline: pre-sync dedupe removed ${syncResult.removedFrameCount}/${syncResult.inputFrameCount} screencast frame${syncResult.inputFrameCount === 1 ? '' : 's'}; kept ${syncResult.keptFrameCount}`));
        const syncMode = `with ${syncResult.anchorCount} pixelmatch anchor${syncResult.anchorCount === 1 ? '' : 's'}`;
        console.log(chalk.dim(`annotated-timeline: synced ${syncResult.screenshotCount} deduped timeline frame candidate${syncResult.screenshotCount === 1 ? '' : 's'} ${syncMode}; retained ${syncResult.rawSyncedFrameCount} raw synced frame${syncResult.rawSyncedFrameCount === 1 ? '' : 's'} for interaction annotations`));
      }

      // Diagnostics: capture the FULL, non-deduped stream (each frame diffed
      // against its predecessor) BEFORE computeFrames mutates profile.screenshots
      // with annotation-copy frames. Gated on the flag — it writes one image per
      // synced frame, far more than the deduped set.
      if (ctx.runtime.debugShowAllFrames) {
        console.log(chalk.dim('annotated-timeline: [debug] building full non-deduped frame timeline'));
        const debugMetadataPath = path.join(artifactsDir, DEBUG_FRAMES_METADATA_FILENAME);
        const debug = await client.computeDebugAllFrames(artifactsDir, debugMetadataPath);
        console.log(chalk.dim(`annotated-timeline: [debug] wrote ${debug.frameCount} full-stream frame${debug.frameCount === 1 ? '' : 's'} (${debug.keptCount} kept by dedupe)`));
      }

      console.log(chalk.dim('annotated-timeline: preparing timeline frames'));
      const {
        frameCount,
        copiedAnnotationFrameCount,
      } = await client.computeFrames(profilePath);
      if (copiedAnnotationFrameCount > 0) {
        console.log(chalk.dim(`annotated-timeline: copied ${copiedAnnotationFrameCount} previous frame${copiedAnnotationFrameCount === 1 ? '' : 's'} for annotation timestamps`));
      }
      console.log(chalk.dim(`annotated-timeline: prepared ${frameCount} frame${frameCount === 1 ? '' : 's'} to write`));
      // Serial per-frame writes keep disk pressure predictable across audits.
      // Annotation labels/rects are persisted as metadata and rendered later
      // by React instead of being baked into each image.
      for (let i = 0; i < frameCount; i++) {
        if (i === 0 || i === frameCount - 1 || (i + 1) % 10 === 0) {
          console.log(chalk.dim(`annotated-timeline: writing frame image ${i + 1}/${frameCount}`));
        }
        await client.writeFrameImage(i, artifactsDir);
      }
      // Persist the per-frame metadata so the audit engine (and any later
      // `--report-only`) can rebuild `BuildAnnotatedTimelineResult.frames`
      // without re-running the worker. Per-frame image bytes already live on
      // disk from `writeFrameImage`; the JSON records timing/dimensions and
      // React overlay data.
      console.log(chalk.dim('annotated-timeline: writing frame metadata'));
      const metadata = await client.writeFramesMetadata({ outputPath: metadataPath });
      console.log(chalk.dim(`annotated-timeline: wrote ${metadata.length} metadata entr${metadata.length === 1 ? 'y' : 'ies'}`));
    } catch (err) {
      // Don't trust a worker that threw partway through — dispose it so
      // the next audit on this slot starts with a fresh worker_thread.
      // Pool teardown won't double-dispose because we null the field
      // before awaiting.
      slot.timelineClient = undefined;
      await client.dispose();
      throw err;
    }
  }, { key });
  console.log(chalk.dim('annotated-timeline: frame build done; reading artifact metadata'));

  return readAnnotatedTimelineArtifact({
    artifacts: ctx.artifacts,
  });
}

interface ReadAnnotatedTimelineArtifactOptions {
  artifacts: ArtifactScope;
}

async function readAnnotatedTimelineArtifact(opts: ReadAnnotatedTimelineArtifactOptions): Promise<BuildAnnotatedTimelineResult> {
  const metas = await loadOrReconstructFramesMetadata(opts.artifacts.dir);
  if (!metas || metas.length === 0) {
    console.log(chalk.dim('annotated-timeline: no frame metadata found'));
    return {};
  }
  console.log(chalk.dim(`annotated-timeline: preparing ${metas.length} report frame${metas.length === 1 ? '' : 's'}`));
  const frames: AnnotatedFrame[] = metas.map((meta) => {
    const imageFilename = meta.imageFilename;
    const frame: AnnotatedFrame = {
      timeMs: meta.timeMs,
      imgW: meta.imgW,
      imgH: meta.imgH,
      ...(meta.annotations != null ? { annotations: meta.annotations } : {}),
      ...(meta.arrows != null ? { arrows: meta.arrows } : {}),
    };
    if (imageFilename) {
      const imageAbsPath = path.join(opts.artifacts.dir, imageFilename);
      if (!fs.existsSync(imageAbsPath)) return frame;
      // Report generation keeps this path for the full report and replaces
      // it with a data URI for the self-contained report.
      frame.imageHref = opts.artifacts.pathFor(imageFilename);
    }
    return frame;
  });
  console.log(chalk.dim(`annotated-timeline: prepared ${frames.length} report frame${frames.length === 1 ? '' : 's'}`));
  const screencastPath = path.join(opts.artifacts.dir, SCREENCAST_FILENAME);
  const screencastHref = fs.existsSync(screencastPath)
    ? opts.artifacts.pathFor(SCREENCAST_FILENAME)
    : undefined;
  console.log(chalk.dim(`annotated-timeline: screencast ${screencastHref ? 'attached' : 'not found'}`));
  const debugAllFrames = loadDebugAllFrames(opts);
  return {
    frames,
    ...(screencastHref ? { screencastHref } : {}),
    ...(debugAllFrames && debugAllFrames.length > 0 ? { debugAllFrames } : {}),
  };
}

/**
 * Load the diagnostics-only full, non-deduped timeline (`--debug-show-all-frames`)
 * if its metadata file is present, pairing each entry with its on-disk image
 * and carrying the per-frame dedupe signals (`prevDiff`, `keptByDedupe`)
 * through to the report. Returns null when the run wasn't a debug run.
 */
function loadDebugAllFrames(opts: ReadAnnotatedTimelineArtifactOptions): AnnotatedFrame[] | null {
  const jsonPath = path.join(opts.artifacts.dir, DEBUG_FRAMES_METADATA_FILENAME);
  if (!fs.existsSync(jsonPath)) return null;
  let metas: DebugFrameMetadata[];
  try {
    metas = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as DebugFrameMetadata[];
  } catch (err) {
    console.warn(chalk.yellow(`shaka-perf: ${jsonPath} unparseable, skipping debug timeline: ${(err as Error).message}`));
    return null;
  }
  if (metas.length === 0) return [];
  console.log(chalk.dim(`annotated-timeline: [debug] preparing ${metas.length} full-stream report frame${metas.length === 1 ? '' : 's'}`));
  return metas.map((meta) => {
    const frame: AnnotatedFrame = {
      timeMs: meta.timeMs,
      imgW: meta.imgW,
      imgH: meta.imgH,
      keptByDedupe: meta.keptByDedupe,
      ...(meta.prevDiff != null ? { prevDiff: meta.prevDiff } : {}),
    };
    const imageAbsPath = path.join(opts.artifacts.dir, meta.imageFilename);
    if (!fs.existsSync(imageAbsPath)) return frame;
    frame.imageHref = opts.artifacts.pathFor(meta.imageFilename);
    return frame;
  });
}

/**
 * Read `timeline_frames.json` (written by the worker) when present. If that
 * metadata is missing, scan current per-frame `timeline_frame_*ms` images
 * on disk and persist reconstructed metadata so subsequent renders don't
 * re-probe image dimensions.
 */
async function loadOrReconstructFramesMetadata(perTestDir: string): Promise<FrameMetadata[] | null> {
  const jsonPath = path.join(perTestDir, FRAMES_METADATA_FILENAME);
  if (fs.existsSync(jsonPath)) {
    try {
      const metas = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as FrameMetadata[];
      console.log(chalk.dim(`annotated-timeline: loaded ${metas.length} cached frame metadata entr${metas.length === 1 ? 'y' : 'ies'}`));
      return metas;
    } catch (err) {
      console.warn(chalk.yellow(`shaka-perf: ${jsonPath} unparseable, rescanning: ${(err as Error).message}`));
    }
  }
  if (!fs.existsSync(perTestDir)) return null;
  const files = fs.readdirSync(perTestDir).filter((f) => /^timeline_frame_[\d.]+ms\.(?:jpe?g|avif|webp)$/.test(f));
  if (files.length === 0) return null;
  console.log(chalk.dim(`annotated-timeline: reconstructing metadata from ${files.length} frame image${files.length === 1 ? '' : 's'}`));
  const metas: FrameMetadata[] = [];
  for (const f of files) {
    const m = f.match(/^timeline_frame_([\d.]+)ms\.(?:jpe?g|avif|webp)$/);
    if (!m) continue;
    const timeMs = parseFloat(m[1]);
    try {
      const probe = await sharp(path.join(perTestDir, f)).metadata();
      metas.push({
        timeMs,
        imgW: probe.width ?? 0,
        imgH: probe.height ?? 0,
        imageFilename: f,
      });
    } catch (err) {
      console.warn(chalk.yellow(`shaka-perf: failed to probe ${f}: ${(err as Error).message}`));
    }
  }
  metas.sort((a, b) => a.timeMs - b.timeMs);
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(metas));
  } catch {
    // best-effort cache; not fatal if the dir is read-only
  }
  return metas;
}
