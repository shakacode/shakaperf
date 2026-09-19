/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { Page, Request } from 'playwright-core';

const DEFAULT_TIMEOUT_MS = 60_000;
const QUIET_MS = 500;
const POLL_MS = 100;
const LOG_PREFIX = '[waitForNetworkSettle]';

export interface WaitForNetworkSettleOptions {
  /** How long to wait for the network to settle before giving up. Default 60 000 ms. */
  timeout?: number;
}

/**
 * Wait until the page has finished loading and there has been no network or
 * main-thread activity for 500 ms. Throws on timeout so screenshots are not
 * captured while network activity is still ongoing.
 *
 * Not Playwright's `networkidle`: in perf runs Playwright attaches after
 * Lighthouse has started navigating, never sees the requests already in
 * flight, and reports "idle" once, for good. Instead, two views of activity
 * must both be quiet:
 * - the page's own Resource Timing and Long Task records, which cover the
 *   whole load (a long task counts because the app sends its data requests
 *   only after its startup JS finishes);
 * - requests Playwright has seen start, which covers requests still in flight
 *   (Resource Timing records a request only once it completes).
 */
export async function waitForNetworkSettle(
  page: Page,
  { timeout = DEFAULT_TIMEOUT_MS }: WaitForNetworkSettleOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();
  const requests = trackRequests(page);
  try {
    for (let left = timeout; left > 0; left = start + timeout - Date.now()) {
      const pageQuietMs = await orAfter(readPageQuietMs(page), left, 0);
      if (requests.inflight() === 0 && Math.min(pageQuietMs, requests.quietMs()) >= QUIET_MS) {
        console.log(chalk.green(`${LOG_PREFIX} network idle for ${url} (${Date.now() - start} ms)`));
        return;
      }
      await sleep(POLL_MS);
    }
    throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
  } finally {
    requests.stop();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves to `fallback` if `promise` takes longer than `ms`. */
function orAfter<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(resolve, ms, fallback);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Requests Playwright sees from now on. A Set, not a counter: requests that
 *  started before we subscribed still emit a finish event. */
function trackRequests(page: Page) {
  const inflight = new Set<Request>();
  let lastEvent = Date.now();
  const started = (request: Request) => {
    inflight.add(request);
    lastEvent = Date.now();
  };
  const ended = (request: Request) => {
    inflight.delete(request);
    lastEvent = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return {
    inflight: () => inflight.size,
    quietMs: () => Date.now() - lastEvent,
    stop() {
      page.off('request', started);
      page.off('requestfinished', ended);
      page.off('requestfailed', ended);
    },
  };
}

/** A navigation mid-read counts as activity; the next poll reads the new document. */
async function readPageQuietMs(page: Page): Promise<number> {
  try {
    return await page.evaluate(pageQuietMs);
  } catch (err) {
    if (/Execution context was destroyed|navigation/i.test((err as Error).message ?? '')) return 0;
    throw err;
  }
}

// Runs in the page: ms since the last finished resource or long task, 0 until
// the document has loaded. Observers are installed once per document with
// `buffered`, so they replay what happened before Playwright attached. That
// replay arrives asynchronously, so installing counts as activity.
function pageQuietMs(): number {
  const w = window as unknown as { __shakaperfLastActivity?: number };
  if (w.__shakaperfLastActivity === undefined) {
    w.__shakaperfLastActivity = performance.now();
    const track = (type: string, end: (entry: PerformanceEntry) => number) => {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__shakaperfLastActivity = Math.max(w.__shakaperfLastActivity!, end(entry));
        }
      }).observe({ type, buffered: true });
    };
    track('resource', (entry) => (entry as PerformanceResourceTiming).responseEnd);
    track('longtask', (entry) => entry.startTime + entry.duration);
  }
  return document.readyState === 'complete' ? performance.now() - w.__shakaperfLastActivity : 0;
}
