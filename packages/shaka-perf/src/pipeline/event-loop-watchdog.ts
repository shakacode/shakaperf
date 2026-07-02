/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import chalk from 'chalk';

// 1s ≈ "you forgot to break this into chunks / move it off the main
// thread". Below that, regular GC pauses and incidental file I/O cause
// false positives at high parallelism.
const BLOCK_THRESHOLD_MS = 1000;
const POLL_INTERVAL_MS = 500;
// 50ms resolution = 20 samples/s — fine-grained enough that a 1s+ block
// always shows up, coarse enough that libuv's hook overhead is negligible.
const HISTOGRAM_RESOLUTION_MS = 50;

interface Watchdog {
  histogram: IntervalHistogram;
  timer: NodeJS.Timeout;
}

let watchdog: Watchdog | null = null;

/**
 * Background watchdog that flags long synchronous main-thread blocks.
 *
 * `monitorEventLoopDelay` keeps a libuv-level histogram of the lag
 * between when a probe was supposed to fire and when it actually did,
 * so it sees the block even when the main thread is too busy to run JS
 * timers. Every POLL_INTERVAL_MS we read `max`, reset, and red-warn if
 * the worst delay in that window crossed BLOCK_THRESHOLD_MS.
 *
 * Detection is symptom-based: by the time the loop unblocks and our
 * timer fires, V8's stack of the offending code is already gone, so
 * the warning names the duration but not the location. Treat hits as
 * "go find the heavy synchronous call and either chunk it or route it
 * through a `worker_threads.Worker`". Pool-slot membership doesn't
 * help here — pool tasks run on the main thread too; only the
 * native-bound asyncs they `await` (sharp, ffmpeg child process) move
 * work off-thread.
 */
export function installEventLoopWatchdog(): void {
  if (watchdog) return;
  const histogram = monitorEventLoopDelay({ resolution: HISTOGRAM_RESOLUTION_MS });
  histogram.enable();
  const timer = setInterval(() => {
    const maxMs = histogram.max / 1e6;
    histogram.reset();
    if (maxMs < BLOCK_THRESHOLD_MS) return;
    console.log(chalk.red(
      `event-loop blocked for ${maxMs.toFixed(0)}ms — heavy synchronous work on the main thread. ` +
      'Move it into a worker_threads worker, or chunk it so it yields between batches.',
    ));
  }, POLL_INTERVAL_MS);
  // Don't prolong process lifetime once the pipeline is done; explicit
  // `disposeEventLoopWatchdog` still tears it down cleanly when callers
  // know they're finished.
  timer.unref();
  watchdog = { histogram, timer };
}

export function disposeEventLoopWatchdog(): void {
  if (!watchdog) return;
  clearInterval(watchdog.timer);
  watchdog.histogram.disable();
  watchdog = null;
}
