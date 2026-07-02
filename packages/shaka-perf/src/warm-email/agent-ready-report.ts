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
  type CategoryScore,
  type PageStructureScore,
  type ScoreItem,
  type SiteAccessSignals,
  type SiteAgentScore,
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
const dashSafe = (s: string): string => s.replace(/\s*[—–]\s*/g, ' - ');
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

// ============================================================================
// Rendering
// ============================================================================

const bucketWord = (b: Bucket): string => (b === 'good' ? 'Good' : b === 'fair' ? 'Needs work' : 'Poor');

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
  return { headline: `Reachable and <strong>well structured</strong> for AI assistants`, note: `${pct(s.coverage)} of the content is in the server HTML, and the page is cleanly marked up.`, status: scoreBucket(s.score) };
}

function scoreBadge(score: number, bucket: Bucket, capped: boolean): string {
  const cap = capped ? ` title="Capped at ${score} because most of the content is not reachable without JavaScript"` : '';
  return `<div class="ag-score ag-score--${bucket}"${cap}><div class="ag-score__num">${score}</div><div class="ag-score__lbl">page score</div></div>`;
}

const dot = (state: ScoreItem['state']): string => {
  const k = state === 'pass' ? 'ok' : state === 'partial' ? 'mid' : state === 'na' ? 'na' : 'bad';
  return `<span class="ag-dot ag-dot--${k}"></span>`;
};

function categoryBlock(cat: CategoryScore): string {
  const frac = cat.max > 0 ? cat.points / cat.max : 1;
  const bucket: Bucket = frac >= 0.8 ? 'good' : frac >= 0.5 ? 'fair' : 'poor';
  const rows = cat.items
    .filter((it) => it.max > 0 || it.state === 'na')
    .map((it) => `<li class="ag-check">${dot(it.state)}<span class="ag-check__tx">${esc(dashSafe(it.detail))}</span></li>`)
    .join('');
  return `<div class="ag-cat">
      <div class="ag-cat__head"><span class="ag-cat__name">${esc(cat.name)}</span><span class="ag-cat__pts ag-cat__pts--${bucket}">${Math.round(frac * 100)}<span class="ag-cat__of">/100</span></span></div>
      <ul class="ag-checks">${rows}</ul>
    </div>`;
}

function fixesHtml(view: AgentPageView): string {
  const ai = view.client?.fixes?.length ? view.client.fixes : null;
  // Fallback (no AI rewrite): render each finding's imperative `action`, not its
  // descriptive `detail`, so the list reads as actions under "What to change".
  const items = ai
    ? ai.map((f) => `<li>${esc(dashSafe(f))}</li>`)
    // Dedupe by the action TEXT: two findings (low coverage + thin server text)
    // share the same "server-render this page" action, and the list must not
    // print it twice.
    : Array.from(new Set(pageFindings(view.struct).map((f) => f.action).filter((a): a is string => !!a)))
        .slice(0, 4)
        .map((a) => `<li>${esc(dashSafe(a))}</li>`);
  if (items.length === 0) return '';
  return `<div class="ag-fixes"><h3>What to change</h3><ul>${items.join('')}</ul></div>`;
}

function agentCardHtml(view: AgentPageView): string {
  const { page, struct } = view;
  const lead = pageLead(view);
  const summary = view.client?.summary ? `<p class="ag-summary">${esc(dashSafe(view.client.summary))}</p>` : '';
  const breakdown = struct.categories.map(categoryBlock).join('');
  const capNote = struct.shellCapped
    ? `<p class="ag-capnote">Scored ${struct.score} (capped): the page's structure and tags are fine, but they only appear after JavaScript runs, so an AI crawler that does not run JavaScript still sees little of it.</p>`
    : '';
  return `<section class="ag-card">
      <header class="card-head">
        <div class="card-title"><h2>${esc(page.name)}</h2><div class="path">${esc(page.startingPath || '/')}</div></div>
        ${scoreBadge(struct.score, struct.bucket, struct.shellCapped)}
      </header>
      <p class="headline headline--${lead.status}">${lead.headline}</p>
      ${lead.note ? `<p class="subhead">${esc(lead.note)}</p>` : ''}
      ${summary}
      ${capNote}
      ${fixesHtml(view)}
      <details class="ag-detail">
        <summary>See what we checked <span class="ag-detail__hint">${struct.categories.length} groups</span></summary>
        <div class="ag-cats">${breakdown}</div>
      </details>
    </section>`;
}

