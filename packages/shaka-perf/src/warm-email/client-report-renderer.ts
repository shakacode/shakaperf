/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  AI_STUDIES_OTHER_SITES_CAVEAT,
  CALC_HEADLINE_LABEL,
  CALC_HOW_WE_GOT_THIS_LABEL,
  CALC_DIAL_LABEL,
  CALC_HONESTY_FOOTER,
  CALC_INQUIRIES_LABEL,
  CALC_PARTIAL_LINE,
  CALC_PRIVACY_LINE,
  CALC_SHARE_PREFILL_LABEL,
  CALC_SHARE_LABEL,
  CALC_TITLE,
  CALC_VALUE_LABEL,
  COPY_FIX_INSTRUCTIONS,
  COPY_SITE_FIX_INSTRUCTIONS,
  COST_CHIP_LABELS,
  COST_STATE_MATRIX,
  INDUSTRY_DATA,
  MULTIPLES_FLOORED_NOTE,
  PAGESPEED_FIELD_VS_LAB_PREEMPT,
  VIEW_INSTRUCTIONS,
  WHAT_THIS_COSTS_YOU,
  calcBreakEvenLine,
  calcCapNote,
  calcTinyResultLine,
  type CostChip,
  type IndustryDataStat,
  type State as CostState,
  type Tab as CostTab,
} from './cost-strings';
import { escapeHtml as esc } from './html-escape';
import {
  RECOVERY_CAP,
  type BenchmarkScaleGeometry,
  type CostBlockExtras,
  type CostCalculatorConfig,
  type CostGap,
  type CostStakes,
  type StrongPageGroup,
} from './client-report-model/cost';
import { scoreStatus } from './client-report-model/perf';

