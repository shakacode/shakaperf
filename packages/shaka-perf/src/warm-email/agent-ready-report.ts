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
import type { PagePerf } from './synthesis';
import type { AgentReadinessResult } from '../audit/stages/agent_readiness/types';
import {
  scorePageStructure,
  scoreSite,
  scoreBucket,
  type Bucket,
  type PageStructureScore,
  type SiteAccessSignals,
} from './agent-ready-score';

// The "Agent Ready" tab: a third lens over the same saved audit, beside
// Performance and Accessibility. It scores how legible each page is to AI agents
// and answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews) and tells
// the story in plain language. The defensible-claims rules live in
// ../audit/stages/agent_readiness/METHODOLOGY.md - keep the copy here in sync.
//
// The 0-100 score is computed fresh each render from the stage's saved signals
// (deterministic, see agent-ready-score.ts). An optional `claude` pass rewrites a
// per-page plain-language summary + "what to change" list into the sidecars below;
// without it, the cards fall back to the already-plain line-item details.

export const AGENT_SCORE_VERSION = 'v1';

// ---- local escapers (kept here so this module never imports client-report.ts,
// which imports US - avoiding an import cycle). ----
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

function containedJoin(root: string, ...segs: string[]): string | null {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, ...segs);
  return abs === rootAbs || abs.startsWith(rootAbs + path.sep) ? abs : null;
}

// ---- sidecars (report-time AI text only; the score is never cached) ----
export const AGENT_CLIENT_FILENAME = 'agent-ready-client.json';
export const AGENT_SITE_FILENAME = 'agent-ready-site.json';

export interface AgentClient {
  summary?: string;
  fixes?: string[];
}

