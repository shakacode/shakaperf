/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { BrowserContext, Page, Request } from 'playwright-core';

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
 * - requests tracked from before navigation, which covers requests still in flight
 *   (Resource Timing records a request only once it completes).
 *
 * Call installNetworkTracking on the context before navigation to include
 * requests that start before this helper. Without it, we also wait for
 * Playwright's initial networkidle state, preserving standalone load behavior.
 */
export async function waitForNetworkSettle(
  page: Page,
  { timeout = DEFAULT_TIMEOUT_MS }: WaitForNetworkSettleOptions = {},
): Promise<void> {
  const url = page.url();
  const start = Date.now();
  const tracked = contextTrackers.get(page.context());
  const localRequests = tracked ? undefined : trackRequests(page);
  const requests = tracked ? tracked(page) : localRequests!;
  try {
    if (!tracked) {
      const idle = page.waitForLoadState('networkidle', { timeout }).then(() => true);
      if (!(await orAfter(idle, timeout, false))) {
        throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
      }
    }
    for (let left = start + timeout - Date.now(); left > 0; left = start + timeout - Date.now()) {
      const pageQuietMs = await orAfter(readPageQuietMs(page), left, 0);
      if (requests.inflight() === 0 && Math.min(pageQuietMs, requests.quietMs()) >= QUIET_MS) {
        console.log(chalk.green(`${LOG_PREFIX} network idle for ${url} (${Date.now() - start} ms)`));
        return;
      }
      await sleep(POLL_MS);
    }
    throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new Error(`${LOG_PREFIX} timed out after ${timeout} ms for ${url}`);
    }
    throw err;
  } finally {
    localRequests?.stop();
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

const isInMemoryUrl = (request: Request): boolean => /^(blob|data):/.test(request.url());

function requestState() {
  const inflight = new Set<Request>();
  let lastEvent = Date.now();
  return {
    started(request: Request) {
      if (isInMemoryUrl(request)) return;
      inflight.add(request);
      lastEvent = Date.now();
    },
    ended(request: Request) {
      if (isInMemoryUrl(request)) return;
      inflight.delete(request);
      lastEvent = Date.now();
    },
    inflight: () => inflight.size,
    quietMs: () => Date.now() - lastEvent,
  };
}

type ContextTrackers = WeakMap<BrowserContext, (page: Page) => ReturnType<typeof requestState>>;

// The CLI and the project's test files each load their own copy of this module (the project
// installs shaka-shared next to its tests, the CLI ships its own), so a module-level map would
// leave a tracker installed by the CLI invisible to a settle wait called from a test body.
// The registry lives on globalThis so every copy in the process sees the same trackers.
const TRACKERS_KEY = Symbol.for('shaka-shared.networkTracking.contextTrackers');
const contextTrackers: ContextTrackers = ((globalThis as Record<symbol, unknown>)[TRACKERS_KEY] ??= new WeakMap()) as ContextTrackers;

/** Install once, before navigation, so settle waits include already-pending requests.
 * Context events cover new pages (including Lighthouse-created pages) and frames.
 * State lives for the context lifetime; finishing one wait must not stop tracking.
 */
export function installNetworkTracking(context: BrowserContext): void {
  if (contextTrackers.has(context)) return;
  const pages = new WeakMap<Page, ReturnType<typeof requestState>>();
  const stateFor = (page: Page) => {
    let state = pages.get(page);
    if (!state) {
      state = requestState();
      pages.set(page, state);
    }
    return state;
  };
  const stateForRequest = (request: Request) => {
    // Service worker requests have no frame and do not belong to a page.
    if (request.serviceWorker()) return undefined;
    try {
      return stateFor(request.frame().page());
    } catch {
      // The initial navigation can precede frame creation. Its completion is
      // covered by the document.readyState check in pageQuietMs.
      return undefined;
    }
  };
  const started = (request: Request) => stateForRequest(request)?.started(request);
  const ended = (request: Request) => stateForRequest(request)?.ended(request);
  context.on('request', started);
  context.on('requestfinished', ended);
  context.on('requestfailed', ended);
  contextTrackers.set(context, stateFor);
  context.once('close', () => {
    context.off('request', started);
    context.off('requestfinished', ended);
    context.off('requestfailed', ended);
    contextTrackers.delete(context);
  });
}

/** Standalone fallback: track requests that start during this wait. */
function trackRequests(page: Page) {
  const state = requestState();
  page.on('request', state.started);
  page.on('requestfinished', state.ended);
  page.on('requestfailed', state.ended);
  return {
    ...state,
    stop() {
      page.off('request', state.started);
      page.off('requestfinished', state.ended);
      page.off('requestfailed', state.ended);
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
