/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import sharp from 'sharp';

import { pipeAndFilterStderr } from './ffmpeg-stderr';
import { SCREENCAST_FILENAME, SCREENCAST_START_FILENAME } from './lighthouse-config';

/**
 * Process-singleton screencast recorder with three "buttons" — `record()`,
 * `stop()`, `save()`. The Lighthouse worker presses all three every sample,
 * unconditionally; the module owns the no-op-when-disabled guarantee. Every
 * moving part lives in here:
 *
 * - the `armed` flag + captured session + frame buffer,
 * - capture start: the barrier's `__shakaperfBeforePageNavigate` hands us
 *   Lighthouse's OWN protocol session via `onNavigate()` at navigationStart; we
 *   start the screencast there only when armed (so capture truly begins at
 *   navigationStart, catching the first blank/white paint),
 * - the auto-cut: `__shakaperfOnMeasuringDone` (fired by lighthouse.patch, not
 *   the barrier — so it stays a global slot) cuts at the LH measured-window
 *   boundary,
 * - the cut/await coordination (the "waiting" — `stop()` joins the in-flight
 *   auto-cut instead of cutting twice),
 * - the ffmpeg encode.
 *
 * Exactly one recording is live at a time (samples run sequentially per worker);
 * `record(enabled)` resets state for a fresh one and arms (or disarms) it, so a
 * non-recording sample on a reused worker can never inherit stale frames.
 */

export interface ScreencastSession {
  frames: { timeMs: number; data: string }[];
  stop: () => Promise<void>;
}

/**
 * The shape of the `session` object Lighthouse's patched navigation.js hands to
 * `__shakaperfBeforePageNavigate`, which the barrier forwards to our
 * `onNavigate()`. We only use `on`/`off` for the two events we care about and
 * `sendCommand` to drive the CDP calls.
 */
interface LighthouseSession {
  sendCommand: (method: string, params?: object) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
}

// Whether the current sample wants a recording. The worker presses `record()`
// every sample; only an armed one captures, so `onNavigate()` (called by the
// barrier on EVERY navigation) and `save()` know to no-op otherwise.
let armed = false;
// The capture for the current sample, set by `onNavigate`; null until LH
// navigates (or forever, if this sample never started capture).
let session: ScreencastSession | null = null;
// The in-flight CUT kicked off by the measuring-done hook on the happy path.
// `stop()` awaits it (rather than cutting again) so the cut coincides exactly
// with Lighthouse; undefined until something cuts.
let cutPromise: Promise<void> | undefined;

async function cut(): Promise<void> {
  await session?.stop();
}