function readSidecar(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function readAgentClient(resultsDir: string, pageId: string): AgentClient | undefined {
  const p = containedJoin(resultsDir, pageId, AGENT_CLIENT_FILENAME);
  if (!p || !fs.existsSync(p)) return undefined;
  const j = readSidecar(p);
  if (!j) return undefined;
  const fixes = Array.isArray(j.fixes) ? j.fixes.filter((x): x is string => typeof x === 'string') : undefined;
  return {
    summary: typeof j.summary === 'string' ? j.summary : undefined,
    fixes: fixes && fixes.length ? fixes : undefined,
  };
}

export function readAgentSiteSummary(resultsDir: string): string | undefined {
  const p = path.join(resultsDir, AGENT_SITE_FILENAME);
  if (!fs.existsSync(p)) return undefined;
  const j = readSidecar(p);
  return j && typeof j.summary === 'string' ? j.summary : undefined;
}

function writeAgentClient(resultsDir: string, pageId: string, payload: AgentClient): void {
  const dir = containedJoin(resultsDir, pageId);
  if (!dir) return;
  const filePath = path.join(dir, AGENT_CLIENT_FILENAME);
  const merged = { ...(readSidecar(filePath) ?? {}), ...payload };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch {
    /* a side lens must never fail the report */
  }
}

function writeAgentSiteSummary(resultsDir: string, summary: string): void {
  const filePath = path.join(resultsDir, AGENT_SITE_FILENAME);
  const merged = { ...(readSidecar(filePath) ?? {}), summary };
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch {
    /* ignore */
  }
}

// ---- AI summary pass (mirrors the accessibility summarizer) ----
export interface AgentSummaryFinding {
  label: string;
  detail: string; // the descriptive finding
  action?: string; // the imperative "what to do", when the item has one
}
export interface AgentSummaryRequest {
  pageName: string;
  path: string;
  score: number;
  coveragePct: number; // text reachable without JS, 0-100
  rawState: 'ok' | 'blocked' | 'failed';
  findings: AgentSummaryFinding[]; // the non-passing checks worth fixing
}
export interface AgentSiteContext {
  overall: number;
  coverageAvgPct: number;
  accessSummary: string; // one line of robots/sitemap/llms state
}
export interface AgentSummary {
  summary: string;
  fixes: string[];
}
export interface AgentSummaryResult {
  pages: (AgentSummary | null)[];
  site: string | null;
}
export type AgentSummarizer = (
  reqs: AgentSummaryRequest[],
  site: AgentSiteContext,
) => Promise<AgentSummaryResult | null>;

// ---- page views ----
export interface AgentPageView {
  page: PagePerf;
  result: AgentReadinessResult;
  struct: PageStructureScore;
  client?: AgentClient;
}

// Collapse near-duplicate findings that land in two categories (e.g. "no
// structured data" surfaces in both the SSR raw-HTML check and the structure
// check) so the findings list never repeats one concept.
function findingKey(label: string): string {
  return label.toLowerCase().replace(/ before javascript$/, '').replace(/^(page|meta) /, '').trim();
}

// The non-passing checks across the three page categories, worst (fail before
// partial) first, de-duplicated - the raw material for both the AI prompt and the
// fallback list. Exported so the v2 client report can reuse the same fallback
// "what to change" actions without re-deriving them.
export function pageFindings(struct: PageStructureScore): AgentSummaryFinding[] {
  const out: { f: AgentSummaryFinding; rank: number }[] = [];
  const seen = new Set<string>();
  for (const cat of struct.categories) {
    for (const it of cat.items) {
      if (it.state === 'pass' || it.state === 'na') continue;
      const key = findingKey(it.label);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ f: { label: it.label, detail: it.detail, ...(it.action ? { action: it.action } : {}) }, rank: it.state === 'fail' ? 0 : 1 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.f);
}

function rawState(struct: PageStructureScore, result: AgentReadinessResult): 'ok' | 'blocked' | 'failed' {
  if (struct.rawReachable) return 'ok';
  return result.raw.likelyBlocked ? 'blocked' : 'failed';
}

// Phone-row agent-readiness for each page, scored, sorted worst-first (homepage
// tie-break) to match the Performance / Accessibility panels.
export function buildAgentPages(pages: PagePerf[], resultsDir: string): AgentPageView[] {
  const views: AgentPageView[] = [];
  for (const page of pages) {
    if (!page.agentReady) continue;
    views.push({
      page,
      result: page.agentReady,
      struct: scorePageStructure(page.agentReady),
      client: readAgentClient(resultsDir, page.id),
    });
  }
  views.sort((a, b) => {
    if (a.struct.score !== b.struct.score) return a.struct.score - b.struct.score;
    const ah = a.page.startingPath === '/' ? 1 : 0;
    const bh = b.page.startingPath === '/' ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return a.page.startingPath.localeCompare(b.page.startingPath);
  });
  return views;
}

function accessOneLiner(site: SiteAccessSignals | undefined): string {
  if (!site) return 'crawler access not checked';
  const parts: string[] = [];
  if (site.robots.blocksAll) parts.push('robots.txt blocks all crawlers');
  else if (site.robots.blocksAiBots.length) parts.push(`robots.txt blocks ${site.robots.blocksAiBots.join(', ')}`);
  else parts.push('AI answer crawlers allowed');
  parts.push(site.sitemap ? 'sitemap present' : 'no sitemap');
  if (site.llmsTxt) parts.push('llms.txt present');
  return parts.join('; ');
}

// Build the per-page summaries via the AI pass, persisting to the sidecars the
// cards read. Cache-and-reuse: only calls when a page (or the site summary) is
// missing; never overwrites a cached page. Best-effort - a null result leaves the
// fallback line-item list in place.
export async function enrichAgentSummaries(
  resultsDir: string,
  views: AgentPageView[],
  site: SiteAccessSignals | undefined,
  summarize: AgentSummarizer,
): Promise<void> {
  if (views.length === 0) return;
  const existing = views.map((v) => readAgentClient(resultsDir, v.page.id));
  const needsPage = existing.map((c) => !(c?.summary && c.fixes && c.fixes.length));
  const siteHas = readAgentSiteSummary(resultsDir) !== undefined;
  if (!needsPage.some(Boolean) && siteHas) return;

  const reqs: AgentSummaryRequest[] = views.map((v) => ({
    pageName: v.page.name,
    path: v.page.startingPath || '/',
    score: v.struct.score,
    coveragePct: Math.round(v.struct.coverage * 100),
    rawState: rawState(v.struct, v.result),
    findings: pageFindings(v.struct).slice(0, 8),
  }));
  const overall = scoreSite(views.map((v) => v.result), site);
  const ctx: AgentSiteContext = {
    overall: overall.overall,
    coverageAvgPct: Math.round(avgCoverage(views) * 100),
    accessSummary: accessOneLiner(site),
  };

  const result = await summarize(reqs, ctx);
  if (!result) return;

  views.forEach((v, i) => {
    if (!needsPage[i]) return;
    const ps = result.pages[i];
    if (ps) writeAgentClient(resultsDir, v.page.id, { summary: ps.summary, fixes: ps.fixes });
  });
  if (!siteHas && result.site) writeAgentSiteSummary(resultsDir, result.site);
}

function avgCoverage(views: AgentPageView[]): number {
  const reachable = views.filter((v) => v.struct.rawReachable);
  if (reachable.length === 0) return 0;
  return reachable.reduce((s, v) => s + v.struct.coverage, 0) / reachable.length;
}

export interface Lead {
  headline: string; // HTML
  note?: string;
  status: Bucket;
}

// The single most important thing about this page, worst-first - mirrors the
// Performance panel's adaptive lead. Exported so the v2 client report can reuse
// the exact same adaptive headline/note.
export function pageLead(view: AgentPageView): Lead {
  const s = view.struct;
  if (s.rawUnreadable) {
    return view.result.raw.likelyBlocked
      ? { headline: `This page returned a <strong>bot-block or error</strong> to a plain request`, note: 'An AI crawler hitting the same wall may not see the page at all.', status: 'poor' }
      : { headline: `We could not read this page's <strong>server HTML</strong>`, note: 'So we cannot confirm what an AI crawler sees here.', status: 'fair' };
  }
  if (s.coverage < 0.2) {
    return { headline: `Only <strong>${pct(s.coverage)}</strong> of this page is readable without JavaScript`, note: 'Most AI crawlers do not run JavaScript, so they see almost none of this page.', status: 'poor' };
  }
  if (s.coverage < 0.6) {
    return { headline: `<strong>${pct(s.coverage)}</strong> of this page is readable without JavaScript`, note: 'The rest only appears after the browser runs the page, where many AI crawlers cannot follow.', status: 'fair' };
  }
  // SSR is fine - lead with the weakest of the remaining checks in plain language
  // (the finding's description, never its internal label), with the fix as the note.
  const findings = pageFindings(s);
  const firstFail = findings.find(() => true);
  if (firstFail && s.score < 80) {
    return { headline: esc(firstFail.detail), note: firstFail.action, status: scoreBucket(s.score) };
  }
  return { headline: `Reachable and <strong>well structured</strong> for AI tools`, note: `${pct(s.coverage)} of the content is in the server HTML, and the page is cleanly marked up.`, status: scoreBucket(s.score) };
}

export function hasAgentData(pages: PagePerf[]): boolean {
  return pages.some((p) => p.agentReady && p.agentReady.rendered !== undefined);
}