// Client report renderer: pure templating over a fully-assembled
// `ClientReportModel` (built in ./client-report.ts, which does all the IO).
// Styling is inline per the design handoff; the <head> <style> only adds what
// inline can't (font, :hover, tab/lightbox JS, mobile reflow).

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
const COST_TIER_LABEL_WIDTH = 104;
const COST_TIER_GAP = 16;
const COST_TIER_CONTENT_OFFSET = 120;

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
  highImpact: number;
  status: ClientReportStatus;
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
export interface ClientReportCostBlock extends CostBlockExtras {
  tab: CostTab;
  state: CostState;
  headline?: string;
  headlineSub?: string;
  chip?: CostChip;
  checkLine?: string;
  affectsProse?: string;
  sitePrompt?: string;
  stats?: SourcedStat[];
  // Presentation slots added by the C renderer. Builder waves may omit them;
  // the renderer then leaves the corresponding visual detail out.
  scale?: Pick<BenchmarkScaleGeometry, 'axisMaxDisplay' | 'zones' | 'goodLinePercent' | 'poorLinePercent' | 'markerPercent'>;
  pageSpeedUrl?: string;
  aiTiles?: {
    invisiblePercent: number;
    readableWords: number;
    totalWords: number;
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
  a11yStrongPageGroup?: StrongPageGroup;
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
  // Wave 3 supplies this severity order. Keep the existing order when absent.
  tabOrder?: Array<'perf' | 'a11y' | 'agent'>;
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
  .cr-calculator-card input[type="number"]{transition:border-color .12s ease,box-shadow .12s ease}
  .cr-calculator-card input[type="number"]:focus-visible{outline:0;border-color:#26221d!important;box-shadow:0 0 0 3px rgba(38,34,29,.30)}
  .cr-calculator-card input[type="radio"]:focus-visible{outline:2px solid #26221d;outline-offset:2px}
  .cr-cost-chip{transition:background .12s ease}
  .cr-cost-chip:hover{background:#ece7dc!important}
  .cr-calc-teaser[aria-expanded="true"]{display:none!important}
  .cr-blank{border:0;border-bottom:2px solid #bcb3a7;border-radius:0;background:transparent;text-align:center;font:inherit;font-size:15px;font-weight:700;color:#26221d;padding:1px 2px}
  .cr-calculator-card input.cr-blank:focus-visible{outline:0;box-shadow:none;border-color:transparent;border-bottom-color:#26221d!important}
  .cr-band{position:relative;display:inline-flex;cursor:pointer}
  .cr-band input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
  .cr-band span{border:1px solid #d8d0c3;background:#fff;color:#3a352e;border-radius:999px;padding:8px 12px;font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.04em;transition:background .12s ease,color .12s ease,border-color .12s ease}
  .cr-band input:checked+span{background:#26221d;color:#f3efe7;border-color:#26221d}
  .cr-band input:focus-visible+span{outline:2px solid #26221d;outline-offset:2px}
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
  @media print{.cr-calc-teaser{display:none!important}.cr-calculator-card:has([data-calc-output][hidden]){display:none!important}.cr-calculator-card [data-disclose]{display:none!important}.cr-panel[hidden],[data-disclosure][hidden]{display:block!important}.cr-tabs{display:none!important}.cr-calculator-output[hidden]{display:none!important}.cr-calculator-card:not(.cr-calculator-has-output) .cr-calculator-fields{display:none!important}}
  @media (max-width:760px){
    .cr-tiles{grid-template-columns:1fr!important}
    .cr-wrap h1{font-size:30px!important}
    .cr-cost-tier{grid-template-columns:1fr!important;gap:8px!important}
    .cr-cost-tool{margin-left:0!important}
    .cr-cost-tiles{grid-template-columns:1fr 1fr!important}
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

type ClientReportSection = 'perf' | 'a11y' | 'agent';

const DEFAULT_SECTION_ORDER: readonly ClientReportSection[] = ['perf', 'a11y', 'agent'];

function orderedSections(m: ClientReportModel): ClientReportSection[] {
  const configured = [...(m.tabOrder ?? []), ...DEFAULT_SECTION_ORDER]
    .filter((section, index, all) => all.indexOf(section) === index);
  return configured.filter((section) => (
    (section === 'perf' && m.hasPerf)
    || (section === 'a11y' && m.hasA11y)
    || (section === 'agent' && m.hasAgent)
  ));
}

function tiles(m: ClientReportModel): string {
  if (m.tiles.length === 0) return '';
  const order = orderedSections(m);
  const displayTiles = m.tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const aIndex = order.indexOf(a.tile.target);
      const bIndex = order.indexOf(b.tile.target);
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex) || a.index - b.index;
    })
    .map(({ tile }) => tile);
  const cols = Math.min(3, displayTiles.length);
  return `  <div class="cr-tiles" style="display:grid; grid-template-columns:repeat(${cols},1fr); gap:14px; margin-bottom:8px">
${displayTiles.map(tile).join('\n')}
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
  const present = orderedSections(m).map((target) => {
    if (target === 'perf') return { target, label: 'Performance', status: m.perfStatus, blocked: m.perfCouldNotMeasure };
    if (target === 'a11y') return { target, label: 'Accessibility', status: m.a11yStatus, blocked: m.a11yCouldNotMeasure };
    return { target, label: 'AI visibility', status: m.agentStatus, blocked: m.agentCouldNotMeasure };
  });
  if (present.length < 2) return ''; // a single section needs no tab bar
  const first = present[0].target;
  return `  <div class="cr-tabs" style="display:flex; gap:2px; border-bottom:1px solid #e7e1d8; margin:42px 0 28px; position:sticky; top:0; background:#f7f5f0; z-index:5; padding-top:6px">
${present.map((t) => tabButton(t.target, t.label, t.status, t.target === first, t.blocked)).join('\n')}
  </div>`;
}

const COST_CHIP_STYLE: Record<CostChip, { fg: string; bg: string; line: string }> = {
  measured: { fg: '#4a443c', bg: '#f4f1ea', line: '#e0d9cd' },
  estimated: { fg: '#5c4a24', bg: '#f7f0df', line: '#e4d7b9' },
  'your estimate': { fg: '#4a3a6b', bg: '#f1ecfa', line: '#ddd2f0' },
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

function copyPromptControl(prompt: string | undefined, id: string, compact = false, tone: 'primary' | 'secondary' = 'primary'): string {
  if (!prompt) return '';
  const label = compact ? COPY_FIX_INSTRUCTIONS : COPY_SITE_FIX_INSTRUCTIONS;
  const width = compact ? '118px' : '190px';
  const gap = compact ? '8px' : '10px';
  const secondary = tone === 'secondary';
  const toneAttr = secondary ? ' data-copy-tone="secondary"' : '';
  const buttonStyle = secondary
    ? 'border:1px solid #26221d; background:#ffffff; color:#26221d'
    : 'border:1px solid #26221d; background:#26221d; color:#fff';
  return `        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:${gap}; margin-top:${compact ? '14px' : '16px'}">
          <button type="button" data-copy-prompt="${esc(id)}"${toneAttr} style="appearance:none; ${buttonStyle}; border-radius:8px; width:${width}; min-height:38px; padding:0 12px; display:inline-flex; align-items:center; justify-content:center; font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:500; letter-spacing:.04em; cursor:pointer"><span data-copy-label>${esc(label)}</span></button>
          <button type="button" data-disclose="${esc(id)}" class="cr-mono-chip" style="appearance:none; border:0; background:transparent; padding:0 2px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#6f665c; text-decoration:underline; cursor:pointer">${esc(VIEW_INSTRUCTIONS)}</button>
        </div>
        <pre id="${esc(id)}" data-disclosure hidden style="white-space:pre-wrap; overflow:auto; max-height:340px; margin:${compact ? '10px' : '12px'} 0 0; padding:14px 16px; border:1px solid #e0d9cd; border-radius:11px; background:#f4f1ea; color:#3a352e; font-family:'JetBrains Mono',monospace; font-size:12px; line-height:1.55">${esc(prompt)}</pre>`;
}

interface IndustryDataOptions {
  expanderIntro?: string;
  expanderFooter?: string;
  showMethodTags?: boolean;
}

function industryData(stats: readonly SourcedStat[] | undefined, id: string, options?: IndustryDataOptions): string {
  if (!stats || stats.length === 0) return '';
  const rows = stats
    .map((s) => {
      const method = options?.showMethodTags && s.method
        ? ` <span style="display:inline-block; border:1px solid #d8d0c3; border-radius:999px; padding:1px 5px; color:#5e5549; font-family:'JetBrains Mono',monospace; font-size:10px; line-height:1.35; white-space:nowrap">${esc(s.method)}</span>`
        : '';
      return `          <div style="font-size:13px; line-height:1.45; color:#4a443c">${esc(s.text)} - <a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:#26221d; font-weight:600; text-decoration:underline">${esc(s.publisher)}, ${esc(s.date)}</a>${method}</div>`;
    })
    .join('\n');
  return `        <div style="margin-top:10px">
          ${costChipButton(id, INDUSTRY_DATA)}
        </div>
        ${costDetailsPanel(id, `<div style="display:flex; flex-direction:column; gap:7px">
          ${options?.expanderIntro ? `<div style="font-size:12px; line-height:1.5; color:#6f665c; padding-bottom:8px; border-bottom:1px solid #e7e1d8">${esc(options.expanderIntro)}</div>` : ''}
${rows}
          ${options?.expanderFooter ? `<div style="font-size:12px; line-height:1.5; color:#6f665c; padding-top:8px; border-top:1px solid #e7e1d8">${esc(options.expanderFooter)}</div>` : ''}
        </div>`)} `;
}

function costSitePrompt(cost: ClientReportCostBlock): string | undefined {
  if (cost.sitePrompt) return cost.sitePrompt;
  if (cost.tab === 'perf') return cost.sitePrompts?.perf;
  if (cost.tab === 'a11y') return cost.sitePrompts?.a11y;
  return undefined;
}

function costChipButton(id: string, label: string, small = false): string {
  return `<button type="button" data-disclose="${esc(id)}" class="cr-cost-chip" style="appearance:none; border:1px solid #e0d9cd; background:#f4f1ea; border-radius:999px; padding:${small ? '3px 9px' : '5px 11px'}; min-height:${small ? '30px' : '38px'}; font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:#4a443c; cursor:pointer${small ? '; vertical-align:2px' : ''}">${esc(label)}</button>`;
}

function costDetailsPanel(id: string, content: string, compact = false): string {
  return `<div id="${esc(id)}" data-disclosure hidden style="margin-top:${compact ? '9px' : '10px'}; padding:${compact ? '11px 13px' : '12px 14px'}; border:1px solid #e7e1d8; border-radius:10px; background:#fbfaf8">${content}</div>`;
}

const LEGACY_SECONDS_SCALE_AXIS = { unit: 'seconds', precision: 1 } as const;

function benchmarkScale(gap: CostGap, scale: ClientReportCostBlock['scale']): string {
  if (!scale) return '';
  const labelStacked = Math.abs(scale.markerPercent - scale.goodLinePercent) < 12;
  const scaleAxis = gap.scaleAxis ?? LEGACY_SECONDS_SCALE_AXIS;
  const axisMax = gap.scaleAxis
    ? scale.axisMaxDisplay.toFixed(scaleAxis.precision)
    : Number.isInteger(scale.axisMaxDisplay)
      ? String(scale.axisMaxDisplay)
      : scale.axisMaxDisplay.toFixed(scaleAxis.precision);
  const axisSuffix = scaleAxis.unit === 'seconds' ? 's' : '';
  return `            <div data-benchmark-scale data-benchmark-zone="${esc(gap.zone)}" data-benchmark-axis-max="${esc(axisMax)}"${labelStacked ? ' data-benchmark-label-stack' : ''} style="position:relative; max-width:520px; margin:14px 0 2px; padding-top:17px" aria-label="${esc(`${gap.metricLabel} ${gap.measuredLabel}; Google's good line ${gap.goodLabel}`)}">
              <span style="position:absolute; top:0; left:${scale.goodLinePercent}%; transform:translateX(-50%); font-family:'JetBrains Mono',monospace; font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:#2f7d4f; white-space:nowrap">good &middot; ${esc(gap.goodLabel)}</span>
              <span data-benchmark-marker style="position:absolute; top:${labelStacked ? '-12px' : '0'}; left:${scale.markerPercent}%; transform:translateX(-50%); font-family:'JetBrains Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:#26221d; white-space:nowrap">you &middot; ${esc(gap.measuredLabel)}</span>
              <div style="height:12px; border:1px solid #d8d0c3; border-radius:999px; background:#ffffff; overflow:hidden; display:flex">
                <span style="width:${scale.zones.green}%; background:#e9f4ec"></span><span style="width:${scale.zones.amber}%; background:#fbeecf"></span><span style="width:${scale.zones.red}%; background:#fbe6e3"></span>
              </div>
              <span style="position:absolute; top:13px; left:${scale.goodLinePercent}%; width:2px; height:20px; background:#2f7d4f; transform:translateX(-50%)"></span>
              <span style="position:absolute; top:11px; left:${scale.markerPercent}%; width:3px; height:24px; background:#26221d; border-radius:3px; transform:translateX(-50%)"></span>
              <div style="display:flex; justify-content:space-between; margin-top:8px; font-family:'JetBrains Mono',monospace; font-size:9.5px; color:#6f665c"><span>0${axisSuffix}</span><span>${esc(axisMax)}${axisSuffix}</span></div>
            </div>`;
}

function headlineColor(state: CostState): string {
  if (state === 'zero') return PAL.good.fg;
  return state === 'measured' ? PAL.poor.fg : INK;
}

function urlFromCheckLine(checkLine: string | undefined, prefix: 'https://pagespeed.web.dev/analysis?' | 'view-source:'): string | undefined {
  if (!checkLine) return undefined;
  const start = checkLine.indexOf(prefix);
  if (start < 0) return undefined;
  const end = checkLine.indexOf(' ', start);
  return checkLine.slice(start, end < 0 ? undefined : end);
}

function costGrammarRow(label: string, content: string, tier: 'measured' | 'stakes' | 'fix', compact = false): string {
  const isFix = tier === 'fix';
  const tierStyles = isFix
    ? `padding:${compact ? '14px' : '16px'} 14px 14px; margin-top:8px; background:#e9f4ec; border:1px solid #cfe6d6; border-radius:11px`
    : tier === 'measured'
      ? `padding:${compact ? '18px 0 16px' : '18px 0 20px'}${compact ? '; margin-top:4px' : ''}`
      : `padding:${compact ? '16px 0' : '18px 0'}; border-top:1px solid #e7e1d8`;
  const labelColor = isFix ? '#2f7d4f' : tier === 'measured' ? '#26221d' : '#6f665c';
  return `        <div class="cr-cost-tier cr-cost-tier-${tier}" data-cost-tier="${tier}" style="display:grid; grid-template-columns:minmax(88px, ${COST_TIER_LABEL_WIDTH}px) minmax(0, 1fr); gap:${COST_TIER_GAP}px; ${tierStyles}">
          <div style="font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:${labelColor}; padding-top:4px">${esc(label)}</div>
          <div>${content}</div>
        </div>`;
}

function performanceMeasuredRow(cost: ClientReportCostBlock): string {
  const cell = COST_STATE_MATRIX.perf[cost.state];
  const blocked = cost.state === 'blocked';
  const headline = cell.rendersCostNumber ? cost.headline : cost.headline ?? cell.copy;
  if (blocked) {
    return costGrammarRow('Measured', `${headline ? `<div style="font-size:15px; line-height:1.5; color:#3a352e">${esc(headline)}</div>` : ''}${costChip(cell.chip)}`, 'measured');
  }
  const gap = cost.gap;
  const numbersId = costId('cr', 'perf', 'cost-numbers');
  const pageSpeedUrl = cost.pageSpeedUrl;
  const detailLines = [
    ...(cost.gapSubLines ?? []),
    ...(cost.bookingLine ? [cost.bookingLine] : []),
    ...(cost.countedZeroLine ? [cost.countedZeroLine] : []),
  ];
  const numbers = gap && (detailLines.length > 0 || gap.lineUrl)
    ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px">
              ${pageSpeedUrl ? `<a class="cr-cost-chip" href="${esc(pageSpeedUrl)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:5px; border:1px solid #e0d9cd; background:#f4f1ea; border-radius:999px; padding:5px 11px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:#4a443c; text-decoration:none">Check it yourself - PageSpeed &#8599;</a>` : ''}
              ${costChipButton(numbersId, 'the numbers')}
            </div>
            ${costDetailsPanel(numbersId, `<div style="font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.7; color:#5e5549">${detailLines.map(esc).join('<br>')}${detailLines.length ? '<br>' : ''}${pageSpeedUrl ? `${esc(PAGESPEED_FIELD_VS_LAB_PREEMPT)}<br>` : ''}benchmark: <a href="${esc(gap.lineUrl)}" target="_blank" rel="noopener" style="color:#5e5549; font-weight:600; text-decoration:underline">${esc(gap.lineOwner)}</a><br>${esc(MULTIPLES_FLOORED_NOTE)}</div>`)}`
    : '';
  return costGrammarRow('Measured', `
            ${headline ? `<div style="font-size:19px; line-height:1.3; font-weight:800; letter-spacing:-.01em; color:#26221d"><span style="color:${headlineColor(cost.state)}">${esc(headline)}</span></div>` : ''}
            ${gap?.multipleLabel ? `<div style="font-size:14px; line-height:1.5; color:#4a443c; margin-top:6px">Google&#39;s good line is ${esc(gap.goodLabel)} - you are more than <strong style="font-weight:800; color:#c0271f">${esc(gap.multipleLabel)}</strong> past it.</div>` : ''}
            ${gap ? benchmarkScale(gap, cost.scale) : ''}
            ${numbers}`, 'measured');
}

function a11yMeasuredRow(cost: ClientReportCostBlock): string {
  const cell = COST_STATE_MATRIX.a11y[cost.state];
  const blocked = cost.state === 'blocked';
  const headline = cost.headline ?? cell.copy;
  if (blocked) return costGrammarRow('Measured', `${headline ? `<div style="font-size:15px; line-height:1.5; color:#3a352e">${esc(headline)}</div>` : ''}${costChip(cell.chip)}`, 'measured');
  const foundId = costId('cr', 'a11y', 'cost-found');
  const found = cost.gapSubLines?.length
    ? `<div style="margin-top:10px">${costChipButton(foundId, 'what we found')}</div>${costDetailsPanel(foundId, `<div style="font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.7; color:#5e5549">${cost.gapSubLines.map(esc).join('<br>')}</div>`)}`
    : '';
  return costGrammarRow('Measured', `
            ${headline ? `<div style="font-size:19px; line-height:1.3; font-weight:800; letter-spacing:-.01em; color:#26221d"><span style="color:${headlineColor(cost.state)}">${esc(headline)}</span></div>` : ''}
            ${cost.headlineSub ? `<div style="font-size:14px; line-height:1.5; color:#4a443c; margin-top:6px">${esc(cost.headlineSub)}</div>` : ''}
            ${found}`, 'measured');
}

function aiTiles(cost: ClientReportCostBlock): string {
  const tiles = cost.aiTiles;
  if (!tiles || ![tiles.invisiblePercent, tiles.readableWords, tiles.totalWords].every(Number.isFinite)) return '';
  return `        <div class="cr-cost-tiles" style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px">
          <div style="border:1px solid #eed9a8; background:#fdf6e8; border-radius:11px; padding:13px 14px">
            <div style="font-size:25px; font-weight:800; letter-spacing:-.02em; color:#a85f00; line-height:1">${esc(String(tiles.invisiblePercent))}%</div>
            <div style="font-size:11.5px; line-height:1.4; color:#5e5549; margin-top:6px">of your homepage text invisible to AI</div>
          </div>
          <div style="border:1px solid #eed9a8; background:#fdf6e8; border-radius:11px; padding:13px 14px">
            <div style="font-size:22px; font-weight:800; letter-spacing:-.02em; color:#a85f00; line-height:1.15">${esc(String(tiles.readableWords))}<span style="font-size:14px">/${esc(String(tiles.totalWords))}</span></div>
            <div style="font-size:11.5px; line-height:1.4; color:#5e5549; margin-top:4px">homepage words AI can read today</div>
          </div>
          <div style="border:1px solid #cfe6d6; background:#e9f4ec; border-radius:11px; padding:13px 14px">
            <div style="font-size:25px; font-weight:800; letter-spacing:-.02em; color:#2f7d4f; line-height:1">100%</div>
            <div style="font-size:11.5px; line-height:1.4; color:#5e5549; margin-top:6px">the target - every word visible</div>
          </div>
        </div>`;
}

function aiMeasuredRow(cost: ClientReportCostBlock): string {
  const cell = COST_STATE_MATRIX.ai[cost.state];
  const blocked = cost.state === 'blocked';
  const headline = cost.headline ?? cell.copy;
  if (blocked) return costGrammarRow('Measured', `${headline ? `<div style="font-size:14.5px; line-height:1.5; color:#3a352e">${esc(headline)}</div>` : ''}${costChip(cell.chip)}`, 'measured', true);
  const checkId = costId('cr', 'ai', 'check');
  const checkAddressId = costId('cr', 'ai', 'check-addr');
  const checkAddress = urlFromCheckLine(cost.checkLine, 'view-source:') ?? cost.checkLine ?? '';
  const check = cost.checkLine
    ? ` ${costChipButton(checkId, 'check it yourself', true)}${costDetailsPanel(checkId, `<button type="button" data-copy-prompt="${esc(checkAddressId)}" style="appearance:none; border:1px solid #26221d; background:#ffffff; color:#26221d; border-radius:8px; min-height:38px; padding:6px 12px; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.02em; cursor:pointer; text-align:left"><span data-copy-label>copy: ${esc(checkAddress)}</span></button><pre id="${esc(checkAddressId)}" hidden aria-hidden="true" style="display:none">${esc(checkAddress)}</pre><div style="margin-top:8px; font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.7; color:#5e5549">click to copy, then paste into your browser&#39;s address bar - you will see the page exactly as the server sends it. Search it for a sentence from your site: if it is not there, AI tools do not see it either.</div>`, true)}`
    : '';
  return costGrammarRow('Measured', `
            ${headline ? `<div style="font-size:14.5px; line-height:1.5; color:${headlineColor(cost.state)}">${esc(headline)}${check}</div>` : ''}
            ${cost.headlineSub ? `<div style="font-size:12px; line-height:1.5; color:#6f665c; margin-top:8px">${esc(cost.headlineSub)}</div>` : ''}`, 'measured', true);
}

function stakesRow(stakes: CostStakes, tab: CostTab, fallbackStudies?: readonly SourcedStat[]): string {
  const studies = industryData(stakes.studies ?? fallbackStudies, costId('cr', tab, 'stakes-data'), {
    expanderIntro: stakes.expanderIntro,
    expanderFooter: tab === 'ai' ? AI_STUDIES_OTHER_SITES_CAVEAT : stakes.expanderFooter,
  });
  const prose = stakes.kind === 'no-material-loss'
    ? `<div style="padding:12px 14px; border:1px solid ${PAL.good.line}; border-radius:9px; background:${PAL.good.bg}; color:${PAL.good.fg}; font-size:15px; line-height:1.55">${esc(stakes.prose)}</div>`
    : `<p style="font-size:${tab === 'ai' ? '14.5px' : '15px'}; line-height:1.55; color:#3a352e; margin:0">${esc(stakes.prose)}</p>`;
  return costGrammarRow('At stake', `${prose}${studies}`, 'stakes', tab === 'ai');
}

function costStakesRow(cost: ClientReportCostBlock): string {
  if (cost.state === 'noclaim') return '';
  if (cost.state === 'zero' && !cost.stakes) return '';
  if (cost.stakes) return stakesRow(cost.stakes, cost.tab, cost.stats);
  if (cost.affectsProse) return stakesRow({ kind: 'at-risk', prose: cost.affectsProse }, cost.tab, cost.stats);
  if (!cost.stats?.length) return '';
  return costGrammarRow('At stake', industryData(cost.stats, costId('cr', cost.tab, 'stakes-data'), {
    ...(cost.tab === 'ai' ? { expanderFooter: AI_STUDIES_OTHER_SITES_CAVEAT } : {}),
  }), 'stakes', cost.tab === 'ai');
}

function percentageLabel(value: number): string {
  return `${Number((value * 100).toFixed(2))}%`;
}

function tinyResultLine(floor: number): string {
  return calcTinyResultLine().replace('$50', '$' + floor.toLocaleString('en-US', { maximumFractionDigits: 2 }));
}

function calculatorCard(calculator: CostCalculatorConfig, tab: CostTab): string {
  const id = costId('cr', tab, 'calculator');
  const panelId = costId('cr', tab, 'calc');
  const mathId = costId('cr', tab, 'calc-math');
  const prefill = Number((calculator.mobileSharePrefill * 100).toFixed(2));
  const bands = calculator.bands.map((band, index) => {
    const inputId = `${id}-band-${costId(band.id)}`;
    const checked = band.id === 'middle' || (index === 0 && !calculator.bands.some((candidate) => candidate.id === 'middle'));
    return `                  <label class="cr-band"><input id="${esc(inputId)}" type="radio" name="${esc(`${id}-band`)}" value="${esc(band.id)}" data-calc-band${checked ? ' checked' : ''}><span>${esc(`${band.id} ${percentageLabel(band.lo)}-${percentageLabel(band.hi)}`)}</span></label>`;
  }).join('\n');
  return `        <div class="cr-cost-tool" style="margin:2px 0 20px ${COST_TIER_CONTENT_OFFSET}px">
          <button type="button" data-disclose="${esc(panelId)}" class="cr-calc-teaser" style="appearance:none; width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border:1.5px dashed #a69b8d; border-radius:12px; background:#faf8f3; padding:10px 14px; font:inherit; text-align:left; cursor:pointer">
            <span style="flex:1; min-width:220px; font-size:13px; line-height:1.4; color:#3a352e"><strong style="font-weight:700">What is the wait worth in dollars?</strong> <span style="color:#6f665c">- your numbers, your math</span></span>
            <span style="font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:500; letter-spacing:.05em; text-transform:uppercase; color:#26221d; border:1px solid #26221d; background:#ffffff; border-radius:8px; padding:7px 12px; white-space:nowrap; flex:none">Open calculator</span>
          </button>
          <div id="${esc(panelId)}" data-disclosure hidden>
            <div class="cr-calculator-card" data-calculator data-calculator-tool data-calc-bands="${esc(JSON.stringify(calculator.bands))}" data-calc-floor="${esc(String(calculator.materialityFloorUsdPerMonth))}" data-calc-recovery-cap="${esc(String(RECOVERY_CAP))}" data-calc-prefill="${esc(String(prefill))}" data-calc-noun="${esc(calculator.inquiryNoun)}" data-calc-partial="${esc(CALC_PARTIAL_LINE)}" data-calc-tiny="${esc(tinyResultLine(calculator.materialityFloorUsdPerMonth))}" data-calc-break-even-template="${esc(calcBreakEvenLine('__VALUE__'))}" style="margin-top:10px; padding:16px 18px; border:1px solid #e0d9cd; border-radius:12px; background:#faf8f3">
              <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:8px">
                <div style="font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:#26221d">${esc(CALC_TITLE)}</div>
                <div style="font-size:11px; color:#6f665c">optional - nothing leaves this file</div>
              </div>
              <div class="cr-calculator-fields">
                <div style="font-size:15px; line-height:2.1; color:#3a352e; max-width:60ch">Each month the site brings about <input id="${esc(`${id}-inquiries`)}" data-calc-inquiries type="number" min="0" step="1" inputmode="decimal" aria-label="${esc(CALC_INQUIRIES_LABEL)}" class="cr-blank" style="width:64px"> inquiries; one inquiry is worth about $<input id="${esc(`${id}-value`)}" data-calc-value type="number" min="0" step="1" inputmode="decimal" aria-label="${esc(CALC_VALUE_LABEL)}" class="cr-blank" style="width:76px">; phones bring <input id="${esc(`${id}-share`)}" data-calc-share type="number" min="0" max="100" step="1" inputmode="decimal" value="${esc(String(prefill))}" aria-label="${esc(CALC_SHARE_LABEL)}" class="cr-blank" style="width:52px">% of visits <span style="color:#6f665c">${esc(CALC_SHARE_PREFILL_LABEL)}</span>.</div>
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:12px" role="radiogroup" aria-label="${esc(CALC_DIAL_LABEL)}">
                  <span style="font-size:12.5px; font-weight:600; color:#3a352e">${esc(CALC_DIAL_LABEL)}</span>
${bands}
                </div>
              </div>
              <div class="cr-calculator-output" data-calc-output aria-live="polite" hidden style="margin-top:12px; padding-top:11px; border-top:1px solid #e7e1d8">
                <div data-calc-headline-label style="font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:#6f665c"></div>
                <div data-calc-headline style="font-size:27px; font-weight:800; letter-spacing:-.02em; line-height:1.2; color:#26221d; margin-top:4px"></div>
                <div data-calc-subline style="font-size:13px; line-height:1.5; color:#5e5549; margin-top:4px"></div>
                <div style="margin-top:10px">${costChipButton(mathId, CALC_HOW_WE_GOT_THIS_LABEL, true)}</div>
                ${costDetailsPanel(mathId, `<div data-calc-lines style="white-space:pre-line; font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.7; color:#5e5549"></div>`, true)}
                <div style="margin-top:8px; font-size:11.5px; line-height:1.5; color:#6f665c">${esc(CALC_HONESTY_FOOTER)}</div>
              </div>
              <div style="font-size:11px; line-height:1.5; color:#6f665c; margin-top:10px">${esc(CALC_PRIVACY_LINE)} ${esc(calcCapNote())}</div>
              <button type="button" data-disclose="${esc(panelId)}" style="appearance:none; border:0; background:transparent; padding:0 2px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:11px; color:#6f665c; text-decoration:underline; cursor:pointer; margin-top:6px">hide calculator</button>
            </div>
          </div>
        </div>`;
}

function costFixControls(prompt: string | undefined, id: string): string {
  if (!prompt) return '';
  return `
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:12px">
              <button type="button" data-copy-prompt="${esc(id)}" data-copy-tone="secondary" style="appearance:none; border:1px solid #26221d; background:#26221d; color:#ffffff; border-radius:8px; min-height:38px; padding:0 14px; display:inline-flex; align-items:center; justify-content:center; font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:500; letter-spacing:.04em; cursor:pointer"><span data-copy-label>${esc(COPY_SITE_FIX_INSTRUCTIONS)}</span></button>
              <button type="button" data-disclose="${esc(id)}" class="cr-mono-chip" style="appearance:none; border:0; background:transparent; padding:0 2px; min-height:38px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#6f665c; text-decoration:underline; cursor:pointer">${esc(VIEW_INSTRUCTIONS)}</button>
            </div>
            <pre id="${esc(id)}" data-disclosure hidden style="white-space:pre-wrap; overflow:auto; max-height:340px; margin:12px 0 0; padding:14px 16px; border:1px solid #e0d9cd; border-radius:11px; background:#f4f1ea; color:#3a352e; font-family:'JetBrains Mono',monospace; font-size:12px; line-height:1.55">${esc(prompt)}</pre>`;
}

function fixRow(cost: ClientReportCostBlock): string {
  const prompt = COST_STATE_MATRIX[cost.tab][cost.state].rendersCopyPromptButton ? costSitePrompt(cost) : undefined;
  const text = cost.fix?.text;
  if (!text && !prompt) return '';
  return costGrammarRow('The fix', `${text ? `<div style="font-size:${cost.tab === 'ai' ? '14.5px' : '15px'}; line-height:1.5; color:#26221d">${esc(text)}</div>` : ''}${costFixControls(prompt, costId('cr', cost.tab, 'site-prompt'))}`, 'fix', cost.tab === 'ai');
}

const MEASURED_ROW: Record<CostTab, (cost: ClientReportCostBlock) => string> = {
  perf: performanceMeasuredRow,
  a11y: a11yMeasuredRow,
  ai: aiMeasuredRow,
};

function costGrammarBlock(cost: ClientReportCostBlock): string {
  const blocked = cost.state === 'blocked';
  const measured = MEASURED_ROW[cost.tab](cost);
  const calculator = !blocked && cost.tab === 'perf' && COST_STATE_MATRIX.perf[cost.state].rendersCalculator && cost.calculator
    ? calculatorCard(cost.calculator, cost.tab)
    : '';
  return `      <div class="cr-cost-grammar" style="margin:0 0 18px; padding:22px 24px 24px; border:1px solid #e0d9cd; border-radius:15px; background:#ffffff; box-shadow:0 6px 18px rgba(38,34,29,.035); max-width:72ch">
        <div style="font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:#6f665c${cost.tab === 'ai' ? '; margin-bottom:14px' : ''}">${esc(WHAT_THIS_COSTS_YOU)}</div>
${cost.tab === 'ai' ? aiTiles(cost) : ''}
${measured}
${!blocked ? costStakesRow(cost) : ''}
${calculator}
${!blocked ? fixRow(cost) : ''}
      </div>`;
}

function costBlock(cost: ClientReportCostBlock | undefined): string {
  if (!cost) return '';
  return costGrammarBlock(cost);
}

function verdictHead(
  question: string,
  status: ClientReportStatus,
  dim: ClientReportDimNarrative,
  blocked?: boolean,
  score?: number,
  cost?: ClientReportCostBlock,
  scoreLabel = 'score',
): string {
  const p = blocked ? NEUTRAL : PAL[status];
  const badge = blocked ? '' : scoreBadge(score, scoreLabel);
  return `    <div style="margin-bottom:30px">
      <div style="font-size:13.5px; font-weight:600; letter-spacing:.01em; color:#9b9286; margin-bottom:6px">${esc(question)}</div>
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:10px">
        <div style="font-size:26px; font-weight:800; letter-spacing:-.02em; color:${p.fg}">${esc(dim.verdictWord)}</div>
        ${badge}
      </div>
      ${costBlock(cost)}
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
  const body = `${verdictHead('Is your site fast enough on a phone?', m.perfStatus, m.narrative.perf, m.perfCouldNotMeasure, m.perfScore, m.perfCost)}
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

function scoreBadge(score: number | undefined, label = 'score'): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '';
  const p = PAL[scoreStatus(score)];
  return `<div style="flex:none; text-align:center; border:1px solid ${p.line}; background:${p.bg}; border-radius:11px; padding:7px 13px; min-width:62px">
            <div style="font-size:24px; font-weight:800; color:${p.fg}; line-height:1">${score}</div>
            <div style="font-size:9.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#9b9286; margin-top:3px">${esc(label)}</div>
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
  const lighthouseHint = typeof c.score === 'number' && c.score >= 90 && c.highImpact > 0
    ? `        <div style="font-size:12px; color:#9b9286; margin:-6px 0 14px">The 90+ score is Lighthouse's scale; these counts come from a deeper scan.</div>`
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
          ${scoreBadge(c.score, 'Lighthouse')}
        </div>
        ${sev ? `<div style="display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px; align-items:center">\n${sev}${sevHint}\n        </div>` : ''}
${lighthouseHint}
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
      const p = PAL[scoreStatus(r.score)];
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

function strongPageGroupList(group: StrongPageGroup): string {
  if (!group.pages.length) return '';
  const pages = group.pages
    .map((page) => {
      const score = typeof page.score === 'number'
        ? ` <span style="font-family:'JetBrains Mono',monospace; color:${PAL[scoreStatus(page.score)].fg}">${esc(String(page.score))}</span>`
        : '';
      return `<span style="font-size:14px; color:#4a443c"><strong style="font-weight:700; color:#26221d">${esc(page.name)}</strong>${score}</span>`;
    })
    .join('<span style="color:#d8d0c3"> &middot; </span>');
  const pageCount = group.pages.length;
  const label = group.verdict ?? `${pageCount} ${pageCount === 1 ? 'page looks' : 'pages look'} fine`;
  return `    <div style="font-size:14px; line-height:1.6; color:#6f665c; margin:4px 0 14px">${esc(label)}: ${pages}</div>`;
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
  const body = `${verdictHead('Can everyone use your site?', m.a11yStatus, m.narrative.a11y, m.a11yCouldNotMeasure, m.a11yScore, m.a11yCost, 'Lighthouse')}
${needs ? sectionKicker(`Needs attention &middot; ${needs} ${needs === 1 ? 'page' : 'pages'}`) : ''}
${m.a11yCards.map(a11yCard).join('\n')}
${m.a11yStrongPageGroup ? strongPageGroupList(m.a11yStrongPageGroup) : ''}
${a11yFineList(m.a11yFine)}
${blockedSection(m.a11yBlocked)}`;
  return panelWrap('a11y', body, multi, first);
}

// ---- AI VISIBILITY (Agent Ready) ----

function agentSiteCard(site: ClientReportAgentSite): string {
  const p = PAL[scoreStatus(site.score)];
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
  const p = PAL[scoreStatus(c.score)];
  const factors = c.factors
    .map((f) => {
      const fp = PAL[scoreStatus(f.score)];
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
      const p = PAL[scoreStatus(r.score)];
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
  const body = `${verdictHead('Can AI read and recommend you?', m.agentStatus, m.narrative.agent, m.agentCouldNotMeasure, m.agentScore, m.agentCost)}
${m.agentSite ? agentSiteCard(m.agentSite) : ''}
${needs ? sectionKicker(`Page-level gaps &middot; ${needs} ${needs === 1 ? 'page' : 'pages'}`) : ''}
${m.agentCards.map(agentCard).join('\n')}
${m.agentCost?.strongPageGroup ? strongPageGroupList(m.agentCost.strongPageGroup) : agentFineList(m.agentFine)}
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
    document.querySelectorAll('[data-disclose="' + target.id + '"]').forEach(function(c){ syncDisclosure(c, target); });
    // The calculator opener is hidden while expanded and its closer disappears
    // with the panel, so retain keyboard focus within the active interaction.
    if(willOpen && window.getComputedStyle(control).display === 'none'){
      var first = target.querySelector('input, select, textarea, button, a[href]');
      if(first) first.focus();
    } else if(!willOpen && target.contains(control)){
      requestAnimationFrame(function(){
        var opener = null;
        document.querySelectorAll('[data-disclose="' + target.id + '"]').forEach(function(c){
          if(c !== control && window.getComputedStyle(c).display !== 'none') opener = c;
        });
        if(opener) opener.focus();
      });
    }
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

  // Calculator arithmetic mirrors computeRecoveryRange. The renderer serializes
  // its calculator inputs below, so the inline script never hardcodes them.
  document.querySelectorAll('[data-calculator]').forEach(function(card){
    var inquiries = card.querySelector('[data-calc-inquiries]');
    var value = card.querySelector('[data-calc-value]');
    var share = card.querySelector('[data-calc-share]');
    var output = card.querySelector('[data-calc-output]');
    var lines = card.querySelector('[data-calc-lines]');
    var headline = card.querySelector('[data-calc-headline]');
    var headlineLabel = card.querySelector('[data-calc-headline-label]');
    var subline = card.querySelector('[data-calc-subline]');
    function put(el, txt){ if(el) el.textContent = txt; }
    if(!inquiries || !value || !share || !output || !lines) return;
    var bands, floor = Number(card.getAttribute('data-calc-floor'));
    var recoveryCap = Number(card.getAttribute('data-calc-recovery-cap'));
    var prefill = Number(card.getAttribute('data-calc-prefill'));
    try{ bands = JSON.parse(card.getAttribute('data-calc-bands') || '[]'); }catch(e){ return; }
    if(!Array.isArray(bands) || !Number.isFinite(floor) || !Number.isFinite(recoveryCap) || !Number.isFinite(prefill)) return;
    if(!share.value) share.value = String(prefill);
    var touched = false;
    function numberLabel(n){ return n.toLocaleString('en-US', { maximumFractionDigits: 1 }); }
    function countLabel(n){ return Math.floor(n).toLocaleString('en-US'); }
    function recoveredText(lo, hi, noun, one){
      if(hi < 1) return 'under 1 ' + one;
      var loLabel = countLabel(lo), hiLabel = countLabel(hi);
      return loLabel === hiLabel ? 'about ' + hiLabel + ' ' + (Math.floor(hi) === 1 ? one : noun) : loLabel + ' to ' + hiLabel + ' more ' + noun;
    }
    function dollars(n){ return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
    function valueDollars(n){ return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }); }
    function hide(){ output.hidden = true; lines.textContent = ''; put(headline, ''); put(headlineLabel, ''); put(subline, ''); card.classList.remove('cr-calculator-has-output'); }
    function partial(){
      output.hidden = false;
      var msg = card.getAttribute('data-calc-partial') || '';
      put(headline, ''); put(headlineLabel, ''); put(subline, msg);
      lines.textContent = msg;
      card.classList.add('cr-calculator-has-output');
    }
    function selectedBand(){
      var checked = card.querySelector('[data-calc-band]:checked');
      if(!checked) return null;
      for(var i=0;i<bands.length;i++){ if(bands[i].id === checked.value) return bands[i]; }
      return null;
    }
    function sync(){
      if(!touched){ hide(); return; }
      var inquiriesText = inquiries.value.trim();
      var valueText = value.value.trim();
      var shareText = share.value.trim();
      var monthlyInquiries = Number(inquiriesText);
      var mobileShare = Number(shareText) / 100;
      var hasValue = valueText !== '';
      var valuePerInquiryUsd = Number(valueText);
      var band = selectedBand();
      if(
        !inquiriesText || !shareText || !band
        || !Number.isFinite(monthlyInquiries) || monthlyInquiries <= 0
        || !Number.isFinite(mobileShare) || mobileShare < 0 || mobileShare > 1
        || !Number.isFinite(band.lo) || !Number.isFinite(band.hi) || band.lo < 0 || band.hi < band.lo || band.hi > recoveryCap
        || (hasValue && (!Number.isFinite(valuePerInquiryUsd) || valuePerInquiryUsd < 0))
      ){ partial(); return; }
      // Mirror computeRecoveryRange: phone share, recovery band, monthly value, then yearly value.
      var mobileInquiries = monthlyInquiries * mobileShare;
      var recoveredLo = mobileInquiries * band.lo;
      var recoveredHi = mobileInquiries * band.hi;
      var usdMonthLo = hasValue ? recoveredLo * valuePerInquiryUsd : null;
      var usdMonthHi = hasValue ? recoveredHi * valuePerInquiryUsd : null;
      var usdYearLo = hasValue ? usdMonthLo * 12 : null;
      var usdYearHi = hasValue ? usdMonthHi * 12 : null;
      var breakEvenUsdYear = hasValue ? valuePerInquiryUsd * 12 : null;
      if(!Number.isFinite(mobileInquiries) || !Number.isFinite(recoveredLo) || !Number.isFinite(recoveredHi) || (hasValue && (!Number.isFinite(usdMonthLo) || !Number.isFinite(usdMonthHi) || !Number.isFinite(usdYearLo) || !Number.isFinite(usdYearHi) || !Number.isFinite(breakEvenUsdYear)))){ partial(); return; }
      var sourceNoun = card.getAttribute('data-calc-noun') || 'inquiries';
      var one = /ies$/i.test(sourceNoun) ? sourceNoun.slice(0, -3) + 'y'
        : /(ches|shes|sses|xes|zes)$/i.test(sourceNoun) ? sourceNoun.slice(0, -2)
          : /s$/i.test(sourceNoun) && !/(ss|us)$/i.test(sourceNoun) ? sourceNoun.slice(0, -1) : sourceNoun;
      var noun = /[^aeiou]y$/i.test(one) ? one.slice(0, -1) + 'ies'
        : /(s|x|z|ch|sh)$/i.test(one) ? one + 'es' : one + 's';
      var bandPct = numberLabel(band.lo * 100) + '-' + numberLabel(band.hi * 100) + '%';
      var recovered = recoveredText(recoveredLo, recoveredHi, noun, one);
      var valueDisplay = valueDollars(valuePerInquiryUsd);
      var math = [];
      if(hasValue && usdMonthHi >= floor){
        var breakEven = (card.getAttribute('data-calc-break-even-template') || '').replace('__VALUE__', dollars(breakEvenUsdYear));
        if(breakEven) math.push(breakEven);
      }
      math.push(countLabel(monthlyInquiries) + ' ' + noun + ' x ' + numberLabel(mobileShare * 100) + '% on phones = ' + countLabel(mobileInquiries) + ' mobile ' + noun);
      math.push(countLabel(mobileInquiries) + ' x ' + bandPct + ' won back = ' + recovered + ' a month');
      if(!hasValue){
        put(headlineLabel, 'what a faster site could bring back');
        put(headline, recovered + ' a month');
        put(subline, 'add what one ' + one + ' is worth to see the money');
      } else if(usdMonthHi < floor){
        put(headlineLabel, ''); put(headline, '');
        put(subline, card.getAttribute('data-calc-tiny') || '');
      } else {
        math.push('at ' + valueDisplay + ' per ' + one + ', that ' + bandPct + ' is worth ' + dollars(usdMonthLo) + ' to ' + dollars(usdMonthHi) + ' a month (about ' + dollars(usdYearLo) + ' to ' + dollars(usdYearHi) + ' a year)');
        put(headlineLabel, 'what a faster site could bring back');
        put(headline, 'about ' + dollars(usdYearLo) + ' to ' + dollars(usdYearHi) + ' a year');
        put(subline, dollars(usdMonthLo) + ' to ' + dollars(usdMonthHi) + ' a month - at ' + valueDisplay + ' per ' + one + ', if ' + bandPct + ' comes back');
      }
      output.hidden = false;
      lines.textContent = math.filter(function(line){ return line; }).join('\\n');
      card.classList.add('cr-calculator-has-output');
    }
    [inquiries, value, share].forEach(function(field){ field.addEventListener('input', function(){ touched = true; sync(); }); });
    card.querySelectorAll('[data-calc-band]').forEach(function(field){ field.addEventListener('change', function(){ touched = true; sync(); }); });
    sync();
  });
})();
</script>`;

export function renderClientReportHtml(m: ClientReportModel): string {
  const sections = orderedSections(m).map((section) => {
    if (section === 'perf') return (multi: boolean, first: boolean) => perfPanel(m, multi, first);
    if (section === 'a11y') return (multi: boolean, first: boolean) => a11yPanel(m, multi, first);
    return (multi: boolean, first: boolean) => agentPanel(m, multi, first);
  });
  const multi = sections.length > 1;
  // First present section is shown on load (from order, not a hardcoded perf-first).
  const panels = sections.map((render, i) => render(multi, i === 0)).join('\n\n');

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