export const screencastRecorder = {
  /**
   * RECORD: reset state for a fresh sample and arm (or disarm) it. Resetting
   * `session` every sample is what lets the worker press all three buttons
   * unconditionally — a non-recording sample on a reused worker drops the prior
   * sample's frames instead of re-encoding them. When armed, installs the
   * measuring-done slot (fired by lighthouse.patch) that auto-cuts the instant
   * Lighthouse's measured window ends — keeping the late paints LH still
   * captured, dropping the scoring phase that follows. The cut is kicked off,
   * not awaited, from the slot so it never blocks LH's hot path; `stop()` does
   * the awaiting. Capture itself starts later, in `onNavigate`.
   */
  record(enabled: boolean): void {
    armed = enabled;
    session = null;
    cutPromise = undefined;
    if (enabled) {
      (globalThis as Record<string, unknown>).__shakaperfOnMeasuringDone = () => {
        cutPromise ??= cut();
      };
    } else {
      delete (globalThis as Record<string, unknown>).__shakaperfOnMeasuringDone;
    }
  },

  /**
   * Start capture on Lighthouse's own protocol session. The barrier's
   * `__shakaperfBeforePageNavigate` calls this after its sync, the instant LH is
   * about to navigate, so the stream begins at navigationStart. No-op unless
   * this sample armed via `record(true)`.
   */
  async onNavigate(lhSession?: unknown): Promise<void> {
    if (!armed || !lhSession) return;
    try {
      session = await startScreencastOnLighthouseSession(lhSession as LighthouseSession);
    } catch (err) {
      console.warn('[shaka-perf screencast] start on LH session threw:', err);
    }
  },

  /**
   * STOP: cut + clean up. Drops the measuring-done slot (so it can't fire into
   * the next sample on this worker), then awaits the in-flight auto-cut — or
   * cuts now if the measuring boundary was never reached (e.g. LH timed out, or
   * the sample threw before measuring). Idempotent: a second call awaits the
   * already-resolved cut and re-deletes the already-absent slot.
   */
  async stop(): Promise<void> {
    delete (globalThis as Record<string, unknown>).__shakaperfOnMeasuringDone;
    await (cutPromise ??= cut());
  },

  /**
   * SAVE: encode whatever was captured (and already cut) into `screencast.mp4`
   * under `resultsFolder`, plus the `screencast_start.json` origin marker.
   * Returns whether a video was written. Encode/write failures are logged here;
   * the worker decides whether a missing final file is fatal for that sample.
   */
  async save(resultsFolder: string, sampleLabel: string): Promise<boolean> {
    if (!session || session.frames.length === 0) return false;
    try {
      await encodeScreencastVideo(session.frames, join(resultsFolder, SCREENCAST_FILENAME));
      // The encoder prepends a synthetic blank frame at t=0 (navigationStart), so
      // the AVIF/timeline extractor reads this start file as the origin. Kept
      // inside the try so a marker-write failure (results folder torn down,
      // ENOSPC, EACCES) warns and returns false like an encode failure.
      writeFileSync(
        join(resultsFolder, SCREENCAST_START_FILENAME),
        JSON.stringify({ firstFrameTimeMs: 0 }),
      );
    } catch (err) {
      const missingFfmpeg = (err as NodeJS.ErrnoException).code === 'ENOENT';
      console.warn(
        `[shaka-perf screencast] save failed for ${sampleLabel}` +
          (missingFfmpeg
            ? ' — ffmpeg not found on PATH; install via `brew install ffmpeg` or `apt install ffmpeg`'
            : `: ${(err as Error).message}`),
      );
      return false;
    }
    return true;
  },
};

/**
 * Encode captured JPEG frames into a constant-60fps × 500px-wide mp4.
 *
 * Each captured frame carries its real wall-clock-relative timeMs. We feed
 * ffmpeg's `concat` demuxer with per-frame `duration` directives so the
 * playback rate matches reality, then `-r 60 -vsync cfr` resamples to a
 * constant 60fps output (frames duplicated during idle stretches, dropped
 * during bursts faster than vsync). The result is a smooth video at the
 * resolution we already captured.
 *
 * Throws if ffmpeg isn't on PATH or exits non-zero — callers translate
 * ENOENT into an actionable install hint.
 */
