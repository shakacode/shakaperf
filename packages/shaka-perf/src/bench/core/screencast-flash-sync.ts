/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

import { syncFlashMarkName } from '../../pipeline/sync-flash-overlay';
import {
  CHANGE_DETECTION_MIN_CHANGE_FRACTION,
  decodeJpeg,
  detectChangeFrames,
  scaleJpegToCompareDims,
  type DedupedScreencastSyncResult,
  type Screenshot,
} from './timeline-comparison';

/**
 * Video <-> trace clock sync via the flash markers the perf worker paints on
 * the page (see pipeline/sync-flash-overlay.ts): a full-viewport yellow
 * canvas with red `SHAKA-PERF START` / `SHAKA-PERF END`, each painted in the
 * same animation frame as a `performance.mark`. The trace carries the marks
 * with navigation-relative times; the video carries the flashes. Matching
 * the two gives one authoritative (video time, trace time) pair per marker,
 * and two pairs also absorb any drift between the screencast and trace
 * clocks. Flash frames are dropped from the synced stream so they never show
 * up in the timeline.
 */

/** Minimal shape of the trace events the sync reads. */
export interface FlashSyncTraceEvent {
  timeMs: number;
  label: string;
  category: string;
}

export interface FlashMarkerTimes {
  startMs: number;
  endMs: number;
}

/** A frame's OCR text (uppercase letters, digits, '-' and spaces only). */
export type FlashOcr = (jpeg: Buffer) => Promise<string>;

export interface FlashSyncOptions {
  /** Cap frames entering dedupe, after detecting markers on the full stream. */
  limitVideoFramesCount?: number;
  ocr?: FlashOcr;
  log?: (message: string) => void;
}

// A frame whose sampled pixels are at least this yellow is a flash candidate.
// The red text covers well under half of the flash, and no ordinary page frame
// is more than half pure yellow.
export const FLASH_YELLOW_MIN_FRACTION = 0.5;
// Width the frames are downscaled to for the visual-change dedupe.
const DEDUPE_COMPARE_WIDTH = 240;

export function isFlashYellow(r: number, g: number, b: number): boolean {
  return r > 180 && g > 180 && b < 120;
}

function isFlashRed(r: number, g: number, b: number): boolean {
  return r > 150 && g < 110 && b < 110;
}

// Width the cropped marker text is upscaled to before OCR.
const OCR_TEXT_WIDTH = 900;

/**
 * Isolate the red marker text for OCR: crop the frame to the red pixels'
 * bounding box (with padding), binarise it to black-on-white, and upscale.
 * A single text line lost in a tall yellow frame is exactly what tesseract's
 * page segmentation misses; the crop turns it into a clean single line.
 * Returns null when the frame has no red text.
 */
export async function prepareFlashTextImage(jpeg: Buffer): Promise<Buffer | null> {
  const { width, height, data } = decodeJpeg(jpeg);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isFlashRed(data[i], data[i + 1], data[i + 2])) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || maxX - minX < 8 || maxY - minY < 4) return null;
  const pad = Math.max(4, Math.round((maxY - minY) * 0.5));
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(width, maxX + 1 + pad);
  const bottom = Math.min(height, maxY + 1 + pad);
  const cw = right - left;
  const ch = bottom - top;
  const mono = Buffer.alloc(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((top + y) * width + (left + x)) * 4;
      mono[y * cw + x] = isFlashRed(data[i], data[i + 1], data[i + 2]) ? 0 : 255;
    }
  }
  return sharp(mono, { raw: { width: cw, height: ch, channels: 1 } })
    .resize({ width: OCR_TEXT_WIDTH, kernel: 'lanczos3' })
    // Tesseract warns and guesses on a missing/odd DPI; stamp a sane one.
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}

