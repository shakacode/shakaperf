/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import { isPublicHost } from '../../../net/public-host';
import { looksLikeBotWall, scanLandedOnBotWall } from '../../bot-wall';
import {
  isRealChromeEnabled,
  realChromeContextOptions,
  realChromeUsesNativeIdentity,
  waitForBotWallToClear,
} from '../../real-chrome';
import { launchStageBrowser, stageContextOptions } from '../../stage-browser';
import { resolveAgentReadinessConfig, type AgentReadinessEngineOptions, type AgentReadinessStageConfig } from './config';
import { extractPageSignals } from './extract';
import type { AgentReadinessResult, PageSignals, RawFetchResult } from './types';
import {
  matchRealChromeUserAgentVersion,
  realChromeUserAgentForFormFactor,
} from '../../../browser-user-agent';

interface AgentReadinessSlotState extends PoolWorkerState {
  agentReadinessBrowser?: Browser;
}

// A realistic browser UA: we want the server's NORMAL initial HTML (what it
// hands any first-time visitor before JS runs), not a bot-specific response and
// not a challenge page triggered by an obvious crawler UA. The copy only ever
// claims "the HTML your server returns before JavaScript runs", which is true
// for whatever UA we send.
const RAW_FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RAW_HTML_MAX_BYTES = 3 * 1024 * 1024;
const RAW_FETCH_MAX_REDIRECT_HOPS = 5;
const nativeUserAgentByBrowser = new WeakMap<Browser, Promise<string | undefined>>();

async function disposeAgentReadinessBrowser(state: Record<string, unknown>): Promise<void> {
  const slot = state as AgentReadinessSlotState;
  const browser = slot.agentReadinessBrowser;
  if (!browser) return;
  slot.agentReadinessBrowser = undefined;
  await browser.close().catch(() => {});
}

export async function runAgentReadinessStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: AgentReadinessStageConfig,
): Promise<AgentReadinessResult> {
  const resolved = resolveAgentReadinessConfig(config);
  return workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<AgentReadinessSlotState>(state, disposeAgentReadinessBrowser);
    if (!slot.agentReadinessBrowser) {
      slot.agentReadinessBrowser = await launchStageBrowser(
        resolved.engineOptions.playwrightOptions,
        ctx.runtime.headed,
      );
    }
    return scanAgentReadiness(ctx, slot.agentReadinessBrowser, resolved.engineOptions);
  }, { key: ctx.testAndViewportId });
}

// A no-JS fetch of the page. Bounded by timeout + a hard size cap (the body is
// parsed, not stored, but a runaway response should not pin memory). Never
// throws: a failed fetch returns ok:false so the report can say "we could not
// read the server HTML" instead of pretending the page was empty.
export async function fetchRawHtml(
  url: string,
  timeoutMs: number,
  userAgent = RAW_FETCH_UA,
): Promise<{ html: string | null; status?: number; contentType?: string; bytes?: number }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { html: null };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { html: null };
  if (!isPublicHost(target.hostname)) return { html: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const res = await fetch(target.href, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        if (redirects >= RAW_FETCH_MAX_REDIRECT_HOPS) return { html: null };
        const location = res.headers.get('location');
        if (!location) return { html: null };
        try {
          target = new URL(location, target);
        } catch {
          return { html: null };
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') return { html: null };
        if (!isPublicHost(target.hostname)) return { html: null };
        continue;
      }
      const contentType = res.headers.get('content-type') ?? undefined;
      const reader = res.body?.getReader();
      if (!reader) return { html: null, status: res.status, contentType };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > RAW_HTML_MAX_BYTES) {
          ctl.abort();
          break;
        }
        chunks.push(value);
      }
      const buf = new Uint8Array(total > RAW_HTML_MAX_BYTES ? RAW_HTML_MAX_BYTES : total);
      let offset = 0;
      for (const c of chunks) {
        if (offset + c.length > buf.length) {
          buf.set(c.subarray(0, buf.length - offset), offset);
          break;
        }
        buf.set(c, offset);
        offset += c.length;
      }
      const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      return { html, status: res.status, contentType, bytes: total };
    }
  } catch {
    return { html: null };
  } finally {
    clearTimeout(timer);
  }
}

export function rawFetchUserAgentFor(
  formFactor: string,
  browserVersion?: string,
  nativeUserAgent?: string,
  usesChromium = true,
): string {
  if (!usesChromium || !isRealChromeEnabled()) return RAW_FETCH_UA;
  if (realChromeUsesNativeIdentity(formFactor)) {
    return nativeUserAgent ?? RAW_FETCH_UA;
  }
  return matchRealChromeUserAgentVersion(
    realChromeUserAgentForFormFactor(formFactor),
    browserVersion,
  ) ?? RAW_FETCH_UA;
}