function accessSectionHtml(overall: SiteAgentScore): string {
  const cat = overall.access.category;
  const rows = cat.items
    .map((it) => `<li class="ag-check">${dot(it.state)}<span class="ag-check__tx">${esc(dashSafe(it.detail))}</span></li>`)
    .join('');
  return `<section class="ag-access">
      <header class="card-head">
        <div class="card-title"><h2>Can AI answer engines reach your site?</h2><div class="path">site-wide</div></div>
        <div class="ag-score ag-score--${overall.access.bucket}"><div class="ag-score__num">${overall.access.score}</div><div class="ag-score__lbl">access</div></div>
      </header>
      <p class="subhead">Search and AI answer engines mainly read and cite pages they are allowed to crawl. This is the same for every page on the site.</p>
      <ul class="ag-checks">${rows}</ul>
    </section>`;
}

// Short, visible intro - what this is, the stakes, then the defensible mechanism
// (most AI crawlers skip JS; Google/Apple/Bing are the exceptions). Plain enough
// for a non-technical owner; the scoring detail lives in the collapsible below.
const INTRO = `When people ask ChatGPT, Claude, Perplexity, or Google's AI to recommend a business like yours, those tools read your site first. The less of your content they can read, the less likely they are to recommend you. Most of them - including OpenAI, Anthropic, and Perplexity - only read what your page shows right away and skip anything that loads a moment later; Google, Apple, and Microsoft's Bing are the main exceptions. This tab shows how much of your content AI can read today.`;

// One short visible line; the weighting detail is demoted into "How we score this".
const DIRECTIONAL_LINE = `This is a directional check (ShakaCode Agent Ready ${AGENT_SCORE_VERSION}), like a speed score - use the findings below, not the number on its own.`;

// Collapsed by default ("How we score this") so it adds no reading burden up top.
const METHOD = `We score four things, weighted by how much they affect AI visibility: text that loads before JavaScript runs (40%, the biggest factor, because most AI tools do not run JavaScript), whether AI tools are allowed to read your site (25%), labels that tell AI what the page is about (20%), and a clear, logical layout (15%). Sites that send their content as ready-to-read HTML from the server score highest. For the main score we read your page the way a no-JavaScript AI crawler does - the raw page your server sends, before any browser code runs; a site that sends different HTML to specific AI bots may score differently. If we cannot read a page's server HTML, we say so instead of guessing a score, and a page that sends almost no content up front is capped low, since a crawler cannot see what is not there.`;

const OUTRO = `The fix is making sure your full page content is there as soon as the page loads (server-rendering), and done well it usually speeds up the page for real visitors too. We do exactly this work every day at ShakaCode - reach out if it would help to talk through what we found.`;

