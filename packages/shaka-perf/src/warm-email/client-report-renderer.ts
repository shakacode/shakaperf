/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  COST_CHIP_LABELS,
  COST_STATE_MATRIX,
  INDUSTRY_DATA,
  WHAT_THIS_AFFECTS,
  type CostChip,
  type IndustryDataStat,
  type State as CostState,
  type Tab as CostTab,
} from './cost-strings';

// Client report renderer: pure templating over a fully-assembled
// `ClientReportModel` (built in ./client-report.ts, which does all the IO).
// Styling is inline per the design handoff; the <head> <style> only adds what
// inline can't (font, :hover, tab/lightbox JS, mobile reflow).

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type ClientReportStatus = 'good' | 'fair' | 'poor';

// Traffic-light status palette (design tokens): good stays calm, poor is a
// decisive attention-red. Each status: fg / soft bg / border line / softer hover.
const PAL: Record<ClientReportStatus, { fg: string; bg: string; line: string; soft: string }> = {
  good: { fg: '#2f7d4f', bg: '#e9f4ec', line: '#cfe6d6', soft: '#f2f9f4' },
  fair: { fg: '#a85f00', bg: '#fbeecf', line: '#eed9a8', soft: '#fdf6e8' },
  poor: { fg: '#c0271f', bg: '#fbe6e3', line: '#f0c4bd', soft: '#fdf0ee' },
};
export const clientReportStatusWord = (s: ClientReportStatus): string => (s === 'poor' ? 'Poor' : s === 'fair' ? 'Needs work' : 'Good');

// A neutral grey for a dimension we could NOT measure (a bot-protection challenge
// walled the audit) - deliberately not good/fair/poor so it never reads as a pass.
const NEUTRAL = { fg: '#6f665c', bg: '#f4f1ea', line: '#e0d9cd', soft: '#f6f4f0' };

// Neutrals (design tokens).
const INK = '#26221d';
const FAINT = '#9b9286';
const LINE = '#e7e1d8';

// ---- model (assembled in client-report.ts) ----

export interface ClientReportBox {
  left: string;
  top: string;
  width: string;
  height: string;
  hi?: boolean; // a11y only: high-impact (red) vs minor (amber)
  level?: 'hi' | 'mid' | 'lo'; // a11y only: severity bucket (drives color + the sev-tag toggle)
}
// The load story beat a frame represents: drives the frame ring + caption color
// (first content = blue, biggest piece = orange, layout jump = red). Absent =
// an ordinary in-between frame (faint).
export type ClientReportBeat = 'first-content' | 'lcp' | 'shift';
export interface ClientReportFrame {
  key: boolean; // the highlighted moment (biggest piece / layout jump)
  blank: boolean; // a still-blank phone
  beat?: ClientReportBeat;
  label: string; // the role, e.g. "Biggest piece"
  detail?: string; // the long zoom caption shown in the lightbox
  time: string;
  imgUri?: string;
  boxes?: ClientReportBox[]; // layout-shift rects on this frame
}
export interface ClientReportFact {
  val: string;
  label: string;
  status: ClientReportStatus;
}
export interface ClientReportPerfCard {
  id: string;
  name: string;
  path: string;
  liveUrl?: string;
  status: ClientReportStatus;
  headlineHtml: string; // pre-built HTML (contains <strong>), inserted raw
  sub?: string;
  videoUri?: string;
  posterUri?: string;
  videoCap: string;
  cues?: { t: number; x: string }[];
  frames: ClientReportFrame[];
  totalFrames: number;
  facts: ClientReportFact[];
  plain?: string;
  copyPrompt?: string;
}
export interface ClientReportPerfFineRow {
  name: string;
  path: string;
  liveUrl?: string;
  status: ClientReportStatus;
  note: string;
}
export interface ClientReportA11yFrame {
  imgUri: string;
  boxes: ClientReportBox[];
  cap: string;
  count: number;
}
export interface ClientReportA11yCard {
  name: string;
  path: string;
  score?: number;
  status: ClientReportStatus; // drives the score-badge color (pre-computed by the orchestrator)
  sev: { num: number; label: string; status: ClientReportStatus }[];
  summary?: string;
  frames: ClientReportA11yFrame[];
  fixes: string[];
  copyPrompt?: string;
}
export interface ClientReportA11yFineRow {
  name: string;
  path: string;
  score?: number;
  status: ClientReportStatus;
  summary: string;
}
export interface ClientReportAgentCheck {
  ok: 'ok' | 'na' | 'bad';
  tx: string;
}
export interface ClientReportAgentSite {
  score: number;
  status: ClientReportStatus;
  checks: ClientReportAgentCheck[];
}
export interface ClientReportAgentFactor {
  name: string;
  score: number; // 0-100
  status: ClientReportStatus;
}
export interface ClientReportAgentCard {
  name: string;
  path: string;
  score: number;
  status: ClientReportStatus;
  capped: boolean;
  headlineHtml: string; // pre-built HTML, inserted raw
  sub?: string;
  factors: ClientReportAgentFactor[];
  fixes: string[];
  copyPrompt?: string;
}
export interface ClientReportAgentFineRow {
  name: string;
  path: string;
  score: number;
  status: ClientReportStatus;
}
export interface ClientReportTile {
  target: 'perf' | 'a11y' | 'agent';
  kicker: string;
  status: ClientReportStatus;
  wordTx: string;
  metric: string;
  benchmarkTx?: string;
  benchmarkHtml?: string; // pre-built trusted HTML, inserted raw
  problemTx?: string; // the dominant problem in plain words, shown beside the number
  metricSub: string;
  conseq: string;
  blocked?: boolean; // neutral "could not measure" styling (a bot wall blocked the audit)
}
// A page whose audit landed on a bot-protection challenge: shown as "could not
// measure", never scored or counted.
export interface ClientReportBlockedPage {
  name: string;
  path: string;
}
export interface ClientReportDimNarrative {
  verdictWord: string;
  verdictPara: string; // plain text
}
export interface ClientReportNarrative {
  bottomLineHtml: string; // pre-built HTML (may contain a highlight <span>), inserted raw
  perf: ClientReportDimNarrative;
  a11y: ClientReportDimNarrative;
  agent: ClientReportDimNarrative;
}
// "Start here" = a deterministic, data-driven priority list (page + the one
// thing wrong on it), distinct from the AI verdict paragraph above it.
export interface ClientReportStartHereItem {
  page: string;
  issue: string;
}
export interface ClientReportStartHere {
  items: ClientReportStartHereItem[];
  rest?: string; // one line covering the remaining pages
  lead?: string; // when set, render this plain sentence instead of the page list
}
export type SourcedStat = IndustryDataStat;
export interface ClientReportCostBlock {
  tab: CostTab;
  state: CostState;
  headline?: string;
  headlineSub?: string;
  chip?: CostChip;
  checkLine?: string;
  affectsProse?: string;
  sitePrompt?: string;
  stats?: SourcedStat[];
  dataCost?: {
    measuredLine: string;
    estimatedLine: string;
    formula: string;
  };
}
export interface ClientReportModel {
  domain: string;
  dateStr: string;
  faviconLinkTag: string;
  lede: string;
  tiles: ClientReportTile[];
  // performance (always present when there are pages)
  hasPerf: boolean;
  perfStatus: ClientReportStatus;
  perfScore?: number;
  perfCouldNotMeasure: boolean; // true when NO performance page could be measured
  perfCards: ClientReportPerfCard[];
  perfFine: ClientReportPerfFineRow[];
  // accessibility (optional)
  hasA11y: boolean;
  a11yStatus: ClientReportStatus;
  a11yScore?: number;
  a11yCards: ClientReportA11yCard[];
  a11yFine: ClientReportA11yFineRow[];
  a11yBlocked: ClientReportBlockedPage[]; // pages walled by a bot challenge - "could not measure"
  a11yCouldNotMeasure: boolean; // true when NO a11y page could be measured
  // AI visibility (optional)
  hasAgent: boolean;
  agentStatus: ClientReportStatus;
  agentScore?: number;
  agentSite?: ClientReportAgentSite;
  agentCards: ClientReportAgentCard[];
  agentFine: ClientReportAgentFineRow[];
  agentBlocked: ClientReportBlockedPage[];
  agentCouldNotMeasure: boolean;
  perfCost?: ClientReportCostBlock;
  a11yCost?: ClientReportCostBlock;
  agentCost?: ClientReportCostBlock;
  // Per-tab "Start here" priority lists (data-driven; optional).
  perfStartHere?: ClientReportStartHere;
  a11yStartHere?: ClientReportStartHere;
  agentStartHere?: ClientReportStartHere;
  narrative: ClientReportNarrative;
  outro: string;
  footnote: string;
}