function nativeBrowserUserAgent(browser: Browser): Promise<string | undefined> {
  const existing = nativeUserAgentByBrowser.get(browser);
  if (existing) return existing;
  const lookup = (async () => {
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext();
      const page = await context.newPage();
      return await page.evaluate(() => navigator.userAgent);
    } catch (err) {
      console.warn(
        chalk.yellow(
          `[shaka-perf agent] could not read native browser user agent: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
      return undefined;
    } finally {
      await context?.close().catch(() => {});
    }
  })();
  nativeUserAgentByBrowser.set(browser, lookup);
  return lookup;
}

async function readRenderedSignals(
  ctx: TestContext,
  browser: Browser,
  engineOptions: AgentReadinessEngineOptions,
): Promise<{ signals: PageSignals; htmlBytes: number; blocked: boolean }> {
  let context: BrowserContext | undefined;
  try {
    // Deliberately anonymous and body-free: agent-readiness models what an AI
    // crawler sees when it lands on the URL cold — no cookies, no auth, no
    // beforeNavigate hook, and NOT the test body. Running any of those would
    // measure a page state (post-login, post-consent, post-interaction) that no
    // crawler ever reaches, which is the opposite of what this metric means.
    context = await browser.newContext({
      ...stageContextOptions(ctx.viewport, engineOptions.playwrightOptions),
      ...realChromeContextOptions(
        ctx.viewport.formFactor,
        browser.version?.(),
        engineOptions.playwrightOptions.browser === 'chromium',
      ),
    });
    const page = await context.newPage();
    const timeout = engineOptions.navTimeoutMs;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await context.clearCookies();
    // networkidle so client-rendered content has actually painted before we read
    // the DOM - otherwise the "rendered" view would understate a slow SPA and
    // the raw-vs-rendered gap would look smaller than it is.
    await page.goto(ctx.experimentURL, { waitUntil: 'networkidle' }).catch(async (err) => {
      // A networkidle timeout on a chatty page is fine - read whatever rendered.
      console.warn(chalk.yellow(`[shaka-perf agent] networkidle wait did not settle for ${ctx.experimentURL}: ${(err as Error).message}`));
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    });
    await waitForBotWallToClear(page);
    const signals = await page.evaluate(extractPageSignals);
    const html = await page.content().catch(() => '');
    // Same guard as the a11y scan: a lingering token on a tall real page is not a wall.
    const renderedHeightPx = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => undefined);
    const blocked = scanLandedOnBotWall({ title: signals.title, html }, renderedHeightPx, ctx.viewport.height);
    return { signals, htmlBytes: Buffer.byteLength(html, 'utf8'), blocked };
  } finally {
    await context?.close().catch(() => {});
  }
}

// Parse the raw HTML the SAME way as the rendered DOM by loading it into a
// JavaScript-disabled context and running the identical extractor. With JS off,
// the page's own scripts never execute, so this is a faithful read of exactly
// what a non-rendering crawler parses.
async function readRawSignals(
  browser: Browser,
  viewport: TestContext['viewport'],
  html: string,
  timeoutMs: number,
): Promise<PageSignals | null> {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    // domcontentloaded (not the default 'load'): we only need the parsed DOM, and
    // waiting on subresources of a synthetic document can hang. Tolerate failure.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
    return await page.evaluate(extractPageSignals);
  } catch (err) {
    console.warn(chalk.yellow(`[shaka-perf agent] could not parse raw HTML: ${(err as Error).message}`));
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}

async function scanAgentReadiness(
  ctx: TestContext,
  browser: Browser,
  engineOptions: AgentReadinessEngineOptions,
): Promise<AgentReadinessResult> {
  const fetchedAt = new Date().toISOString();
  const rawFetchTimeout = engineOptions.rawFetchTimeoutMs;
  const usesChromium = engineOptions.playwrightOptions.browser === 'chromium';
  const needsNativeUserAgent =
    usesChromium && realChromeUsesNativeIdentity(ctx.viewport.formFactor);
  const nativeUserAgent = needsNativeUserAgent
    ? await nativeBrowserUserAgent(browser)
    : undefined;
  const rawFetchUserAgent = rawFetchUserAgentFor(
    ctx.viewport.formFactor,
    browser.version?.(),
    nativeUserAgent,
    usesChromium,
  );

  // Raw fetch + rendered render run together - they are independent.
  const [rawFetch, renderedOut] = await Promise.all([
    fetchRawHtml(ctx.experimentURL, rawFetchTimeout, rawFetchUserAgent),
    readRenderedSignals(ctx, browser, engineOptions),
  ]);

  const likelyBlocked = looksLikeBotWall({ status: rawFetch.status, html: rawFetch.html });
  const rawSignals = rawFetch.html
    ? await readRawSignals(browser, ctx.viewport, rawFetch.html, engineOptions.navTimeoutMs)
    : null;

  const raw: RawFetchResult = {
    ok: rawFetch.html !== null && (rawFetch.status === undefined || rawFetch.status < 400),
    status: rawFetch.status,
    contentType: rawFetch.contentType,
    bytes: rawFetch.bytes,
    likelyBlocked,
    signals: rawSignals,
  };

  return {
    url: ctx.experimentURL,
    viewportLabel: ctx.viewport.label,
    viewport: ctx.viewport,
    fetchedAt,
    raw,
    rendered: renderedOut.signals,
    rawHtmlBytes: rawFetch.bytes,
    renderedHtmlBytes: renderedOut.htmlBytes,
    blocked: likelyBlocked || renderedOut.blocked,
  };
}