export async function agentPanelHtml(
  views: AgentPageView[],
  site: SiteAccessSignals | undefined,
  siteSummary: string | undefined,
): Promise<string> {
  const overall = scoreSite(views.map((v) => v.result), site);
  const covAvg = avgCoverage(views);
  const reachableViews = views.filter((v) => v.struct.rawReachable);
  // < 0.5 so "serve most of their content only after JavaScript" is literally true
  // (a page at 0.59 keeps 59% reachable - "most" would overstate it).
  const shellPages = reachableViews.filter((v) => v.struct.coverage < 0.5).length;

  const cards = views.map(agentCardHtml).join('\n');

  // Headline stats: the score, the wedge (content reachable without JS), and the
  // access gate. When NO page's raw HTML was readable, show a caveat not a number.
  const covLabel = views.length > 1 ? 'How much of your content AI can read (average)' : 'How much of your content AI can read';
  const coverageStat = overall.allRawUnreadable
    ? `<div class="stat"><div class="num fair">n/a</div><div class="lbl">We could not read your page</div></div>`
    : `<div class="stat"><div class="num ${covAvg >= 0.8 ? 'good' : covAvg >= 0.5 ? 'fair' : 'poor'}">${pct(covAvg)}</div><div class="lbl">${covLabel}</div></div>`;
  const accessStat = `<div class="stat"><div class="num ${overall.access.bucket === 'good' ? 'good' : overall.access.bucket === 'fair' ? 'fair' : 'poor'}">${overall.access.score}</div><div class="lbl">Whether AI is allowed in</div></div>`;

  // Always show the fixed INTRO - it is the only place that names the JS-rendering
  // exceptions (Google/Apple/Bing), a hard requirement. The AI site summary, when
  // present, is an ADDITIONAL site-specific note below it, never a replacement.
  const note = `<p class="summary-note">${esc(INTRO)}</p>${siteSummary ? `\n  <p class="summary-note ag-sitenote">${esc(dashSafe(siteSummary))}</p>` : ''}`;
  // Branch on the reachable count so subject/verb/pronoun agree: "This page" (1),
  // "Both/All N pages" (every reachable page is a shell), else "M of N pages".
  const wedgeTail = 'only after JavaScript runs, so an AI crawler that does not run JavaScript misses it.';
  const wedgeBody = reachableViews.length === 1
    ? `This page serves most of its content ${wedgeTail}`
    : shellPages === reachableViews.length
      ? `${reachableViews.length === 2 ? 'Both' : `All ${reachableViews.length}`} pages we could read serve most of their content ${wedgeTail}`
      : shellPages === 1
        ? `1 of the ${reachableViews.length} pages we could read serves most of its content ${wedgeTail}`
        : `${shellPages} of the ${reachableViews.length} pages we could read serve most of their content ${wedgeTail}`;
  const wedge = !overall.allRawUnreadable && shellPages > 0
    ? `<p class="ag-wedge"><b>The gap that matters.</b> ${wedgeBody} Server-rendering closes that gap.</p>`
    : '';

  // When robots.txt blocks every crawler, that is THE verdict - no AI engine can
  // read any page however well it is built. Lead with it, above the per-page cards.
  const blockedFirst = overall.accessBlocked
    ? `<p class="ag-wedge ag-wedge--alarm"><b>Fix this first.</b> Your robots.txt currently blocks every crawler, so the AI answer engines that respect it - which is most of them, including OpenAI, Anthropic, and Perplexity - will not crawl or cite any page on this site, however well each page is built.</p>`
    : '';

  // Overall is the hero; the two things it is built from (allowed in + how much
  // is readable) sit smaller beneath it, so the headline number and its factors
  // read as total-and-parts, not three numbers that look like the same thing.
  const ob = overall.bucket;
  return `<div class="tab-panel" id="agent-panel" role="tabpanel" aria-labelledby="tab-agent" hidden>
  <div class="ag-hero">
    <div class="ag-hero__num ${ob}">${overall.overall}</div>
    <div class="ag-hero__lbl">Overall AI readiness <span class="ag-hero__verdict ${ob}">${bucketWord(overall.bucket)}</span></div>
  </div>
  <div class="ag-factors__cap">The two biggest factors</div>
  <div class="summary ag-factors">
    ${accessStat}
    ${coverageStat}
  </div>
  ${note}
  ${blockedFirst}
  ${wedge}
  <p class="howto">${DIRECTIONAL_LINE}</p>
  <details class="ag-detail ag-howto"><summary>How we score this</summary><p class="howto">${METHOD}</p></details>
  ${accessSectionHtml(overall)}
${cards}
  <p class="outro">${esc(OUTRO)}</p>
</div>`;
}

export function hasAgentData(pages: PagePerf[]): boolean {
  return pages.some((p) => p.agentReady && p.agentReady.rendered !== undefined);
}

// The tab pill shows the score so a low one is visible at a glance (a count would
// read as "issues"). Coloured by bucket.
export function agentTabPill(views: AgentPageView[], site: SiteAccessSignals | undefined): string {
  const overall = scoreSite(views.map((v) => v.result), site);
  return `<span class="tab-pill tab-pill--${overall.bucket}">${overall.overall}</span>`;
}
