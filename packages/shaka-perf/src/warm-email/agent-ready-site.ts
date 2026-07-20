/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import type { SiteAccessSignals } from './agent-ready-score';
import { isPublicHost } from '../net/public-host';

// Site-level (origin-wide) agent-readiness signals, fetched ONCE at report time
// the same way the favicon is: robots.txt control of AI crawlers, a published
// sitemap, and the emerging /llms.txt guide. Best-effort and bounded - any
// failure degrades to "unknown" (treated as open access), never an exception.

// The major AI / answer-engine crawler user-agent tokens we check robots.txt for.
// Kept in one place so the score and the parser agree on what "an AI bot" is.
export const KNOWN_AI_BOTS = [
  'GPTBot', // OpenAI training crawler
  'OAI-SearchBot', // OpenAI search index (ChatGPT search)
  'ChatGPT-User', // OpenAI live fetch on a user's behalf
  'ClaudeBot', // Anthropic crawler
  'anthropic-ai', // Anthropic (legacy token)
  'Claude-User', // Anthropic live fetch
  'Claude-SearchBot', // Anthropic search/citation fetch
  'PerplexityBot', // Perplexity index
  'Perplexity-User', // Perplexity live fetch
  'Google-Extended', // Gemini / Vertex training opt-out token
  'CCBot', // Common Crawl (feeds many LLM training sets)
  'Applebot-Extended', // Apple Intelligence training token. (Applebot, Apple's
  // main crawler, is intentionally not scored: Apple renders JavaScript, so its
  // SSR relevance is nil, and it is not a primary AI-answer citation source.)
  'Amazonbot', // Amazon (Alexa / AI)
  'Bytespider', // ByteDance / TikTok
  'Meta-ExternalAgent', // Meta AI crawler
] as const;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECT_HOPS = 5;

// One bounded request with up to five manually followed redirects. Returns the
// truncated body text + status, or null on a fetch, URL, or host-validation failure.
async function fetchText(url: string): Promise<{ status: number; text: string } | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (!isPublicHost(target.hostname)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const res = await fetch(target.href, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (shaka-perf agent-readiness check)' },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        if (redirects >= MAX_REDIRECT_HOPS) return null;
        const location = res.headers.get('location');
        if (!location) return null;
        try {
          target = new URL(location, target);
        } catch {
          return null;
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
        if (!isPublicHost(target.hostname)) return null;
        continue;
      }
      const reader = res.body?.getReader();
      if (!reader) return { status: res.status, text: '' };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > MAX_BYTES) {
          ctl.abort();
          break;
        }
        chunks.push(value);
      }
      const buf = new Uint8Array(Math.min(total, MAX_BYTES));
      let offset = 0;
      for (const c of chunks) {
        if (offset >= buf.length) break;
        const slice = c.subarray(0, buf.length - offset);
        buf.set(slice, offset);
        offset += slice.length;
      }
      return { status: res.status, text: new TextDecoder('utf-8', { fatal: false }).decode(buf) };
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface RobotsParse {
  blocksAiBots: string[];
  blocksAll: boolean;
  sitemapDeclared: boolean;
}

// Pure robots.txt reader (exported for tests). Groups consecutive `User-agent`
// lines with their rules, then asks which AI bots are disallowed from root (own
// matching group if present, else `*`; a bare `Disallow: /` with no `Allow: /`).
// Intentionally not a full longest-match matcher - covers the common patterns and
// never overstates the block.
export function parseRobots(text: string, aiBots: readonly string[] = KNOWN_AI_BOTS): RobotsParse {
  const groups = new Map<string, { disallow: string[]; allow: string[] }>();
  let sitemapDeclared = false;
  let currentAgents: string[] = [];
  let sawRuleForGroup = false;

  const ensure = (ua: string): { disallow: string[]; allow: string[] } => {
    const key = ua.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { disallow: [], allow: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'sitemap') {
      if (value) sitemapDeclared = true;
      continue;
    }
    if (field === 'user-agent') {
      // A user-agent line after rules starts a NEW group; consecutive
      // user-agent lines (no rules between) share the upcoming rules.
      if (sawRuleForGroup) {
        currentAgents = [];
        sawRuleForGroup = false;
      }
      if (value) currentAgents.push(value);
      ensure(value);
      continue;
    }
    if (field === 'disallow' || field === 'allow') {
      sawRuleForGroup = true;
      for (const ua of currentAgents.length ? currentAgents : ['*']) {
        const g = ensure(ua);
        (field === 'disallow' ? g.disallow : g.allow).push(value);
      }
    }
  }

  const blocksRoot = (ua: string): boolean => {
    const g = groups.get(ua.toLowerCase());
    if (!g) return false;
    // A bare `Disallow: /` blocks everything; an `Allow: /` of equal breadth lifts it.
    const disallowsRoot = g.disallow.some((p) => p === '/');
    const allowsRoot = g.allow.some((p) => p === '/');
    return disallowsRoot && !allowsRoot;
  };

  // A bot's OWN group overrides the wildcard: `* Disallow: /` blocks a bot with no
  // group of its own, but a bot that adds `Allow: /` is not blocked (the common
  // "block generic crawlers, allow the AI answer bots" pattern).
  const effBlocksRoot = (ua: string): boolean =>
    groups.has(ua.toLowerCase()) ? blocksRoot(ua) : blocksRoot('*');
  const blocksAll = blocksRoot('*');
  const blocksAiBots = aiBots.filter((bot) => effBlocksRoot(bot));
  return { blocksAiBots, blocksAll, sitemapDeclared };
}

export async function fetchSiteAccessSignals(siteUrl: string): Promise<SiteAccessSignals | undefined> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return undefined;
  }

  const [robotsRes, llmsRes] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
  ]);

  const robotsFetched = !!robotsRes && robotsRes.status < 400 && robotsRes.text.trim().length > 0;
  const robots = robotsFetched
    ? parseRobots(robotsRes!.text)
    : { blocksAiBots: [], blocksAll: false, sitemapDeclared: false };

  // A sitemap counts if robots.txt declares one OR /sitemap.xml exists and looks
  // like XML. Only probe /sitemap.xml when robots didn't already declare one.
  let sitemap = robots.sitemapDeclared;
  if (!sitemap) {
    const sm = await fetchText(`${origin}/sitemap.xml`);
    sitemap = !!sm && sm.status < 400 && /<(urlset|sitemapindex)\b/i.test(sm.text);
  }

  // llms.txt counts if it exists, returns 200, and is text (not an SPA HTML 200).
  const llmsTxt =
    !!llmsRes &&
    llmsRes.status < 400 &&
    llmsRes.text.trim().length > 0 &&
    !/^\s*<!doctype html|^\s*<html/i.test(llmsRes.text);
  const llmsTxtConfirmedAbsent =
    !!llmsRes &&
    !llmsTxt &&
    (llmsRes.status === 404 || llmsRes.status === 410 || (llmsRes.status >= 200 && llmsRes.status < 300));

  if (!robotsFetched && !sitemap && !llmsTxt) {
    // Nothing answered. Still return a signal so the score treats access as open
    // (the default-open case) rather than dropping the category entirely.
    console.warn(chalk.yellow(`[shaka-perf agent] no robots.txt / sitemap / llms.txt reachable at ${origin} - treating crawler access as open.`));
  }

  return {
    robots: { fetched: robotsFetched, blocksAiBots: robots.blocksAiBots, blocksAll: robots.blocksAll },
    sitemap,
    llmsTxt,
    llmsTxtConfirmedAbsent,
  };
}