async function encodeScreencastVideo(
  frames: { timeMs: number; data: string }[],
  outputPath: string,
): Promise<void> {
  if (frames.length === 0) return;
  const tmpDir = await mkdtemp(join(tmpdir(), 'shaka-screencast-'));
  try {
    // Generate a synthetic blank-white frame at t=0 matching the first
    // captured frame's dimensions. Chrome's compositor only emits screencast
    // frames on actual paints, so the pre-paint state isn't captured
    // organically. Prepending a blank frame gives the timeline a proper
    // "before navigation" reference frame.
    const firstJpegBuf = Buffer.from(frames[0].data, 'base64');
    const meta = await sharp(firstJpegBuf).metadata();
    const blankJpegBuf = await sharp({
      create: {
        width: meta.width ?? 500,
        height: meta.height ?? 450,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).jpeg({ quality: 60 }).toBuffer();
    const augmented: { timeMs: number; data: Buffer | string }[] = [
      { timeMs: 0, data: blankJpegBuf },
      ...frames,
    ];

    const fileNames: string[] = [];
    for (let i = 0; i < augmented.length; i++) {
      const name = `frame_${String(i).padStart(6, '0')}.jpg`;
      const buf = augmented[i].data instanceof Buffer
        ? augmented[i].data as Buffer
        : Buffer.from(augmented[i].data as string, 'base64');
      writeFileSync(join(tmpDir, name), buf);
      fileNames.push(name);
    }
    const lines: string[] = [];
    for (let i = 0; i < augmented.length; i++) {
      lines.push(`file '${fileNames[i]}'`);
      if (i < augmented.length - 1) {
        const durS = Math.max(0.001, (augmented[i + 1].timeMs - augmented[i].timeMs) / 1000);
        lines.push(`duration ${durS.toFixed(6)}`);
      } else {
        // Concat demuxer needs the last file repeated for its `duration` to
        // take effect; pad with a single-frame hold so the video doesn't end
        // abruptly.
        lines.push(`duration 0.016`);
        lines.push(`file '${fileNames[i]}'`);
      }
    }
    const concatPath = join(tmpDir, 'concat.txt');
    writeFileSync(concatPath, lines.join('\n') + '\n');

    const ff = spawn('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-r', '60',
      // `-vsync cfr` is the cross-version-compatible spelling of the newer
      // `-fps_mode cfr`. ffmpeg 4.x (default on Ubuntu 22.04 / Debian
      // bookworm) doesn't know `-fps_mode` and aborts with "Unrecognized
      // option"; ffmpeg 5.1+ accepts both but prefers `-fps_mode`. The
      // legacy alias is still honoured on 5/6/7 (deprecation warning only),
      // and `timeline-comparison.ts` already uses `-vsync` elsewhere.
      '-vsync', 'cfr',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      // Pin output width to 500 across all viewports — mobile emulation
      // captures at CSS-px resolution (e.g. phone 375 wide × DPR 3 = 1125
      // compositor, but the screencast comes out at the CSS-px size 375).
      // Lanczos resampling gives crisper text on mobile snapshots, and
      // `-2` keeps height proportional rounded to even (libx264 yuv420p
      // requires both dimensions to be even).
      '-vf', 'scale=500:-2:flags=lanczos',
      '-crf', '28',
      '-loglevel', 'error',
      outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    pipeAndFilterStderr(ff.stderr!);

    await new Promise<void>((resolve, reject) => {
      ff.on('error', reject); // includes ENOENT when ffmpeg isn't installed
      ff.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// A cross-origin renderer swap can leave the CDP session unattached for a few
// hundred ms, so the post-navigation re-subscribe is retried across that window
// (~3s) rather than abandoned on the first "Not attached to an active page".
export const SUBSCRIBE_RETRY_WINDOW_MS = 3000;
export const SUBSCRIBE_RETRY_DELAY_MS = 250;

/**
 * Start the screencast on Lighthouse's own ProtocolSession (handed to us via
 * the navigation-start patch). This runs *before* Page.navigate fires, so the
 * captured stream begins at the about:blank/blank white frame and covers the
 * entire load including FCP/LCP — earlier attempts that used Playwright's
 * `newCDPSession` either started post-DCL or hit `_channel`-related failures
 * because Lighthouse holds the primary debugger session.
 *
 * The trace's `disabled-by-default-devtools.screenshot` category is hardcoded
 * in Chromium (content/browser/devtools/protocol/tracing_handler.cc) to fit
 * frames inside 250×250 px — that's where our blurry thumbnails come from. The
 * screencast API has its own resolution cap (configurable via
 * `maxWidth`/`maxHeight`) and emits at Chrome's natural vsync rate when
 * `everyNthFrame` is 1.
 *
 * We record absolute wall-clock timestamps for each frame and use the moment
 * the hook fires as wallNavStartMs. Frame timeMs = (frame.metadata.timestamp
 * × 1000) − wallNavStartMs, so frames align with the trace's navigationStart.
 *
 * Frames arrive as `Page.screencastFrame` events; we ack each one
 * fire-and-forget so the renderer doesn't queue waiting for our round-trip
 * (chrome-php/chrome #540 reports dropped frames otherwise under CPU load).
 *
 * Site isolation can still swap renderers on cross-origin navigations (e.g.
 * about:blank → benchmark URL); we resubscribe in the Page.frameNavigated
 * handler so the new renderer keeps streaming.
 */
export async function startScreencastOnLighthouseSession(
  lhSession: LighthouseSession,
): Promise<ScreencastSession> {
  const frames: { timeMs: number; data: string }[] = [];
  let stopped = false;
  let subscriptionGeneration = 0;
  const activeSubscriptions = new Set<Promise<void>>();
  // Re-stamped after the initial subscription so a slow CDP attach cannot
  // shift every captured frame away from Lighthouse's navigation start.
  let wallNavStartMs = Date.now();

  // Stable handler references for off() in stop(). The patch's `session` is
  // Lighthouse's ProtocolSession; its `on()` callbacks receive the raw CDP
  // event payload directly.
  const onScreencastFrame = (...args: unknown[]) => {
    if (stopped) return;
    const evt = args[0] as { data: string; sessionId: number; metadata: { timestamp?: number } };
    if (typeof evt?.metadata?.timestamp === 'number') {
      frames.push({
        timeMs: evt.metadata.timestamp * 1000 - wallNavStartMs,
        data: evt.data,
      });
    }
    lhSession.sendCommand('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {});
  };
  const onFrameNavigated = (...args: unknown[]) => {
    if (stopped) return;
    const evt = args[0] as { frame: { parentId?: string; url?: string } };
    if (evt?.frame?.parentId) return; // sub-frames don't reset the screencast
    // Renderer-swap (cross-origin nav): re-arm.
    const generation = ++subscriptionGeneration;
    const subscription = subscribe(`after nav to ${evt.frame.url ?? '?'}`, generation, true);
    activeSubscriptions.add(subscription);
    void subscription.finally(() => activeSubscriptions.delete(subscription));
  };

  const subscribe = async (
    label: string,
    generation: number,
    retry: boolean,
  ): Promise<void> => {
    if (stopped) return;
    try {
      // Pin width to 500 device-px and let height be whatever the
      // viewport aspect implies. Chrome's screencast aspect-fits the
      // compositor frame inside (maxWidth, maxHeight); if both are 500,
      // tall viewports (especially DPR=3 phones, compositor 1125×2001)
      // hit the height constraint and end up < 500 wide. With maxHeight
      // raised, every viewport — desktop/tablet/phone — produces a
      // 500-wide frame, just with varying height.
      await startWithRetry(label, generation, retry);
    } catch (err) {
      console.warn(`[shaka-perf screencast] subscribe (${label}) failed:`, err);
    }
  };

  /**
   * A cross-origin renderer swap leaves the session briefly unattached, so the
   * re-subscribe fired from `Page.frameNavigated` can land while Chrome still
   * reports "Not attached to an active page". Giving up on that first error
   * kills the stream at the navigation, leaving the timeline with only the blank
   * pre-navigation frames (the whole load goes uncaptured). Retry across the
   * swap window instead — the new renderer attaches within a few hundred ms.
   */
  const startWithRetry = async (
    label: string,
    generation: number,
    retry: boolean,
  ): Promise<void> => {
    const deadline = Date.now() + (retry ? SUBSCRIBE_RETRY_WINDOW_MS : 0);
    let lastErr: unknown;
    let attempt = 0;
    do {
      if (stopped || generation !== subscriptionGeneration) return;
      attempt += 1;
      try {
        await lhSession.sendCommand('Page.startScreencast', {
          format: 'jpeg',
          quality: 60,
          maxWidth: 500,
          maxHeight: 4096,
          everyNthFrame: 1,
        });
        if (stopped) {
          await lhSession.sendCommand('Page.stopScreencast').catch(() => {});
          return;
        }
        if (generation !== subscriptionGeneration) return;
        if (attempt > 1) {
          console.log(
            `[shaka-perf screencast] subscribe (${label}) recovered on attempt ${attempt}`,
          );
        }
        return;
      } catch (err) {
        lastErr = err;
        if (!retry || Date.now() + SUBSCRIBE_RETRY_DELAY_MS >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, SUBSCRIBE_RETRY_DELAY_MS));
      }
    } while (!stopped && generation === subscriptionGeneration && Date.now() < deadline);
    throw lastErr;
  };

  lhSession.on('Page.screencastFrame', onScreencastFrame);
  lhSession.on('Page.frameNavigated', onFrameNavigated);
  const initialGeneration = ++subscriptionGeneration;
  await subscribe('initial', initialGeneration, false);
  wallNavStartMs = Date.now();

  return {
    frames,
    stop: async () => {
      stopped = true;
      subscriptionGeneration += 1;
      try { await lhSession.sendCommand('Page.stopScreencast'); } catch { /* already detached */ }
      await Promise.allSettled([...activeSubscriptions]);
      if (lhSession.off) {
        try { lhSession.off('Page.screencastFrame', onScreencastFrame); } catch { /* ignore */ }
        try { lhSession.off('Page.frameNavigated', onFrameNavigated); } catch { /* ignore */ }
      }
    },
  };
}