// ---- font import + the small interactive/hover/responsive layer ----
const HEAD_STYLE = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:#f7f5f0}
  ::selection{background:#e7dcc6}
  .cr-tile{transition:background .12s ease}
  .cr-tile:hover{background:var(--soft)!important}
  .cr-tab{transition:color .12s ease,border-color .12s ease}
  .cr-panel[hidden]{display:none}
  [data-disclosure][hidden]{display:none}
  [data-disclose]{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;color:#26221d}
  [data-disclose] .cr-mono-chip,[data-disclose].cr-mono-chip{color:#4a443c}
  .cr-shot{cursor:zoom-in}
  .cr-sev-chip{transition:opacity .12s ease,box-shadow .12s ease}
  .cr-sev-chip:hover{box-shadow:0 0 0 2px rgba(38,34,29,.14)}
  .cr-sev-chip.cr-sev-off{opacity:.4;text-decoration:line-through}
  /* on-video captions: a dark lower-third scrim so the white beat text stays
     legible during playback (independent of hover). */
  .cr-vidcap{position:absolute;left:0;right:0;bottom:0;padding:30px 12px 50px;background:linear-gradient(to top,rgba(8,11,15,.92) 0%,rgba(8,11,15,.74) 42%,rgba(8,11,15,0) 100%);text-align:center;opacity:0;transition:opacity .25s ease;pointer-events:none}
  .cr-vidcap.cr-show{opacity:1}
  .cr-vidcap-tx{display:inline-block;max-width:92%;color:#fff;font-size:14px;line-height:1.35;font-weight:600;letter-spacing:.004em;text-shadow:0 1px 3px rgba(0,0,0,.7)}
  /* lightbox */
  .cr-lb{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(38,34,29,.86);padding:28px;cursor:zoom-out}
  .cr-lb.open{display:flex}
  .cr-lb-stage{display:flex;align-items:center;justify-content:center;max-width:92vw;max-height:82vh}
  .cr-lb-stage .cr-shot{margin:0;max-width:92vw;max-height:82vh;cursor:default;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .cr-lb-stage .cr-shot img{width:auto!important;height:auto!important;max-width:92vw;max-height:82vh;object-fit:contain}
  .cr-lb-cap b{color:#fff}
  .cr-lb-close{position:absolute;top:16px;right:18px;width:44px;height:44px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#f3efe7;font-size:28px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3}
  .cr-lb-arrow{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#f3efe7;font-size:30px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3}
  .cr-lb-prev{left:16px} .cr-lb-next{right:16px}
  .cr-lb-close:hover,.cr-lb-arrow:not(:disabled):hover{background:rgba(255,255,255,.26)}
  .cr-lb-arrow:disabled{opacity:.42;cursor:default}
  @media print{.cr-panel[hidden],[data-disclosure][hidden]{display:block!important}.cr-tabs{display:none!important}}
  @media (max-width:760px){
    .cr-tiles{grid-template-columns:1fr!important}
    .cr-wrap h1{font-size:30px!important}
  }`;

// ---- shared bits ----

function masthead(m: ClientReportModel): string {
  return `  <div style="display:flex; align-items:center; gap:9px; margin-bottom:38px">
    <div style="width:11px; height:11px; border-radius:50%; background:#c0271f"></div>
    <div style="font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:500; letter-spacing:.22em; text-transform:uppercase; color:#26221d">ShakaCode</div>
    <div style="flex:1; height:1px; background:#e7e1d8"></div>
    <div style="font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:.08em; color:#9b9286">Site health report${m.dateStr ? ` &middot; ${esc(m.dateStr)}` : ''}</div>
  </div>

  <div style="font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:#9b9286; margin-bottom:14px">How your site performs for real visitors</div>
  <h1 style="font-size:40px; line-height:1.08; letter-spacing:-.02em; font-weight:800; margin:0 0 16px; max-width:18ch">${esc(m.domain)}</h1>
  <p style="font-size:18px; line-height:1.55; color:#4a443c; margin:0 0 6px; max-width:60ch">${esc(m.lede)}</p>
  ${m.dateStr ? `<p style="font-size:14px; color:#9b9286; margin:10px 0 0; max-width:60ch">A snapshot of the live site on ${esc(m.dateStr)}. If the site has changed since, this may no longer reflect it.</p>` : ''}`;
}

function bottomLine(m: ClientReportModel): string {
  return `  <div style="margin:46px 0 18px; padding:22px 24px; background:#26221d; border-radius:16px; color:#f3efe7">
    <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#b8ad9b; margin-bottom:9px">The bottom line</div>
    <p style="font-size:21px; line-height:1.45; font-weight:600; margin:0; letter-spacing:-.01em">${m.narrative.bottomLineHtml}</p>
  </div>`;
}

function tile(t: ClientReportTile): string {
  const p = t.blocked ? NEUTRAL : PAL[t.status];
  const benchmark = t.benchmarkHtml || t.benchmarkTx
    ? `\n        <div style="font-size:12.5px; line-height:1.35; color:#6f665c; margin:-1px 0 5px">${t.benchmarkHtml ?? esc(t.benchmarkTx!)}</div>`
    : '';
  const problemTx = t.problemTx
    ? `\n        <div style="font-size:13px; line-height:1.35; font-weight:700; color:${p.fg}; margin:2px 0 4px">${esc(t.problemTx)}</div>`
    : '';
  return `      <button type="button" data-jump="${t.target}" class="cr-tile" style="--soft:${p.soft}; text-align:left; cursor:pointer; appearance:none; font-family:inherit; background:#ffffff; border:1px solid ${p.line}; border-top:3px solid ${p.fg}; border-radius:14px; padding:18px 18px 16px; display:flex; flex-direction:column; gap:0">
        <div style="font-size:12px; font-weight:600; letter-spacing:.02em; color:#9b9286; margin-bottom:11px">${esc(t.kicker)}</div>
        <div style="font-size:23px; font-weight:800; letter-spacing:-.02em; color:${p.fg}; line-height:1.05; margin-bottom:13px">${esc(t.wordTx)}</div>
        <div style="font-size:30px; font-weight:800; letter-spacing:-.02em; color:#26221d; line-height:1; margin-bottom:4px">${esc(t.metric)}</div>${benchmark}${problemTx}
        <div style="font-size:12.5px; color:#9b9286; margin-bottom:13px">${esc(t.metricSub)}</div>
        <div style="font-size:13.5px; line-height:1.5; color:#4a443c">${esc(t.conseq)}</div>
      </button>`;
}

function tiles(m: ClientReportModel): string {
  if (m.tiles.length === 0) return '';
  const cols = Math.min(3, m.tiles.length);
  return `  <div class="cr-tiles" style="display:grid; grid-template-columns:repeat(${cols},1fr); gap:14px; margin-bottom:8px">
${m.tiles.map(tile).join('\n')}
  </div>`;
}

function tabButton(target: string, label: string, status: ClientReportStatus, active: boolean, blocked?: boolean): string {
  const dot = blocked ? NEUTRAL.fg : PAL[status].fg;
  const col = active ? INK : '#6f665c';
  const bdr = active ? INK : 'transparent';
  return `    <button type="button" class="cr-tab" data-tab="${target}" aria-selected="${active ? 'true' : 'false'}" style="appearance:none; font-family:inherit; background:none; cursor:pointer; border:0; border-bottom:2px solid ${bdr}; margin-bottom:-1px; padding:11px 18px 13px; display:flex; align-items:center; gap:9px; font-size:15.5px; font-weight:600; color:${col}">
      <span style="width:8px; height:8px; border-radius:50%; background:${dot}"></span>${esc(label)}
    </button>`;
}

function tabs(m: ClientReportModel): string {
  const present: { target: string; label: string; status: ClientReportStatus; blocked?: boolean }[] = [];
  if (m.hasPerf) present.push({ target: 'perf', label: 'Performance', status: m.perfStatus, blocked: m.perfCouldNotMeasure });
  if (m.hasA11y) present.push({ target: 'a11y', label: 'Accessibility', status: m.a11yStatus, blocked: m.a11yCouldNotMeasure });
  if (m.hasAgent) present.push({ target: 'agent', label: 'AI visibility', status: m.agentStatus, blocked: m.agentCouldNotMeasure });
  if (present.length < 2) return ''; // a single section needs no tab bar
  const first = present[0].target;
  return `  <div class="cr-tabs" style="display:flex; gap:2px; border-bottom:1px solid #e7e1d8; margin:42px 0 28px; position:sticky; top:0; background:#f7f5f0; z-index:5; padding-top:6px">
${present.map((t) => tabButton(t.target, t.label, t.status, t.target === first, t.blocked)).join('\n')}
  </div>`;
}

// A tab's opening block: eyebrow question + big verdict word + verdict paragraph
// + the "Start here" priority callout (colored by the tab's status).
// The "Start here" priority list: the specific pages to fix, each with the one
// thing wrong on it (in parens), plus a line on the rest. Built from data, so it
// names different things than the verdict paragraph above it.
function startHereBlock(status: ClientReportStatus, sh: ClientReportStartHere): string {
  const p = PAL[status];
  const items = sh.items
    .map((it) => `          <li style="display:flex; gap:9px; font-size:15px; line-height:1.5; color:#3a352e">
            <span style="color:${p.fg}; font-weight:700; flex:none">&rarr;</span>
            <span><strong style="font-weight:700; color:#26221d">${esc(it.page)}</strong> <span style="color:#6f665c">(${esc(it.issue)})</span></span>
          </li>`)
    .join('\n');
  // A `lead` sentence (used by the a11y tab) reads as plain prose, not a page list.
  const inner = sh.lead
    ? `        <p style="margin:0; font-size:15px; line-height:1.55; color:#3a352e">${emphasize(esc(sh.lead))}</p>`
    : `        <ul style="margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px">
${items}
        </ul>${sh.rest ? `
        <div style="font-size:14px; line-height:1.5; color:#6f665c; margin-top:11px; padding-top:11px; border-top:1px solid ${p.line}">${esc(sh.rest)}</div>` : ''}`;
  return `      <div style="padding:16px 18px; background:${p.bg}; border:1px solid ${p.line}; border-radius:11px; max-width:64ch">
        <div style="font-family:'JetBrains Mono',monospace; font-size:11.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:${p.fg}; margin-bottom:11px">Start here</div>
${inner}
      </div>`;
}

const COST_CHIP_STYLE: Record<CostChip, { fg: string; bg: string; line: string }> = {
  measured: { fg: '#4a443c', bg: '#f4f1ea', line: '#e0d9cd' },
  estimated: { fg: '#5c4a24', bg: '#f7f0df', line: '#e4d7b9' },
  'not measured': { fg: '#6f665c', bg: '#f4f1ea', line: '#d8d0c3' },
};

function costChip(chip: CostChip | undefined): string {
  if (!chip) return '';
  const c = COST_CHIP_STYLE[chip];
  return `<span style="display:inline-flex; align-items:center; flex:none; border:1px solid ${c.line}; border-radius:999px; background:${c.bg}; color:${c.fg}; padding:4px 8px; font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap">${esc(COST_CHIP_LABELS[chip])}</span>`;
}

function costId(...parts: (string | number | undefined)[]): string {
  const base = parts
    .filter((p) => p !== undefined)
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
  return base || 'cost';
}

function copyPromptControl(prompt: string | undefined, id: string, compact = false): string {
  if (!prompt) return '';
  const label = compact ? 'Copy prompt' : 'Copy prompt for your agent';
  const width = compact ? '118px' : '190px';
  const gap = compact ? '8px' : '10px';
  return `        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:${gap}; margin-top:${compact ? '14px' : '16px'}">
          <button type="button" data-copy-prompt="${esc(id)}" style="appearance:none; border:1px solid #26221d; background:#26221d; color:#fff; border-radius:8px; width:${width}; min-height:38px; padding:0 12px; display:inline-flex; align-items:center; justify-content:center; font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:500; letter-spacing:.04em; cursor:pointer"><span data-copy-label>${esc(label)}</span></button>
          <button type="button" data-disclose="${esc(id)}" class="cr-mono-chip" style="appearance:none; border:0; background:transparent; padding:0 2px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#6f665c; text-decoration:underline; cursor:pointer">view the prompt</button>
        </div>
        <pre id="${esc(id)}" data-disclosure hidden style="white-space:pre-wrap; overflow:auto; max-height:340px; margin:${compact ? '10px' : '12px'} 0 0; padding:14px 16px; border:1px solid #e0d9cd; border-radius:11px; background:#f4f1ea; color:#3a352e; font-family:'JetBrains Mono',monospace; font-size:12px; line-height:1.55">${esc(prompt)}</pre>`;
}

function industryData(stats: readonly SourcedStat[] | undefined, id: string): string {
  if (!stats || stats.length === 0) return '';
  const rows = stats
    .map((s) => `          <li style="display:flex; gap:10px; font-size:13.5px; line-height:1.5; color:#4a443c">
            <span style="color:#9b9286; flex:none">&rarr;</span>
            <span>${esc(s.text)} <a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:#26221d; font-weight:600; text-decoration:underline">${esc(s.publisher)}, ${esc(s.date)}</a></span>
          </li>`)
    .join('\n');
  return `        <div style="margin-top:16px">
          <button type="button" data-disclose="${esc(id)}" class="cr-mono-chip" style="appearance:none; border:1px solid #e0d9cd; background:#f4f1ea; border-radius:999px; padding:8px 11px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#4a443c; cursor:pointer">${esc(INDUSTRY_DATA)}</button>
          <div id="${esc(id)}" data-disclosure hidden style="margin-top:10px; padding:14px 16px; border:1px solid #e7e1d8; border-radius:11px; background:#fbfaf8">
            <ul style="margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px">
${rows}
            </ul>
          </div>
        </div>`;
}

function dataCostLines(cost: ClientReportCostBlock): string {
  if (!cost.dataCost) return '';
  const estimateId = costId('cr', cost.tab, 'data-cost-estimate');
  return `        <div style="margin-top:10px; padding:11px 13px; border:1px solid #e0d9cd; border-radius:10px; background:#fbfaf8; max-width:64ch">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13.5px; line-height:1.45; color:#4a443c">${costChip('measured')}<span>${esc(cost.dataCost.measuredLine)}</span></div>
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13.5px; line-height:1.45; color:#4a443c; margin-top:6px">${costChip('estimated')}<span>${esc(cost.dataCost.estimatedLine)}</span><button type="button" data-disclose="${esc(estimateId)}" class="cr-mono-chip" style="appearance:none; border:0; background:transparent; padding:0 2px; min-height:32px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#6f665c; text-decoration:underline; cursor:pointer">how we estimated this</button></div>
          <div id="${esc(estimateId)}" data-disclosure hidden style="font-family:'JetBrains Mono',monospace; font-size:11.5px; line-height:1.5; color:#6f665c; margin-top:7px">${esc(cost.dataCost.formula)}</div>
        </div>`;
}

function costBlock(cost: ClientReportCostBlock | undefined): string;
function costBlock(cost: ClientReportCostBlock | undefined, slot: 'top' | 'bottom'): string;
function costBlock(cost: ClientReportCostBlock | undefined, slot?: 'top' | 'bottom'): string {
  if (!cost) return '';
  const cell = COST_STATE_MATRIX[cost.tab][cost.state];
  const chip = cost.chip ?? cell.chip;
  const stateCopy = cell.copy;
  const headline = cell.rendersCostNumber ? cost.headline : cost.headline ?? stateCopy;
  const top = headline || chip || cost.checkLine
    ? `      <div style="margin:0 0 16px; max-width:70ch">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:9px; margin-bottom:${cost.headlineSub && cell.rendersCostNumber ? '5px' : '0'}">
          ${headline ? `<div style="font-size:${cell.rendersCostNumber ? '16.5px' : '15px'}; line-height:1.45; font-weight:${cell.rendersCostNumber ? '700' : '600'}; color:#26221d">${esc(headline)}</div>` : ''}
          ${costChip(chip)}
        </div>
        ${cost.headlineSub && cell.rendersCostNumber ? `<div style="font-size:14px; line-height:1.45; color:#6f665c; margin-bottom:8px">${esc(cost.headlineSub)}</div>` : ''}
        ${cost.checkLine && cell.rendersCostNumber ? `<div style="font-family:'JetBrains Mono',monospace; font-size:12px; line-height:1.5; color:#6f665c">${esc(cost.checkLine)}</div>` : ''}
${cell.rendersCostNumber ? dataCostLines(cost) : ''}
      </div>`
    : '';
  const promptId = costId('cr', cost.tab, 'site-prompt');
  const dataId = costId('cr', cost.tab, 'industry-data');
  const prompt = cell.rendersCopyPromptButton ? copyPromptControl(cost.sitePrompt, promptId) : '';
  const stats = cell.rendersIndustryDataExpander ? industryData(cost.stats, dataId) : '';
  const bottom = cell.rendersFullTreatment && (cost.affectsProse || prompt || stats)
    ? `      <div style="margin-top:16px; padding:18px 20px; border:1px solid #e7e1d8; border-radius:13px; background:#ffffff; max-width:72ch">
        <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#9b9286; margin-bottom:8px">${esc(WHAT_THIS_AFFECTS)}</div>
        ${cost.affectsProse ? `<p style="font-size:15.5px; line-height:1.58; color:#3a352e; margin:0">${esc(cost.affectsProse)}</p>` : ''}
${prompt}
${stats}
      </div>`
    : '';
  if (slot === 'top') return top;
  if (slot === 'bottom') return bottom;
  return `${top}${bottom}`;
}

function verdictHead(
  question: string,
  status: ClientReportStatus,
  dim: ClientReportDimNarrative,
  startHere?: ClientReportStartHere,
  blocked?: boolean,
  score?: number,
  cost?: ClientReportCostBlock,
): string {
  const p = blocked ? NEUTRAL : PAL[status];
  const badge = blocked ? '' : scoreBadge(score, status);
  return `    <div style="margin-bottom:30px">
      <div style="font-size:13.5px; font-weight:600; letter-spacing:.01em; color:#9b9286; margin-bottom:6px">${esc(question)}</div>
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:10px">
        <div style="font-size:26px; font-weight:800; letter-spacing:-.02em; color:${p.fg}">${esc(dim.verdictWord)}</div>
        ${badge}
      </div>
      ${costBlock(cost, 'top')}
      <p style="font-size:17px; line-height:1.55; color:#3a352e; margin:0 0 16px; max-width:64ch">${emphasize(esc(dim.verdictPara))}</p>
      ${!blocked && startHere && (startHere.items.length || startHere.lead) ? startHereBlock(status, startHere) : ''}
      ${costBlock(cost, 'bottom')}
    </div>`;
}

// `label` is an internal static string (+ count), never page data, so it is raw
// (escaping it would print the &middot; entity literally).
function sectionKicker(label: string): string {
  return `    <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#9b9286; margin:0 0 14px">${label}</div>`;
}

const monoPath = (path: string, liveUrl?: string): string =>
  liveUrl
    ? `<a href="${esc(liveUrl)}" style="font-family:'JetBrains Mono',monospace; font-size:12.5px; color:#9b9286; text-decoration:none">${esc(path)}</a>`
    : `<span style="font-family:'JetBrains Mono',monospace; font-size:12.5px; color:#9b9286">${esc(path)}</span>`;

// Beat palette: first content = blue, biggest piece = orange, layout jump = red.
// `ring` is the frame's box-shadow color, `lbl` the caption.
const FRAME_BEAT: Record<ClientReportBeat, { ring: string; lbl: string }> = {
  'first-content': { ring: '#2b6cb0', lbl: '#2b6cb0' },
  lcp: { ring: '#d98324', lbl: '#9a5a12' },
  shift: { ring: '#c0271f', lbl: '#951c15' },
};

// a11y crop-box colors by severity bucket (matches the design + the sev chips):
// high = red, moderate = orange, low = amber.
const A11Y_BOX_COL: Record<'hi' | 'mid' | 'lo', { border: string; fill: string }> = {
  hi: { border: '#c0271f', fill: 'rgba(192,39,31,.16)' },
  mid: { border: '#d98324', fill: 'rgba(217,131,36,.16)' },
  lo: { border: '#caa63a', fill: 'rgba(202,166,58,.15)' },
};
// Maps a sev-chip label to the box severity bucket it toggles.
const SEV_LEVEL: Record<string, 'hi' | 'mid' | 'lo'> = { 'high-impact': 'hi', moderate: 'mid', low: 'lo' };

// Bold the time spans (e.g. "5.3s", "6 seconds", "6-10 seconds", "900ms") in an
// ALREADY-ESCAPED string - the wait time is the number that matters most.
function boldTimes(safeHtml: string): string {
  return safeHtml.replace(
    /(\d+(?:\.\d+)?(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?\+?\s?(?:seconds?|secs?|ms|s)\b)/gi,
    '<strong style="font-weight:700">$1</strong>',
  );
}

// Bold the main fact in a verdict paragraph so it jumps out: the wait time, the
// count of issues/pages, and the score/percentage (the headline number on the
// AI-visibility tab). We deliberately do NOT bold "search engines" etc. - the
// highlight is for the problem, not the SEO aside. Runs on an ALREADY-ESCAPED
// string; the <strong> tags it inserts never contain a matchable token, so a
// later pass can't match inside an earlier tag.
function emphasize(safeHtml: string): string {
  let s = boldTimes(safeHtml);
  s = s.replace(/(\b\d+\+?\s+(?:[a-z][a-z-]*\s+){0,2}(?:issues?|barriers?|pages?|problems?|controls?|errors?))/gi, '<strong style="font-weight:700">$1</strong>');
  s = s.replace(/(\b\d+ out of \d+\b|\b\d+\/100\b|\b\d+%)/g, '<strong style="font-weight:700">$1</strong>');
  return s;
}

// ---- PERFORMANCE ----

function perfFrame(f: ClientReportFrame): string {
  const beat = f.beat ? FRAME_BEAT[f.beat] : null;
  const ring = beat ? `0 0 0 4px ${beat.ring}, 0 0 0 6px ${beat.ring}33` : `0 0 0 1px ${LINE}`;
  const lbl = beat ? beat.lbl : FAINT;
  const boxes = (f.boxes ?? [])
    .map((b) => `<span style="position:absolute; left:${b.left}; top:${b.top}; width:${b.width}; height:${b.height}; border:2px solid rgba(192,39,31,.9); background:rgba(192,39,31,.18); border-radius:3px; box-shadow:0 0 0 1px rgba(255,255,255,.45)"></span>`)
    .join('');
  // Full phone shot (height:auto), not a cover-crop, so the frame reads at the
  // same quality as the internal report and the shift boxes line up.
  const inner = f.imgUri
    ? `<div class="cr-shot" role="button" tabindex="0" data-lb-src="${esc(f.imgUri)}" data-lb-label="${esc(f.label)}" data-lb-time="${esc(f.time)}" data-lb-detail="${esc(f.detail ?? f.label)}" style="position:relative; border-radius:9px; overflow:hidden; background:#fbfaf8"><img loading="lazy" src="${esc(f.imgUri)}" alt="${esc(f.label)} at ${esc(f.time)}" style="display:block; width:100%; height:auto" />${boxes}</div>`
    : `<div style="border-radius:9px; overflow:hidden; background:#fbfaf8; aspect-ratio:9 / 19.5"></div>`;
  return `                <div style="width:116px; text-align:center">
                  <div style="border-radius:13px; padding:5px; background:#322d27; box-shadow:${ring}">
                    ${inner}
                  </div>
                  <div style="margin-top:9px; font-size:14px; font-weight:700; color:${lbl}">${esc(f.label)}</div>
                  <div style="font-size:13px; color:#9b9286; font-family:'JetBrains Mono',monospace">${esc(f.time)}</div>
                </div>`;
}

function perfVideo(c: ClientReportPerfCard): string {
  const fg = PAL[c.status].fg;
  let screen: string;
  if (c.videoUri) {
    const cuesAttr = c.cues && c.cues.length ? ` data-cues="${esc(JSON.stringify(c.cues))}"` : '';
    // Full screencast (height:auto), no cover-crop. The caption band is
    // pointer-events:none so the native scrubber/seconds stay usable on hover.
    screen = `<video controls muted loop playsinline preload="none"${c.posterUri ? ` poster="${esc(c.posterUri)}"` : ''} style="display:block; width:100%; height:auto; background:#fbfaf8"><source src="${esc(c.videoUri)}" type="video/mp4" /></video>
                <div class="cr-vidcap"${cuesAttr} aria-hidden="true"><span class="cr-vidcap-tx"></span></div>`;
  } else if (c.posterUri) {
    screen = `<img src="${esc(c.posterUri)}" alt="${esc(c.name)} loaded" style="display:block; width:100%; height:auto" />`;
  } else {
    return '';
  }
  return `          <div style="flex:none; width:264px">
            <div style="background:#2c2823; border-radius:30px; padding:8px; box-shadow:0 14px 34px rgba(38,34,29,.20)">
              <div class="loadvid-screen" style="position:relative; border-radius:22px; overflow:hidden; background:#fbfaf8">
                ${screen}
              </div>
            </div>
            <p style="font-size:13.5px; line-height:1.45; color:#6f665c; margin:12px 6px 0; text-align:center"><span style="color:${fg}; font-weight:700">&#9654;</span> ${esc(c.videoCap)}</p>
          </div>`;
}

function perfCard(c: ClientReportPerfCard, index: number): string {
  const p = PAL[c.status];
  const facts = c.facts
    .map((ft) => `            <div style="font-size:13px; color:#6f665c; background:#f4f1ea; border-radius:8px; padding:6px 11px; white-space:nowrap"><b style="font-weight:700; color:${PAL[ft.status].fg}">${esc(ft.val)}</b> ${esc(ft.label)}</div>`)
    .join('\n');
  const prompt = copyPromptControl(c.copyPrompt, costId('cr', 'perf-card', index, c.id), true);
  const video = perfVideo(c);
  const frames = c.frames.length
    ? `          <div style="flex:1; min-width:300px">
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9b9286; margin:2px 0 12px">Frame by frame &middot; ${c.totalFrames} captured</div>
            <div class="cr-strip" style="display:flex; gap:13px; align-items:flex-start; flex-wrap:wrap">
${c.frames.map(perfFrame).join('\n')}
            </div>
          </div>`
    : '';
  const watch = video || frames
    ? `        <div style="display:flex; gap:26px; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap">
${[video, frames].filter(Boolean).join('\n')}
        </div>`
    : '';
  return `      <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:22px 24px; margin-bottom:14px">
        <div style="display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:12px 16px; margin-bottom:14px">
          <div style="min-width:0">
            <div style="font-size:19px; font-weight:700; letter-spacing:-.01em; margin-bottom:3px">${esc(c.name)}</div>
            ${monoPath(c.path, c.liveUrl)}
          </div>
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px">
${facts}
            <span style="display:inline-flex; align-items:center; gap:8px; background:${p.bg}; border:1px solid ${p.line}; border-radius:999px; padding:7px 14px 7px 12px; font-size:13.5px; font-weight:700; color:${p.fg}; white-space:nowrap">
              <span style="width:8px; height:8px; border-radius:50%; background:${p.fg}"></span>${esc(clientReportStatusWord(c.status))}
            </span>
          </div>
        </div>
        <div style="font-size:17px; font-weight:600; line-height:1.4; margin-bottom:5px; letter-spacing:-.01em">${c.headlineHtml}</div>
        ${c.sub ? `<p style="font-size:15.5px; line-height:1.55; color:#6f665c; margin:0 0 18px; max-width:62ch">${boldTimes(esc(c.sub))}</p>` : ''}
${watch}
        ${c.plain ? `<div style="font-size:15.5px; line-height:1.6; color:#4a443c; max-width:64ch; margin-top:2px">${boldTimes(esc(c.plain))}</div>` : ''}
${prompt}
      </div>`;
}

function perfFineList(rows: ClientReportPerfFineRow[]): string {
  if (!rows.length) return '';
  // "Loading fine" only when every row is good; else a neutral heading.
  const allGood = rows.every((r) => r.status === 'good');
  const kicker = `${allGood ? 'Loading fine' : 'The rest of the pages we checked'} &middot; ${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`;
  const items = rows
    .map((r) => `      <div style="display:flex; align-items:center; gap:14px; padding:15px 0; border-top:1px solid #efeae2">
        <span style="width:9px; height:9px; border-radius:50%; background:${PAL[r.status].fg}; flex:none"></span>
        <div style="flex:1">
          <span style="font-size:15.5px; font-weight:600">${esc(r.name)}</span>
          <span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#9b9286; margin-left:9px">${esc(r.path)}</span>
        </div>
        <div style="font-size:14px; color:#6f665c; text-align:right; max-width:34ch">${esc(r.note)}</div>
      </div>`)
    .join('\n');
  return `${sectionKicker(kicker)}
    <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:6px 22px">
${items}
    </div>`;
}

function perfPanel(m: ClientReportModel, multi: boolean, first: boolean): string {
  const needs = m.perfCards.length;
  const body = `${verdictHead('Is your site fast enough on a phone?', m.perfStatus, m.narrative.perf, m.perfStartHere, m.perfCouldNotMeasure, m.perfScore, m.perfCost)}
${needs ? sectionKicker(`Needs attention &middot; ${needs} ${needs === 1 ? 'page' : 'pages'}`) : ''}
${m.perfCards.map(perfCard).join('\n')}
${perfFineList(m.perfFine)}`;
  return panelWrap('perf', body, multi, first);
}

// ---- ACCESSIBILITY ----

function a11yShot(fr: ClientReportA11yFrame): string {
  const boxes = fr.boxes
    .map((b) => {
      // Design palette by severity: high = red, moderate = orange, low = amber.
      // 3px + a translucent fill so the color (and what it means) reads at a glance.
      const lvl = b.level ?? (b.hi ? 'hi' : 'mid');
      const c = A11Y_BOX_COL[lvl];
      return `<span class="cr-a11y-box cr-box-${lvl}" style="position:absolute; left:${b.left}; top:${b.top}; width:${b.width}; height:${b.height}; border:3px solid ${c.border}; background:${c.fill}; border-radius:3px; box-shadow:0 0 0 1px rgba(255,255,255,.55)"></span>`;
    })
    .join('');
  // count 0 = the whole-page fallback (structural issues, no spot to box): no "spots" suffix.
  const spots = fr.count > 0 ? ` ${fr.count} ${fr.count === 1 ? 'spot' : 'spots'}` : '';
  const lbCap = spots ? `${esc(fr.cap)} &middot;${spots}` : esc(fr.cap);
  const figW = fr.count > 0 ? 198 : 240;
  return `        <figure style="margin:0; width:${figW}px">
          <div class="a11y-shot cr-shot" data-lb-src="${esc(fr.imgUri)}" data-lb-cap="${lbCap}" style="position:relative; border-radius:11px; overflow:hidden; border:1px solid #e7e1d8; background:#fbfaf8; line-height:0">
            <img src="${esc(fr.imgUri)}" alt="Screenshot of the page with accessibility issues" loading="lazy" style="display:block; width:100%; height:auto" />${boxes}
          </div>
          <figcaption style="font-size:13.5px; line-height:1.45; color:#6f665c; margin-top:9px">${esc(fr.cap)}${spots ? ` <span style="color:#9b9286">&middot;${spots}</span>` : ''}</figcaption>
        </figure>`;
}

function scoreBadge(score: number | undefined, status: ClientReportStatus): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '';
  const p = PAL[status];
  return `<div style="flex:none; text-align:center; border:1px solid ${p.line}; background:${p.bg}; border-radius:11px; padding:7px 13px; min-width:62px">
            <div style="font-size:24px; font-weight:800; color:${p.fg}; line-height:1">${score}</div>
            <div style="font-size:9.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#9b9286; margin-top:3px">score</div>
          </div>`;
}

function a11yCard(c: ClientReportA11yCard, index: number): string {
  // A sev chip becomes a toggle ONLY for a severity that actually has boxes drawn
  // on this card's frames (moderate issues are mostly structural -> unboxed, so
  // their chip stays a plain count rather than a dead toggle).
  const boxedLevels = new Set(c.frames.flatMap((f) => f.boxes.map((b) => b.level)).filter(Boolean));
  const sev = c.sev
    .map((s) => {
      const base = `font-size:13.5px; font-weight:600; border-radius:7px; padding:5px 11px; background:${PAL[s.status].bg}; color:${PAL[s.status].fg}`;
      const lvl = SEV_LEVEL[s.label];
      return lvl && boxedLevels.has(lvl)
        ? `          <button type="button" class="cr-sev-chip" data-sev="${lvl}" aria-pressed="true" title="Click to show or hide these boxes on the frames" style="appearance:none; border:0; font-family:inherit; cursor:pointer; ${base}">${s.num} ${esc(s.label)}</button>`
        : `          <span style="${base}">${s.num} ${esc(s.label)}</span>`;
    })
    .join('\n');
  const sevHint = boxedLevels.size > 0
    ? `\n          <span style="font-size:12px; color:#9b9286; align-self:center">&larr; tap to highlight</span>`
    : '';
  const shots = c.frames.length
    ? `        <div class="cr-strip" style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:20px; align-items:flex-start">
${c.frames.map(a11yShot).join('\n')}
        </div>`
    : '';
  const fixes = c.fixes.length
    ? `        <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#9b9286; margin-bottom:9px">What to change</div>
        <ul style="margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px">
${c.fixes.map((fix) => `          <li style="display:flex; gap:10px; font-size:15px; line-height:1.5; color:#4a443c"><span style="color:${PAL.fair.fg}; font-weight:700; flex:none">&rarr;</span><span>${esc(fix)}</span></li>`).join('\n')}
        </ul>`
    : '';
  const prompt = copyPromptControl(c.copyPrompt, costId('cr', 'a11y-card', index, c.path), true);
  return `      <div class="cr-a11y-card" style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:22px 24px; margin-bottom:14px">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px">
          <div>
            <div style="font-size:19px; font-weight:700; letter-spacing:-.01em; margin-bottom:3px">${esc(c.name)}</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:12.5px; color:#9b9286">${esc(c.path)}</div>
          </div>
          ${scoreBadge(c.score, c.status)}
        </div>
        ${sev ? `<div style="display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px; align-items:center">\n${sev}${sevHint}\n        </div>` : ''}
        ${c.summary ? `<p style="font-size:15.5px; line-height:1.55; color:#3a352e; margin:0 0 18px; max-width:64ch">${esc(c.summary)}</p>` : ''}
${shots}
${fixes}
${prompt}
      </div>`;
}

function a11yFineList(rows: ClientReportA11yFineRow[]): string {
  if (!rows.length) return '';
  const items = rows
    .map((r) => {
      const p = PAL[r.status];
      const badge = typeof r.score === 'number'
        ? `<div style="flex:none; text-align:center; border-radius:9px; padding:5px 10px; background:${p.bg}; min-width:48px"><div style="font-size:18px; font-weight:800; color:${p.fg}; line-height:1">${r.score}</div></div>`
        : '';
      return `      <div style="display:flex; align-items:center; gap:16px; padding:16px 0; border-top:1px solid #efeae2">
        ${badge}
        <div style="flex:1">
          <div style="font-size:15.5px; font-weight:600; margin-bottom:2px">${esc(r.name)} <span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#9b9286; font-weight:400; margin-left:5px">${esc(r.path)}</span></div>
          <div style="font-size:14px; line-height:1.5; color:#6f665c">${esc(r.summary)}</div>
        </div>
      </div>`;
    })
    .join('\n');
  return `${sectionKicker(`Lighter issues &middot; ${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`)}
    <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:6px 22px">
${items}
    </div>`;
}

// Pages walled by a bot challenge: shown as "could not measure", never scored or
// counted. No frame - per the rule, a frame is shown only for a real measurement.
function blockedSection(rows: ClientReportBlockedPage[], includeIntro = true): string {
  if (!rows.length) return '';
  const items = rows
    .map((r) => `      <div style="display:flex; align-items:center; gap:12px; padding:14px 0; border-top:1px solid #efeae2">
        <span style="width:8px; height:8px; border-radius:50%; background:${NEUTRAL.fg}; flex:none"></span>
        <div style="font-size:15.5px; font-weight:600">${esc(r.name)} <span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#9b9286; font-weight:400; margin-left:5px">${esc(r.path)}</span></div>
      </div>`)
    .join('\n');
  const intro = includeIntro
    ? `    <p style="font-size:14.5px; line-height:1.55; color:#6f665c; margin:0 0 12px; max-width:64ch">The site's bot protection served our checker a challenge page instead of the real page, so these could not be measured. Allowlist our checker and we will re-run a clean pass.</p>
`
    : '';
  return `${sectionKicker(`Could not measure &middot; ${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`)}
${intro}
    <div style="background:#ffffff; border:1px solid ${NEUTRAL.line}; border-radius:14px; padding:6px 22px">
${items}
    </div>`;
}

function a11yPanel(m: ClientReportModel, multi: boolean, first: boolean): string {
  const needs = m.a11yCards.length;
  const body = `${verdictHead('Can everyone use your site?', m.a11yStatus, m.narrative.a11y, m.a11yStartHere, m.a11yCouldNotMeasure, m.a11yScore, m.a11yCost)}
${needs ? sectionKicker(`Needs attention &middot; ${needs} ${needs === 1 ? 'page' : 'pages'}`) : ''}
${m.a11yCards.map(a11yCard).join('\n')}
${a11yFineList(m.a11yFine)}
${blockedSection(m.a11yBlocked)}`;
  return panelWrap('a11y', body, multi, first);
}

// ---- AI VISIBILITY (Agent Ready) ----

function agentSiteCard(site: ClientReportAgentSite): string {
  const p = PAL[site.status];
  const checks = site.checks
    .map((ck) => {
      const dot = ck.ok === 'ok' ? PAL.good.fg : ck.ok === 'na' ? '#c3bcae' : PAL.poor.fg;
      return `          <div style="display:flex; gap:11px; align-items:flex-start">
            <span style="width:8px; height:8px; border-radius:50%; background:${dot}; flex:none; margin-top:6px"></span>
            <span style="font-size:14.5px; line-height:1.5; color:#4a443c">${esc(ck.tx)}</span>
          </div>`;
    })
    .join('\n');
  return `      <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:22px 24px; margin-bottom:22px">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:6px">
          <div>
            <div style="font-size:18px; font-weight:700; letter-spacing:-.01em">Can AI reach your site at all?</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#9b9286; margin-top:3px">site-wide</div>
          </div>
          <div style="flex:none; text-align:center; border:1px solid ${p.line}; background:${p.bg}; border-radius:11px; padding:7px 13px; min-width:62px">
            <div style="font-size:24px; font-weight:800; color:${p.fg}; line-height:1">${site.score}</div>
            <div style="font-size:9.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#9b9286; margin-top:3px">access</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:9px; margin-top:14px">
${checks}
        </div>
      </div>`;
}

function agentCard(c: ClientReportAgentCard, index: number): string {
  const p = PAL[c.status];
  const factors = c.factors
    .map((f) => {
      const fp = PAL[f.status];
      return `          <div>
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px">
              <span style="font-size:14px; font-weight:600; color:#4a443c">${esc(f.name)}</span>
              <span style="font-size:14px; font-weight:700; color:${fp.fg}; font-family:'JetBrains Mono',monospace">${f.score}</span>
            </div>
            <div style="height:7px; border-radius:99px; background:#efe9df; overflow:hidden">
              <div style="height:100%; border-radius:99px; width:${f.score}%; background:${fp.fg}"></div>
            </div>
          </div>`;
    })
    .join('\n');
  const fixes = c.fixes.length
    ? `        <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#9b9286; margin-bottom:9px">What to change</div>
        <ul style="margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px">
${c.fixes.map((fix) => `          <li style="display:flex; gap:10px; font-size:15px; line-height:1.5; color:#4a443c"><span style="color:${PAL.good.fg}; font-weight:700; flex:none">&rarr;</span><span>${esc(fix)}</span></li>`).join('\n')}
        </ul>`
    : '';
  const prompt = copyPromptControl(c.copyPrompt, costId('cr', 'agent-card', index, c.path), true);
  return `      <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:22px 24px; margin-bottom:14px">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px">
          <div>
            <div style="font-size:19px; font-weight:700; letter-spacing:-.01em; margin-bottom:3px">${esc(c.name)}</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:12.5px; color:#9b9286">${esc(c.path)}</div>
          </div>
          <div style="flex:none; text-align:center; border:1px solid ${p.line}; background:${p.bg}; border-radius:11px; padding:7px 13px; min-width:62px"${c.capped ? ' title="Capped because most content is not reachable without JavaScript"' : ''}>
            <div style="font-size:24px; font-weight:800; color:${p.fg}; line-height:1">${c.score}</div>
            <div style="font-size:9.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#9b9286; margin-top:3px">/ 100</div>
          </div>
        </div>
        <div style="font-size:16px; font-weight:600; line-height:1.4; margin-bottom:4px; letter-spacing:-.01em">${c.headlineHtml}</div>
        ${c.sub ? `<p style="font-size:15.5px; line-height:1.55; color:#6f665c; margin:0 0 18px; max-width:62ch">${esc(c.sub)}</p>` : ''}
${prompt}
        ${factors ? `<div style="display:flex; flex-direction:column; gap:12px; margin-bottom:18px">\n${factors}\n        </div>` : ''}
${fixes}
      </div>`;
}

function agentFineList(rows: ClientReportAgentFineRow[]): string {
  if (!rows.length) return '';
  // These pages all "read well", so per-page notes just repeat ("~100% of content
  // in the HTML, cleanly marked up"). Say it ONCE above, then list compact rows.
  const items = rows
    .map((r) => {
      const p = PAL[r.status];
      return `      <div style="display:flex; align-items:center; gap:16px; padding:13px 0; border-top:1px solid #efeae2">
        <div style="flex:none; text-align:center; border-radius:9px; padding:5px 10px; background:${p.bg}; min-width:48px"><div style="font-size:18px; font-weight:800; color:${p.fg}; line-height:1">${r.score}</div></div>
        <div style="flex:1; font-size:15.5px; font-weight:600">${esc(r.name)} <span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#9b9286; font-weight:400; margin-left:5px">${esc(r.path)}</span></div>
      </div>`;
    })
    .join('\n');
  return `${sectionKicker(`Reading well &middot; ${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`)}
    <p style="font-size:14.5px; line-height:1.55; color:#6f665c; margin:0 0 12px; max-width:64ch">Nearly all of each page's content is already in the HTML and cleanly marked up, so AI tools read these fine.</p>
    <div style="background:#ffffff; border:1px solid #e7e1d8; border-radius:14px; padding:6px 22px">
${items}
    </div>`;
}

function agentPanel(m: ClientReportModel, multi: boolean, first: boolean): string {
  const needs = m.agentCards.length;
  const body = `${verdictHead('Can AI read and recommend you?', m.agentStatus, m.narrative.agent, m.agentStartHere, m.agentCouldNotMeasure, m.agentScore, m.agentCost)}
${m.agentSite ? agentSiteCard(m.agentSite) : ''}
${needs ? sectionKicker(`Page-level gaps &middot; ${needs} ${needs === 1 ? 'page' : 'pages'}`) : ''}
${m.agentCards.map(agentCard).join('\n')}
${agentFineList(m.agentFine)}
${blockedSection(m.agentBlocked, !(m.agentCouldNotMeasure && m.agentCost?.state === 'blocked'))}`;
  return panelWrap('agent', body, multi, first);
}

// Single section -> always visible; multi -> first shown, rest hidden.
function panelWrap(id: string, body: string, multi: boolean, first: boolean): string {
  const hidden = multi && !first ? ' hidden' : '';
  return `  <div class="cr-panel" id="cr-panel-${id}" role="tabpanel"${hidden}>
${body}
  </div>`;
}

// ---- scripts ----
const SCRIPTS = `<script>
(function(){
  // Tabs + exec-tile jumps.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.cr-tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.cr-panel'));
  function show(id){
    panels.forEach(function(p){ p.hidden = (p.id !== 'cr-panel-' + id); });
    tabs.forEach(function(t){
      var on = t.getAttribute('data-tab') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.style.color = on ? '#26221d' : '#6f665c';
      t.style.borderBottomColor = on ? '#26221d' : 'transparent';
    });
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ show(t.getAttribute('data-tab')); }); });
  document.querySelectorAll('[data-jump]').forEach(function(b){
    b.addEventListener('click', function(){ if(document.getElementById('cr-panel-' + b.getAttribute('data-jump'))) show(b.getAttribute('data-jump')); });
  });

  // Disclosure contract: button uses data-disclose="<target-id>"; target uses
  // id="<target-id>" data-disclosure hidden. This handler owns aria-controls,
  // aria-expanded, and the target's hidden attribute; print CSS opens targets.
  function disclosureTarget(control){
    var id = control.getAttribute('data-disclose');
    if(!id) return null;
    var target = document.getElementById(id);
    if(!target || !target.hasAttribute('data-disclosure')) return null;
    return target;
  }
  function syncDisclosure(control, target){
    control.setAttribute('aria-controls', target.id);
    control.setAttribute('aria-expanded', target.hidden ? 'false' : 'true');
  }
  document.querySelectorAll('[data-disclose]').forEach(function(control){
    var target = disclosureTarget(control);
    if(target) syncDisclosure(control, target);
  });
  document.addEventListener('click', function(e){
    var control = e.target && e.target.closest && e.target.closest('[data-disclose]');
    if(!control) return;
    var target = disclosureTarget(control);
    if(!target) return;
    var willOpen = target.hidden;
    target.hidden = !willOpen;
    syncDisclosure(control, target);
  });

  function fallbackCopyPrompt(text){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{ return document.execCommand('copy'); }
    catch(e){ return false; }
    finally { document.body.removeChild(ta); }
  }
  function copyPromptText(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).then(function(){ return true; }).catch(function(){ return fallbackCopyPrompt(text); });
    }
    return Promise.resolve(fallbackCopyPrompt(text));
  }
  document.querySelectorAll('[data-copy-prompt]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-copy-prompt');
      var pre = id ? document.getElementById(id) : null;
      if(!pre) return;
      var label = btn.querySelector('[data-copy-label]') || btn;
      var original = btn.getAttribute('data-copy-original') || label.textContent || 'Copy';
      btn.setAttribute('data-copy-original', original);
      copyPromptText(pre.textContent || '').then(function(ok){
        label.textContent = ok ? 'Copied' : 'Copy failed';
        window.clearTimeout(btn._copyTimer);
        btn._copyTimer = window.setTimeout(function(){ label.textContent = original; }, 2000);
      }).catch(function(){
        label.textContent = 'Copy failed';
        window.clearTimeout(btn._copyTimer);
        btn._copyTimer = window.setTimeout(function(){ label.textContent = original; }, 2000);
      });
    });
  });

  // On-video captions: reveal each beat as the clip reaches its time, behind a
  // dark lower-third scrim so the white text stays legible during playback (not
  // tied to hover).
  document.querySelectorAll('.cr-vidcap[data-cues]').forEach(function(band){
    var v = band.parentElement && band.parentElement.querySelector('video');
    var tx = band.querySelector('.cr-vidcap-tx');
    if(!v || !tx) return;
    var cues;
    try{ cues = JSON.parse(band.getAttribute('data-cues') || '[]'); }catch(e){ return; }
    if(!cues.length) return;
    cues.sort(function(a,b){ return a.t - b.t; });
    var cur = -1;
    function sync(){
      if(v.paused && v.currentTime === 0){ if(cur !== -1){ cur = -1; band.classList.remove('cr-show'); } return; }
      var ms = v.currentTime * 1000, i = 0;
      for(var k=0;k<cues.length;k++){ if(cues[k].t <= ms) i = k; else break; }
      if(i === cur) return;
      cur = i; tx.textContent = cues[i].x; band.classList.add('cr-show');
    }
    v.addEventListener('timeupdate', sync); v.addEventListener('play', sync); v.addEventListener('seeking', sync); v.addEventListener('pause', sync); sync();
  });

  // Lightbox: click a frame to enlarge; the arrows / ArrowLeft-Right step through
  // the same strip; Esc or a backdrop click closes.
  var lb = document.getElementById('cr-lb');
  if(lb){
    var lbStage = document.getElementById('cr-lb-stage'), lbCap = document.getElementById('cr-lb-cap');
    var btnPrev = document.getElementById('cr-lb-prev'), btnNext = document.getElementById('cr-lb-next'), btnClose = document.getElementById('cr-lb-close');
    var strip = [], idx = -1;
    var renderCap = function(el){
      lbCap.innerHTML = '';
      var detail = el.getAttribute('data-lb-detail');
      if(detail !== null){ // perf frame: bold role + time + the long detail (minus the leading "Role - ")
        var b = document.createElement('b'); b.textContent = el.getAttribute('data-lb-label') || 'Frame'; lbCap.appendChild(b);
        var tail = [el.getAttribute('data-lb-time') || '', detail.replace(/^.*?- /, '')].filter(function(x){ return x; }).join(' · ');
        if(tail) lbCap.appendChild(document.createTextNode(' · ' + tail));
      } else { // a11y crop: the pre-built caption (getAttribute already decoded entities; textContent can't inject)
        lbCap.textContent = el.getAttribute('data-lb-cap') || '';
      }
    };
    var render = function(){
      var el = strip[idx]; if(!el) return;
      // Clone the frame WITH its layout-shift box overlay (the % boxes scale with
      // the image), not just the bare src - so the big view shows the jump too.
      // Reset any boxes the sev-chip toggle hid, so the enlarged view is complete.
      var node = el.cloneNode(true);
      var nb = node.querySelectorAll('.cr-a11y-box');
      for (var bi = 0; bi < nb.length; bi++) nb[bi].style.display = '';
      lbStage.innerHTML = ''; lbStage.appendChild(node);
      renderCap(el);
      if(btnPrev) btnPrev.disabled = idx <= 0;
      if(btnNext) btnNext.disabled = idx >= strip.length - 1;
    };
    var openFrom = function(el){
      var box = el.closest('.cr-strip') || el.parentNode;
      strip = Array.prototype.slice.call(box.querySelectorAll('.cr-shot'));
      idx = strip.indexOf(el); if(idx < 0){ strip = [el]; idx = 0; }
      render(); lb.classList.add('open');
    };
    var go = function(d){ var n = idx + d; if(n < 0 || n >= strip.length) return; idx = n; render(); };
    var close = function(){ lb.classList.remove('open'); lbStage.innerHTML = ''; };
    document.querySelectorAll('.cr-shot').forEach(function(el){
      el.addEventListener('click', function(){ openFrom(el); });
      el.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openFrom(el); } });
    });
    if(btnPrev) btnPrev.addEventListener('click', function(e){ e.stopPropagation(); go(-1); });
    if(btnNext) btnNext.addEventListener('click', function(e){ e.stopPropagation(); go(1); });
    if(btnClose) btnClose.addEventListener('click', function(e){ e.stopPropagation(); close(); });
    lb.addEventListener('click', function(e){ if(e.target && e.target.closest && !e.target.closest('.cr-lb-stage, button')) close(); });
    document.addEventListener('keydown', function(e){
      if(!lb.classList.contains('open')) return;
      if(e.key === 'Escape'){ e.preventDefault(); close(); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(-1); }
      else if(e.key === 'ArrowRight'){ e.preventDefault(); go(1); }
    });
  }

  // Accessibility: each severity chip toggles its own boxes on that card's frames.
  document.querySelectorAll('.cr-sev-chip').forEach(function(chip){
    chip.addEventListener('click', function(){
      var card = chip.closest('.cr-a11y-card'); if(!card) return;
      var sev = chip.getAttribute('data-sev');
      var off = chip.classList.toggle('cr-sev-off');
      chip.setAttribute('aria-pressed', off ? 'false' : 'true');
      card.querySelectorAll('.cr-box-' + sev).forEach(function(b){ b.style.display = off ? 'none' : ''; });
    });
  });
})();
</script>`;

export function renderClientReportHtml(m: ClientReportModel): string {
  const sections: { has: boolean; html: (multi: boolean, first: boolean) => string }[] = [
    { has: m.hasPerf, html: (multi: boolean, first: boolean) => perfPanel(m, multi, first) },
    { has: m.hasA11y, html: (multi: boolean, first: boolean) => a11yPanel(m, multi, first) },
    { has: m.hasAgent, html: (multi: boolean, first: boolean) => agentPanel(m, multi, first) },
  ].filter((s) => s.has);
  const multi = sections.length > 1;
  // First present section is shown on load (from order, not a hardcoded perf-first).
  const panels = sections.map((s, i) => s.html(multi, i === 0)).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${m.faviconLinkTag}
<title>Site health report - ${esc(m.domain)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${HEAD_STYLE}</style>
</head>
<body>
<div style="background:#f7f5f0; color:#26221d; font-family:'Hanken Grotesk',system-ui,sans-serif; -webkit-font-smoothing:antialiased; min-height:100vh; padding:0 20px 80px">
<div class="cr-wrap" style="max-width:960px; margin:0 auto; padding-top:46px">

${masthead(m)}

${bottomLine(m)}

${tiles(m)}

${tabs(m)}

${panels}

  <div style="margin-top:46px; padding:24px; background:#26221d; border-radius:16px; color:#e7e1d6">
    <p style="font-size:16px; line-height:1.6; margin:0; max-width:66ch">${esc(m.outro)}</p>
  </div>
  <p style="font-size:13px; line-height:1.65; color:#9b9286; margin:22px 2px 0; max-width:70ch">${esc(m.footnote)}</p>

</div>
</div>

<div class="cr-lb" id="cr-lb" role="dialog" aria-modal="true" aria-label="Enlarged frame">
  <button class="cr-lb-close" id="cr-lb-close" type="button" aria-label="Close">&times;</button>
  <button class="cr-lb-arrow cr-lb-prev" id="cr-lb-prev" type="button" aria-label="Previous frame">&#8249;</button>
  <button class="cr-lb-arrow cr-lb-next" id="cr-lb-next" type="button" aria-label="Next frame">&#8250;</button>
  <div class="cr-lb-stage" id="cr-lb-stage"></div>
  <div class="cr-lb-cap" id="cr-lb-cap" style="position:absolute; bottom:20px; left:0; right:0; text-align:center; color:#eef1f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16.5px; line-height:1.5; padding:0 72px"></div>
</div>
${SCRIPTS}
</body>
</html>
`;
}