/** Fraction of (every-other-pixel sampled) pixels that read as flash yellow. */
export function yellowFraction(decoded: { width: number; height: number; data: Uint8Array }): number {
  const { width, height, data } = decoded;
  if (width === 0 || height === 0) return 0;
  let yellow = 0;
  let total = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      total++;
      if (isFlashYellow(data[i], data[i + 1], data[i + 2])) yellow++;
    }
  }
  return yellow / total;
}

export interface FrameRun {
  firstIdx: number;
  lastIdx: number;
}

/** Consecutive index runs where `isCandidate` holds. */
export function findRuns(isCandidate: readonly boolean[]): FrameRun[] {
  const runs: FrameRun[] = [];
  for (let i = 0; i < isCandidate.length; i++) {
    if (!isCandidate[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.lastIdx === i - 1) last.lastIdx = i;
    else runs.push({ firstIdx: i, lastIdx: i });
  }
  return runs;
}

export function findFlashMarksInTrace(events: readonly FlashSyncTraceEvent[]): FlashMarkerTimes {
  const find = (marker: 'start' | 'end'): number => {
    const name = syncFlashMarkName(marker);
    const hit = events.find((e) => e.category === 'user-timing' && e.label === name);
    if (!hit) throw new Error(`shaka-perf: flash video<->trace sync found no \`${name}\` mark in the trace; the ${marker.toUpperCase()} flash was not emitted`);
    return hit.timeMs;
  };
  return { startMs: find('start'), endMs: find('end') };
}

/** OCR text -> which marker it names. Lenient on the usual glyph confusions. */
export function classifyFlashText(text: string): 'start' | 'end' | null {
  const t = text.toUpperCase();
  if (/ST[A4]?RT|STAR/.test(t)) return 'start';
  if (/E[N]?[D0O]\b|END/.test(t)) return 'end';
  return null;
}

/**
 * Map raw video time onto the trace clock: the line through the START and
 * END (video, trace) pairs, so a rate difference between the screencast and
 * trace clocks is absorbed along with the offset.
 */
export function buildFlashClockMap(video: FlashMarkerTimes, trace: FlashMarkerTimes): (videoMs: number) => number {
  const videoSpan = video.endMs - video.startMs;
  const traceSpan = trace.endMs - trace.startMs;
  if (videoSpan <= 0 || traceSpan <= 0) {
    throw new Error(
      `shaka-perf: flash video<->trace sync got a non-positive START->END span (video ${Math.round(videoSpan)}ms, trace ${Math.round(traceSpan)}ms)`,
    );
  }
  const rate = traceSpan / videoSpan;
  return (v) => trace.startMs + (v - video.startMs) * rate;
}

async function defaultOcr(): Promise<{ ocr: FlashOcr; dispose: () => Promise<void> }> {
  const cachePath = join(homedir(), '.cache', 'shaka-perf', 'tesseract');
  mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker('eng', undefined, { cachePath, logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: 'SHAKPERFTNDO0- ',
    // Single text line: the crop from prepareFlashTextImage is exactly that.
    tessedit_pageseg_mode: '7' as never,
    user_defined_dpi: '300',
  });
  return {
    ocr: async (jpeg) => {
      const text = await prepareFlashTextImage(jpeg);
      return text ? (await worker.recognize(text)).data.text : '';
    },
    dispose: () => worker.terminate().then(() => undefined),
  };
}

/**
 * Sync the screencast onto the trace clock via the flash markers, drop the
 * flash frames, and dedupe the rest down to visual-change frames for the
 * timeline. `rawSyncedScreenshots` keeps every non-flash frame surviving the
 * optional cap (remapped), so later stages can restore frames removed by
 * dedupe. Both markers are
 * required in the trace and in the video: a missing one means the capture is
 * broken, and a guessed clock would only hide that behind mistimed frames.
 */
export async function syncVideoToTraceViaFlashMarkers(
  events: readonly FlashSyncTraceEvent[],
  videoShots: Screenshot[],
  opts: FlashSyncOptions = {},
): Promise<DedupedScreencastSyncResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  if (videoShots.length === 0) {
    throw new Error('shaka-perf: flash video<->trace sync requires at least one screencast frame');
  }
  const traceMarks = findFlashMarksInTrace(events);

  // Retain only candidate flags, never the full stream of decoded RGBA images.
  const runs = findRuns(videoShots.map((s) =>
    yellowFraction(decodeJpeg(s.snapshot)) >= FLASH_YELLOW_MIN_FRACTION));

  let ocr = opts.ocr;
  let dispose: (() => Promise<void>) | undefined;
  if (!ocr && runs.length > 0) ({ ocr, dispose } = await defaultOcr());
  const flashFrames = new Set<number>();
  const videoMarks: { startMs?: number; endMs?: number } = {};
  try {
    for (const run of runs) {
      const mid = Math.floor((run.firstIdx + run.lastIdx) / 2);
      const text = ocr ? await ocr(videoShots[mid].snapshot) : '';
      const marker = classifyFlashText(text);
      if (!marker) {
        log(`flash sync: yellow frames ${run.firstIdx}-${run.lastIdx} read as ${JSON.stringify(text.trim())}, not a marker; kept`);
        continue;
      }
      for (let i = run.firstIdx; i <= run.lastIdx; i++) flashFrames.add(i);
      // First frame of the run: the mark is timed to the frame that first shows it.
      const timeMs = videoShots[run.firstIdx].timeMs;
      if (marker === 'start') videoMarks.startMs ??= timeMs;
      else videoMarks.endMs = timeMs;
    }
  } finally {
    await dispose?.();
  }
  for (const marker of ['start', 'end'] as const) {
    if (videoMarks[`${marker}Ms`] == null) {
      throw new Error(
        `shaka-perf: flash video<->trace sync found no SHAKA-PERF ${marker.toUpperCase()} flash in the screencast (${runs.length} yellow run${runs.length === 1 ? '' : 's'} checked)`,
      );
    }
  }
  const toTraceMs = buildFlashClockMap(
    { startMs: videoMarks.startMs!, endMs: videoMarks.endMs! },
    traceMarks,
  );

  // Detect markers before applying the cap: even a short flash between two
  // retained frames must contribute its original first-frame timestamp.
  const limit = opts.limitVideoFramesCount ?? 0;
  const indices = videoShots.map((_, i) => i);
  const sampledIndices = limit > 0 && indices.length > limit
    ? Array.from({ length: limit }, (_, i) => limit === 1 ? 0 : Math.round(i * (indices.length - 1) / (limit - 1)))
    : indices;
  const frameCapDropped = videoShots.length - sampledIndices.length;
  const rawSyncedScreenshots = sampledIndices
    .filter((i) => !flashFrames.has(i))
    .map((i) => ({ ...videoShots[i], timeMs: toTraceMs(videoShots[i].timeMs) }));

  const first = rawSyncedScreenshots.length > 0
    ? await sharp(rawSyncedScreenshots[0].snapshot).metadata()
    : undefined;
  const compareW = first?.width ? Math.min(DEDUPE_COMPARE_WIDTH, first.width) : DEDUPE_COMPARE_WIDTH;
  const compareH = first?.width && first.height ? Math.max(1, Math.round((compareW * first.height) / first.width)) : 1;
  const changes = await detectChangeFrames(
    rawSyncedScreenshots,
    compareW,
    compareH,
    async (i) => scaleJpegToCompareDims(rawSyncedScreenshots[i].snapshot, compareW, compareH),
    CHANGE_DETECTION_MIN_CHANGE_FRACTION,
  );
  const screenshots = changes.map((c) => rawSyncedScreenshots[c.shotIdx]);
  return {
    screenshots,
    rawSyncedScreenshots,
    stats: {
      inputFrameCount: sampledIndices.length,
      frameCapDropped,
      keptFrameCount: screenshots.length,
      removedFrameCount: Math.max(0, sampledIndices.length - screenshots.length),
    },
  };
}
