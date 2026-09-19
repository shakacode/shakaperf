/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page } from 'playwright-core';

import { SHAKA_PERF_MARK_PREFIX } from '../bench/core/timeline-comparison';

export type SyncFlashMarker = 'start' | 'end';

/** `performance.mark` name for a marker: `shaka-perf-start` / `shaka-perf-end`. */
export const syncFlashMarkName = (marker: SyncFlashMarker): string => `${SHAKA_PERF_MARK_PREFIX}${marker}`;
/** Text painted on the flash: `SHAKA-PERF START` / `SHAKA-PERF END`. */
export const syncFlashText = (marker: SyncFlashMarker): string => `SHAKA-PERF ${marker.toUpperCase()}`;

// How long the flash stays up. Three 60fps screencast frames is enough for
// the video to carry it; keeping it short bounds its effect on Speed Index
// (the flash is a fully-visible-then-gone frame in Lighthouse's filmstrip).
export const SYNC_FLASH_HOLD_MS = 50;

// Injected into the page. Paints a full-viewport yellow canvas with the red
// marker text and emits the performance.mark in the animation frame AFTER the
// one that paints it: that callback runs right after the flash frame was
// presented, so the mark's trace time matches the first flashed video frame's
// screencast timestamp (which is presentation time) instead of leading it. A
// canvas (not a text node) is used on purpose: canvas is not an LCP candidate,
// so the flash cannot become the page's largest contentful paint. It sits on
// documentElement with pointer-events off, so it never intercepts the test's
// clicks, and the returned promise resolves only after the canvas is gone
// and the next frame painted, so nothing the test does lands on the flash.
function flashScript(opts: { text: string; mark: string; holdMs: number }): Promise<void> {
  return new Promise<void>((resolve) => {
    const root = document.documentElement;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.position = 'fixed';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.zIndex = '2147483647';
    canvas.style.pointerEvents = 'none';
    // A fixed element spans the LAYOUT viewport, but the screencast shows the
    // VISUAL viewport, which is a zoomed-in part of it once a focused input
    // has pinch-zoomed a mobile page. Centre and size the text on the visual
    // viewport so it is fully in frame either way; the yellow fills both.
    const vv = window.visualViewport;
    const vx = vv ? vv.offsetLeft : 0;
    const vy = vv ? vv.offsetTop : 0;
    const vw = vv ? vv.width : w;
    const vh = vv ? vv.height : h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#ffff00';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff0000';
      ctx.font = '700 ' + Math.floor(vw / 12) + 'px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.text, vx + vw / 2, vy + vh / 2);
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      canvas.remove();
      resolve();
    };
    root.appendChild(canvas);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        performance.mark(opts.mark);
        setTimeout(() => {
          canvas.remove();
          requestAnimationFrame(finish);
        }, opts.holdMs);
      });
    });
    // A throttled/hidden page may starve requestAnimationFrame; never hang the
    // sample on the flash.
    setTimeout(finish, opts.holdMs + 1000);
  });
}

/**
 * Flash the START / END sync marker on `page`. A rejected evaluate (page
 * mid-teardown) is logged, not thrown: the END flash runs in the test's
 * `finally`, where a throw would replace the test's own error. A missed flash
 * still fails loudly, one stage later, when the timeline sync finds no marker.
 */
export async function flashSyncMarker(page: Page, marker: SyncFlashMarker): Promise<void> {
  try {
    await page.evaluate(flashScript, {
      text: syncFlashText(marker),
      mark: syncFlashMarkName(marker),
      holdMs: SYNC_FLASH_HOLD_MS,
    });
  } catch (err) {
    console.warn(`[shaka-perf sync-flash] ${marker} flash failed: ${(err as Error).message}`);
  }
}
