/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import sharp from 'sharp';

import type { FrameAnnotation } from '../bench/core';
import type { FrameMetadata } from '../audit/stages/build_annotated_timeline/worker-protocol';
import { synthesizeSite } from './synthesis';
import type { PagePerf, SiteScorecard } from './synthesis';
import {
  a11yIssueLabel,
  isStructuralA11yRule,
  localizedHotspots,
  sortViolations,
} from '../audit/stages/accessibility/report-utils';
import {
  writeAccessibilityClientSummary,
  writeAccessibilitySiteSummary,
} from '../audit/stages/accessibility/client-sidecar';
import type {
  AccessibilityScan,
  AccessibilityViolation,
} from '../audit/stages/accessibility/types';
import {
  agentPanelHtml,
  agentTabPill,
  buildAgentPages,
  enrichAgentSummaries,
  hasAgentData,
  pageFindings as agentPageFindings,
  pageLead as agentPageLead,
  readAgentSiteSummary,
  type AgentPageView,
  type AgentSummarizer,
} from './agent-ready-report';
import { agentStyles, tabStyles } from './agent-ready-styles';
import { fetchSiteAccessSignals } from './agent-ready-site';
import { scoreSite, type CategoryScore, type SiteAccessSignals } from './agent-ready-score';
import {
  renderClientReportV2,
  type ClientReportV2Model,
  type V2A11yCard,
  type V2AgentCard,
  type V2BlockedPage,
  type V2Frame,
  type V2PerfCard,
  type V2StartHere,
  type V2Status,
  type V2Tile,
} from './client-report-v2';
import { looksLikeBotWall } from '../audit/bot-wall';
import {
  composeNarrative,
  parseNarrativeResponse,
  type Dim,
  type NarrativeFacts,
  type NarrativeOverlay,
  type NarrativeSummarizer,
} from './client-report-narrative';

const execFileAsync = promisify(execFile);

// Client-facing report: a SECOND renderer over the same saved audit-results a
// `shaka-perf audit` produces (report.json + <id>/audit.json + the screencast
// timeline frames, including their per-frame layout-shift + LCP annotations).
// The technical self-contained report keeps every metric, waterfall, and
// Lighthouse internal; this one is the "client lens".
//
// It is ADAPTIVE: each page card leads with the problem that page actually has
// (slow main content, a layout that jumps around, a screen that stays blank,
// a sluggish page), not a fixed "main content appears in Xs". The filmstrip is
// dense (shows we analyse every frame), draws the layout shifts that occurred
// frame-by-frame (the exact regions that moved, with numbers), and any frame
// can be clicked to zoom. See ../../README-warm-email.md.

// ---- thresholds ----
const LCP_GOOD_MS = 2500;
const LCP_SLOW_MS = 10000;
const LCP_WAIT_MS = 4000; // a visitor notices the wait above this
// CLS is stored on the /100 scale (value 25 == raw CLS 0.25). Google: good
// < 0.10, poor > 0.25.
const CLS_GOOD = 10;
const CLS_POOR = 25;
const FCP_BLANK_MS = 8000; // nothing painted for this long = effectively blank
const FCP_LATE_MS = 3500; // first paint noticeably late
const TBT_SLUGGISH_MS = 600;
const SCORE_GOOD = 90;
const SCORE_POOR = 50;
// A per-frame layout shift below this is real but invisible to the eye; the
// trace records plenty of 0.001-0.015 ripples. Only shifts at or above this
// count as a "the page jumped" story beat (red ring, boxes, must-keep frame) -
// a thumbnail captioned "shifts by 0.00" reads as noise, not analysis.
const VISIBLE_SHIFT = 0.02;

const FRAME_W = 380; // inlined frame width (px) - enough detail for the zoom
// Frame budgets per strip. The timeline is already visually deduped upstream
// (every frame in timeline_frames.json is a frame where something changed), so
// when a page's meaningful window holds fewer frames than the budget the strip
// simply shows all of them; sampling only kicks in on animation-churn pages
// where a background animation keeps emitting near-identical frames.
const STRIP_DENSE = 12; // pages with a layout-shift story (every frame differs)
const STRIP_SPARSE = 8; // load-story pages (enough beats without a wall of blank phones)
const DETAIL_PAGES = 5; // pages shown in full; the rest get a one-line summary

export type Status = 'good' | 'fair' | 'poor';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function metricVal(p: PagePerf, label: string): number | undefined {
  const m = p.metrics[label];
  return m && typeof m.value === 'number' && !Number.isNaN(m.value) ? m.value : undefined;
}

function lcpStatus(ms: number | undefined): Status {
  if (ms === undefined) return 'fair';
  if (ms <= LCP_GOOD_MS) return 'good';
  if (ms <= LCP_SLOW_MS) return 'fair';
  return 'poor';
}
function scoreStatus(score: number | undefined): Status {
  if (score === undefined) return 'fair';
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_POOR) return 'fair';
  return 'poor';
}
function clsStatus(v: number | undefined): Status {
  if (v === undefined) return 'good';
  if (v <= CLS_GOOD) return 'good';
  if (v <= CLS_POOR) return 'fair';
  return 'poor';
}

// ---- problem detection (the adaptive core) ----

export type ProblemKind = 'slow-lcp' | 'layout-shift' | 'blank' | 'late-paint' | 'sluggish' | 'clean' | 'no-data';

export interface Problem {
  kind: ProblemKind;
  severity: number; // 0..1, for ranking which problem leads the card
  status: Status;
  headline: string; // HTML, the bold lead line
  note?: string; // one plain clause under the headline
  chip: string; // short label when shown as a secondary problem
}

// Look at the measured metrics and decide what is actually wrong with THIS page,
// ordered by how bad it is. The worst one leads the card; the rest become small
// "also" chips. A page with no real problem gets a clean/good lead.
export function detectProblems(page: PagePerf): { lead: Problem; rest: Problem[] } {
  const lcp = metricVal(page, 'LCP');
  const fcp = metricVal(page, 'FCP');
  const clsV = metricVal(page, 'CLS'); // /100 scale
  const tbt = metricVal(page, 'TBT');
  const score = metricVal(page, 'LH Score');

  // A page whose audit failed (error outcome / unreadable audit.json) reaches
  // here with no metrics at all. That is "we could not measure it", never
  // "Loads cleanly" - the email side already counts these via the broken chip,
  // and the two artifacts must not contradict each other.
  if (lcp === undefined && fcp === undefined && clsV === undefined && tbt === undefined && score === undefined) {
    return {
      lead: {
        kind: 'no-data',
        severity: 0,
        status: 'fair',
        headline: `We couldn't measure this page`,
        note: 'The audit did not complete here, so no numbers are claimed for it.',
        chip: 'not measured',
      },
      rest: [],
    };
  }
  const out: Problem[] = [];

  // Trigger at Google's "needs improvement" line (2.5s), not 4s, so a 3.x-second
  // page gets an honest "takes 3.7s" headline instead of a false "Loads cleanly"
  // sitting next to an amber badge.
  if (lcp !== undefined && lcp > LCP_GOOD_MS) {
    // The note must match what the filmstrip actually shows. When the rest of
    // the page paints early (thinkd2 homepage: first content at 1.5s, LCP at
    // 13.9s), "a mostly empty screen" would be contradicted by the frames two
    // inches below it.
    const paintsEarly = fcp !== undefined && fcp <= 3000 && lcp - fcp >= 3000;
    const note = paintsEarly
      ? 'Most of the page paints early, so the wait is easy to miss - but the biggest piece of the page only lands then.'
      : lcp > LCP_WAIT_MS
        ? 'Until then a visitor on a phone is looking at a mostly empty screen.'
        : 'A bit slower than the under-2.5-second mark that feels instant on a phone.';
    out.push({
      kind: 'slow-lcp',
      severity: clamp01(lcp / 14000),
      status: lcpStatus(lcp),
      headline: `The biggest piece of the page takes <strong>${secs(lcp)}</strong> to appear`,
      note,
      chip: `biggest piece at ${secs(lcp)}`,
    });
  }
  if (clsV !== undefined && clsV > CLS_GOOD) {
    const raw = (clsV / 100).toFixed(2);
    // Only cite Google's 0.25 "poor" line when the page actually crosses it; in
    // the 0.10-0.25 band the honest reference is the 0.10 comfort line.
    const note = clsV > CLS_POOR
      ? `The page scores ${raw} on Google's layout-shift scale, where anything above 0.25 is poor - so things move under your visitor's thumb.`
      : `The page scores ${raw} on Google's layout-shift scale; a page is fully stable only below 0.10, and yours is above that, so things can still move under your visitor's thumb.`;
    out.push({
      kind: 'layout-shift',
      severity: clamp01(clsV / 60) + 0.02,
      status: clsStatus(clsV),
      headline: `The page <strong>jumps around</strong> as it loads`,
      note,
      chip: `layout jumps (${raw})`,
    });
  }
  if (fcp !== undefined && fcp > FCP_BLANK_MS) {
    out.push({
      kind: 'blank',
      severity: clamp01(fcp / 12000) + 0.1,
      status: 'poor',
      headline: `The screen stays <strong>blank for ${secs(fcp)}</strong>`,
      note: 'Nothing at all is painted to the screen for that long - it can read as a broken page.',
      chip: `blank for ${secs(fcp)}`,
    });
  } else if (fcp !== undefined && fcp > FCP_LATE_MS && (lcp === undefined || fcp > lcp - 500)) {
    out.push({
      kind: 'late-paint',
      severity: clamp01(fcp / 9000) * 0.85,
      status: 'fair',
      headline: `Nothing appears for the first <strong>${secs(fcp)}</strong>`,
      note: 'The first pixels take that long to land, so the page feels stalled at the start.',
      chip: `first paint ${secs(fcp)}`,
    });
  }
  if (tbt !== undefined && tbt > TBT_SLUGGISH_MS) {
    out.push({
      kind: 'sluggish',
      severity: clamp01(tbt / 1800) * 0.6,
      status: 'fair',
      headline: `The page is <strong>slow to react</strong> to taps`,
      note: 'For a stretch while it loads, taps and scrolls lag behind the finger.',
      chip: 'laggy to tap',
    });
  }

  out.sort((a, b) => b.severity - a.severity);
  if (out.length === 0) {
    const clean: Problem = {
      kind: 'clean',
      severity: 0,
      status: lcp !== undefined && lcp <= LCP_GOOD_MS ? 'good' : 'fair',
      headline: lcp !== undefined ? `Loads cleanly in <strong>${secs(lcp)}</strong>` : 'Loads cleanly',
      chip: 'clean',
    };
    return { lead: clean, rest: [] };
  }
  return { lead: out[0], rest: out.slice(1) };
}

// ---- frames (with per-frame layout-shift + lcp annotations) ----

export interface Shift {
  value: number; // the shift score for this event (e.g. 0.445)
  rects: number[][]; // [x, y, w, h] in the frame's own image-pixel space
}
// Lean view-model over a persisted FrameMetadata entry: only what the client
// strip renders (shift rects parsed out of the annotation labels, LCP flag).
export interface Frame {
  timeMs: number;
  imageFilename: string;
  imgW: number;
  imgH: number;
  shifts: Shift[];
  isLcp: boolean;
}

function parseShiftValue(label: string): number {
  const m = /([0-9]*\.?[0-9]+)/.exec(label || '');
  return m ? parseFloat(m[1]) : 0;
}

// Join path segments that come from artifact/report JSON (page ids, frame
// filenames) and refuse anything that escapes the root - a tampered results
// dir must not be able to inline arbitrary local files into a client-shared
// report. Returns null when the resolved path leaves the root.
function containedJoin(root: string, ...segs: string[]): string | null {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, ...segs);
  return abs.startsWith(rootAbs + path.sep) ? abs : null;
}

// Read the page's `timeline_frames.json` - the build_annotated_timeline stage's
// persisted FrameMetadata (see worker-protocol.ts). The entries are already
// visually DEDUPED upstream: every frame is a moment where the screen changed.
function readFrames(resultsDir: string, pageId: string): Frame[] {
  const p = containedJoin(resultsDir, pageId, 'artifacts', 'timeline_frames.json');
  if (!p || !fs.existsSync(p)) return []; // frameless audits (older runs) just skip the strip
  let metas: FrameMetadata[];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    metas = parsed as FrameMetadata[];
  } catch (err) {
    console.warn(chalk.yellow(`shaka-perf: ${p} unparseable, skipping filmstrip: ${(err as Error).message}`));
    return [];
  }
  return metas
    .filter((m) => m && typeof m.timeMs === 'number' && typeof m.imageFilename === 'string')
    .map((m): Frame => {
      const anns: FrameAnnotation[] = m.annotations ?? [];
      const shifts: Shift[] = anns
        .filter((a) => a.kind === 'layout-shift' && Array.isArray(a.rects) && a.rects.length > 0)
        .map((a) => ({ value: parseShiftValue(a.label), rects: a.rects! }))
        .filter((s) => s.value >= VISIBLE_SHIFT); // sub-visible ripples are noise, not a story beat
      return {
        timeMs: m.timeMs,
        imageFilename: m.imageFilename!,
        imgW: m.imgW || FRAME_W,
        imgH: m.imgH || FRAME_W * 2, // ~phone aspect; only hit on legacy metadata
        shifts,
        isLcp: anns.some((a) => a.kind === 'lcp'),
      };
    })
    .sort((a, b) => a.timeMs - b.timeMs);
}

const maxShift = (f: Frame): number => f.shifts.reduce((m, s) => Math.max(m, s.value), 0);

function nearestFrame(frames: Frame[], targetMs: number): Frame | undefined {
  if (!frames.length) return undefined;
  return frames.reduce((best, f) => (Math.abs(f.timeMs - targetMs) < Math.abs(best.timeMs - targetMs) ? f : best));
}

// The end of the "meaningful" load window: the later of LCP / last real shift,
// so neither the filmstrip nor the video ever shows the animation tail (frames a
// perpetual background animation keeps emitting for 30-60s after the page is done).
// With no signal at all, cover the first ~12s. Shared by frame picking + video.
// Frameless audits (no timeline_frames.json) still have a screencast to trim, so
// the metrics alone must carry the window - returning 0 there would hand the
// video a 2-second clip captioned with the page's full LCP wait.
export function windowEndMs(frames: Frame[], lcpMs?: number, fcpMs?: number): number {
  if (!frames.length) {
    return lcpMs !== undefined || fcpMs !== undefined ? Math.max(lcpMs ?? 0, fcpMs ?? 0) : 0;
  }
  const start = frames[0].timeMs;
  const last = frames[frames.length - 1].timeMs;
  const shiftFrames = frames.filter((f) => maxShift(f) >= VISIBLE_SHIFT);
  const lastShift = shiftFrames.length ? shiftFrames[shiftFrames.length - 1].timeMs : 0;
  const haveSignal = lcpMs !== undefined || fcpMs !== undefined || shiftFrames.length > 0;
  const endRef = Math.max(lcpMs ?? 0, lastShift, fcpMs ?? 0);
  return haveSignal ? Math.min(last, endRef + 1200) : Math.min(last, start + 12000);
}

// Dense, problem-aware frame selection. Samples evenly across the load (so the
// strip visibly covers the whole thing), then force-includes the story beats:
// the blank start, the FIRST-CONTENT frame (nearest to FCP), the LCP frame,
// the settled end of the window, and the biggest layout-shift frames. Capped
// at the later of LCP / last meaningful shift so we never show the animation
// tail (frames a perpetual background animation keeps emitting for 30-60s
// after the page is visually done). Because the input is already deduped, a
// page whose window holds fewer frames than the budget shows ALL of them.
export function pickFrames(frames: Frame[], lcpMs: number | undefined, fcpMs: number | undefined, target: number): Frame[] {
  if (frames.length === 0) return [];
  const start = frames[0].timeMs;
  const shiftFrames = frames.filter((f) => maxShift(f) >= VISIBLE_SHIFT);
  const lcpFrame = frames.find((f) => f.isLcp);
  const cap = windowEndMs(frames, lcpMs, fcpMs);
  const pool = frames.filter((f) => f.timeMs <= cap);
  const usable = pool.length ? pool : frames.slice(0, Math.min(frames.length, target));
  const finalCap = target + (target >= STRIP_DENSE ? 2 : 1);

  // Must-keep frames first so the final cap can never drop a story beat; then
  // fill the remaining slots with even time-coverage.
  const chosen = new Map<number, Frame>();
  const keep = (f?: Frame): void => {
    if (f && f.timeMs <= cap) chosen.set(f.timeMs, f);
  };
  keep(usable[0]);
  // The frame nearest FCP is where the page stops being blank - the first beat
  // of the story. Without this explicit keep, even sampling regularly skips it
  // (a 1.5s first paint on a 15s load lands between sample points) and the
  // strip jumps from "blank" straight to a half-loaded page, silently
  // overstating how long the screen stays empty.
  if (fcpMs !== undefined) keep(nearestFrame(usable, fcpMs));
  keep(lcpFrame ?? (lcpMs !== undefined ? nearestFrame(usable, lcpMs) : undefined));
  keep(usable[usable.length - 1]); // the settled end state closes the story
  [...shiftFrames]
    .sort((a, b) => maxShift(b) - maxShift(a))
    .slice(0, target >= STRIP_DENSE ? 3 : 2)
    .forEach(keep);

  const span = Math.max(1, cap - start);
  const denom = Math.max(1, target - 1);
  for (let i = 0; i < target && chosen.size < finalCap; i++) {
    const f = nearestFrame(usable, start + (span * i) / denom);
    if (f) chosen.set(f.timeMs, f);
  }
  return [...chosen.values()].sort((a, b) => a.timeMs - b.timeMs);
}

// AVIF to match how the technical report inlines its timeline thumbnails (see
// build_annotated_timeline/engine.ts) - noticeably smaller than webp at this
// quality, which matters for a report meant to ride an email as one file. We
// hold a larger width than the 256px thumbs because the same image feeds the
// click-to-zoom lightbox.
async function inlineFrame(absPath: string): Promise<string | null> {
  try {
    const buf = await sharp(absPath)
      .resize({ width: FRAME_W, withoutEnlargement: true })
      .avif({ quality: 45, effort: 3 })
      .toBuffer();
    return `data:image/avif;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(chalk.yellow(`shaka-perf: failed to inline frame ${absPath}: ${(err as Error).message}`));
    return null;
  }
}

// Trim the page's screencast to the meaningful load window, downscale + compress
// hard (a 2.4MB raw capture becomes ~35KB), and inline it as a data URI so the
// report stays a single attachable file. Returns null if ffmpeg or the screencast
// is missing (the card then just shows the filmstrip). Trimming also drops the
// animation tail, same as the frames.
interface BuiltVideo {
  uri: string;
  // Seconds of load the clip actually covers: min(requested window, source
  // screencast length). Legacy screencasts can be far shorter than the page's
  // LCP wait, and the caption must not promise time the clip does not show.
  coveredSec?: number;
}

let _ffmpegMissing = false;
async function buildVideo(resultsDir: string, pageId: string, endMs: number): Promise<BuiltVideo | null> {
  if (_ffmpegMissing) return null;
  // No window means no usable signal (frameless AND metricless) - an arbitrary
  // 2-second clip would contradict the card around it, so skip the video.
  if (endMs <= 0) return null;
  const src = containedJoin(resultsDir, pageId, 'artifacts', 'screencast.mp4');
  if (!src || !fs.existsSync(src)) return null;
  const endSec = Math.max(2, Math.min(endMs / 1000 + 1.2, 60));
  // Page ids are store-generated slugs, but sanitize anyway: this string goes
  // straight into a tmp filename.
  const safeId = pageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const tmp = path.join(os.tmpdir(), `shaka-cr-${safeId}-${process.pid}.mp4`);
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      ['-y', '-i', src, '-t', endSec.toFixed(2), '-vf', 'scale=240:-2,fps=12', '-an',
        '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', tmp],
      { timeout: 90_000 },
    );
    // ffmpeg reports the INPUT duration on stderr ("Duration: 00:00:10.75").
    const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr ?? '');
    const srcSec = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : undefined;
    const coveredSec = srcSec !== undefined ? Math.min(endSec, srcSec) : undefined;
    const buf = fs.readFileSync(tmp);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (buf.length > 4_500_000) {
      console.warn(chalk.yellow(`shaka-perf: load video for ${pageId} is ${(buf.length / 1_000_000).toFixed(1)} MB after compression - dropping it to keep the report attachable (the filmstrip stays).`));
      return null; // safety against a runaway clip
    }
    return { uri: `data:video/mp4;base64,${buf.toString('base64')}`, coveredSec };
  } catch (e: any) {
    if (e && e.code === 'ENOENT') _ffmpegMissing = true; // ffmpeg not installed - stop trying
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    return null;
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
} // all in %
interface Shot {
  timeLabel: string;
  dataUri: string;
  isLcp: boolean;
  isFcp: boolean;
  boxes: Box[];
  shiftValue: number; // max shift on this frame, 0 if none
  role: string; // "Blank" | "First content" | "Filling in" | "Biggest piece" | "Layout jump" | "Loaded"
  detail: string; // legible caption shown in the zoom (numbers live here, not on the thumbnail)
}

export function framesToBoxes(f: Frame): { boxes: Box[]; shiftValue: number } {
  const boxes: Box[] = [];
  for (const s of f.shifts) {
    for (const r of s.rects) {
      const [x, y, w, h] = r;
      if (!(w > 0) || !(h > 0)) continue;
      boxes.push({
        left: clamp01(x / f.imgW) * 100,
        top: clamp01(y / f.imgH) * 100,
        width: clamp01(w / f.imgW) * 100,
        height: clamp01(h / f.imgH) * 100,
      });
    }
  }
  return { boxes, shiftValue: maxShift(f) };
}

// FCP's metric clock can lag the screencast by a frame or two, so a frame
// captured just before the FCP frame can already show content. Only count a
// frame as "Blank" when it is clearly before first paint, not merely a few ms
// ahead of the FCP timestamp - that skew mislabeled a 1.5s content frame as
// "Blank" on a fast page (FCP ~= LCP) where the screen was visibly full.
const FCP_SKEW_MS = 100;

// Role + zoom caption for one picked frame. Precedence: the LCP frame is the
// payoff, a shifting frame is the jump, the FCP-nearest frame is where content
// first lands, anything earlier is still blank, anything after LCP has settled.
function describeShot(
  f: Frame,
  picked: Frame[],
  fcpFrame: Frame | undefined,
  lcpMs: number | undefined,
  shiftValue: number,
): { role: string; detail: string; isFcp: boolean } {
  if (f.isLcp) {
    return { role: 'Biggest piece', detail: 'Biggest piece - the largest part of the page finally lands here', isFcp: false };
  }
  if (shiftValue > 0) {
    return {
      role: 'Layout jump',
      detail: `Layout jump - the red areas moved while a visitor was already reading (a ${shiftValue.toFixed(2)} layout-shift score)`,
      isFcp: false,
    };
  }
  if (fcpFrame && f.timeMs === fcpFrame.timeMs) {
    return { role: 'First content', detail: 'First content - the first pieces of the page land here and the screen stops being blank', isFcp: true };
  }
  // Only forgive the skew on a fast page where first content and the biggest
  // piece land together (FCP ~= LCP) - there a frame caught a hair before the
  // FCP metric already shows content. On a slow page FCP and LCP are far apart
  // and a frame before FCP is genuinely blank, so keep the strict cutoff (else a
  // blank frame <100ms before FCP would wrongly read "content is on screen").
  const fcpNearLcp = fcpFrame !== undefined && lcpMs !== undefined && Math.abs(lcpMs - fcpFrame.timeMs) <= FCP_SKEW_MS;
  const skew = fcpNearLcp ? FCP_SKEW_MS : 0;
  const beforeFirstContent = fcpFrame ? f.timeMs < fcpFrame.timeMs - skew : f === picked[0];
  if (beforeFirstContent) {
    return { role: 'Blank', detail: 'Still blank - nothing is on screen yet', isFcp: false };
  }
  // "Loaded" = this frame sits after the LCP frame in the strip (or clearly
  // past the LCP time when the LCP frame wasn't kept). Position-based, so a
  // frame 170ms after LCP can never read "main content has not appeared yet".
  const lcpIdx = picked.findIndex((p) => p.isLcp);
  const afterMain = lcpIdx >= 0 ? picked.indexOf(f) > lcpIdx : lcpMs !== undefined && f.timeMs > lcpMs + 200;
  if (afterMain) {
    const jumpsLater = picked.some((p) => p.timeMs > f.timeMs && maxShift(p) >= VISIBLE_SHIFT);
    return {
      role: 'Loaded',
      detail: jumpsLater
        ? 'Loaded - the biggest piece is up, but the page is not done settling yet'
        : 'Loaded - the page has settled',
      isFcp: false,
    };
  }
  return { role: 'Filling in', detail: 'Filling in - content is on screen, but the biggest piece of the page has not landed yet', isFcp: false };
}

// Encode the picked frames for one DETAILED page card. `frames` is the page's
// full deduped timeline (read once by the caller, which also needs the count
// for the masthead tally - and which skips this entirely for compact-list
// pages, so a 50-page site doesn't AVIF-encode strips nobody renders).
async function buildShots(resultsDir: string, page: PagePerf, frames: Frame[], dense: boolean): Promise<Shot[]> {
  // Layout-shift pages get a dense strip (every frame differs and matters);
  // load-story pages get fewer (a wall of near-identical blank phones reads as
  // padding, not analysis - the "analysed N frames" caption carries the depth).
  const lcpMs = metricVal(page, 'LCP');
  const fcpMs = metricVal(page, 'FCP');
  const target = dense ? STRIP_DENSE : STRIP_SPARSE;
  const picked = pickFrames(frames, lcpMs, fcpMs, target);
  // Same definition of "first content" pickFrames used for its must-keep, so
  // the labeled frame is always the kept one.
  const fcpFrame = fcpMs !== undefined && picked.length ? nearestFrame(picked, fcpMs) : undefined;
  const shots: Shot[] = [];
  for (const f of picked) {
    const abs = containedJoin(resultsDir, page.id, 'artifacts', f.imageFilename);
    if (!abs) continue;
    const dataUri = await inlineFrame(abs);
    if (!dataUri) continue;
    const { boxes, shiftValue } = framesToBoxes(f);
    const { role, detail, isFcp } = describeShot(f, picked, fcpFrame, lcpMs, shiftValue);
    shots.push({ timeLabel: secs(f.timeMs), dataUri, isLcp: f.isLcp, isFcp, boxes, shiftValue, role, detail });
  }
  return shots;
}

// ---- HTML ----

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// The audit's AI summaries are written by a separate model that sometimes emits
// em/en-dashes; ShakaCode copy is plain-hyphen only.
export const dashSafe = (s: string): string => s.replace(/\s*[—–]\s*/g, ' - ');
const stripTags = (s: string): string => s.replace(/<[^>]+>/g, '');

function mb(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

// Per-problem video caption. `slow-lcp` is intentionally absent: its caption
// needs the page's measured LCP, so the call site builds it (lookup-with-
// fallback rather than a kind dispatcher, per the codebase's table style).
const VIDEO_CAPTIONS: Partial<Record<ProblemKind, string>> = {
  'layout-shift': 'Press play and watch the page jump around as it loads.',
  blank: 'Press play - the screen stays blank almost the entire time.',
  'late-paint': 'Press play - watch how long it sits empty before anything shows.',
  sluggish: 'Press play - watch it stutter while it tries to load.',
  clean: 'Press play - it loads cleanly. See for yourself.',
};

interface RenderedPage {
  page: PagePerf;
  lcpMs?: number;
  status: Status;
  lead: Problem;
  rest: Problem[];
  frames: Frame[]; // full deduped timeline (shots are built only for detailed pages)
  shots: Shot[];
  totalFrames: number;
  windowMs: number;
  videoUri?: string;
  videoCoveredSec?: number;
  captionCues?: CaptionCue[]; // on-video captions, built only for pages with a video
}

// Caption for the load video. The default promises the page's full LCP wait
// "in real time" - only honest when the clip actually covers it. Legacy
// screencasts can be far shorter than the wait (the recording stopped early);
// the caption must then sell only what the clip really shows.
export function videoCaption(leadKind: ProblemKind, lcpMs: number | undefined, coveredSec: number | undefined): string {
  const fixed = VIDEO_CAPTIONS[leadKind];
  if (fixed) return fixed;
  if (lcpMs === undefined) return 'Press play to watch it load, in real time.';
  const lcpS = secs(lcpMs);
  if (coveredSec !== undefined && coveredSec + 1 < lcpMs / 1000) {
    return `Press play - the first ${Math.round(coveredSec)}s of the ${lcpS} a phone visitor waits.`;
  }
  return `Press play - this is the ${lcpS} a phone visitor waits, in real time.`;
}

// ---- on-video captions ----
// Time-synced captions overlaid ON the load video as it plays (Justin's
// 2026-06-16 ask). The screencast starts at navigationStart and the buildVideo
// trim keeps that origin (it only cuts the TAIL), so a cue's `atMs` maps
// straight to the played `video.currentTime`. Cues are the load STORY BEATS -
// the same handful of moments the filmstrip force-keeps - not one-per-frame, so
// the narration reads as a few clear captions, never a per-frame flicker.
export type CueKind = 'blank' | 'first-content' | 'main' | 'jump' | 'loaded';

export interface CaptionCue {
  atMs: number;
  kind: CueKind;
  text: string; // the deterministic phrase; an optional AI pass may rewrite it
}

// When two beats land within this of each other (a fast page where first paint
// IS the biggest piece, or a layout shift right at LCP), only the higher-
// priority beat keeps the slot, so one instant is never double-captioned.
const CUE_MERGE_MS = 600;
// `blank` ranks highest: t=start is blank BY DEFINITION, so on a very fast first
// paint (FCP within CUE_MERGE_MS of the start) the start stays captioned "blank"
// and the near-coincident first-content beat is dropped, never the reverse. The
// rest rank by which beat best names a shared instant (the biggest piece beats a
// coincident first-paint or settle).
const CUE_PRIORITY: Record<CueKind, number> = {
  blank: 6,
  main: 5,
  jump: 4,
  'first-content': 3,
  loaded: 2,
};

// Deterministic, present-tense, plain-language caption per beat. Kept honest and
// page-aware from the measured numbers (the slow-load beat says "finally", a
// quick one does not); an optional AI pass later sharpens the wording but never
// the timing. These read fine on their own when no `claude` CLI is available.
function cueText(kind: CueKind, atMs: number, lcpMs: number | undefined): string {
  switch (kind) {
    case 'blank':
      return 'A blank white screen so far';
    case 'first-content':
      return 'First text and page outline appear';
    case 'main': {
      const slow = lcpMs !== undefined && lcpMs > LCP_WAIT_MS;
      return `The main content ${slow ? 'finally ' : ''}lands, ${secs(atMs)} in`;
    }
    case 'jump':
      return 'The layout jumps as content pushes in';
    case 'loaded':
      return 'The page has finished loading';
  }
}

// Build the ordered caption track for one page's load video from its timeline
// frames + metrics. Empty when the page has no frames (a frameless legacy audit
// still gets a trimmed video, just no captions to sync to). Pure + exported for
// unit tests.
export function buildCaptionCues(
  frames: Frame[],
  lcpMs: number | undefined,
  fcpMs: number | undefined,
  windowMs: number,
): CaptionCue[] {
  if (frames.length === 0) return [];
  const start = frames[0].timeMs;
  const cap = windowMs > 0 ? windowMs : frames[frames.length - 1].timeMs;
  const cue = (atMs: number, kind: CueKind): CaptionCue => ({ atMs, kind, text: cueText(kind, atMs, lcpMs) });

  const raw: CaptionCue[] = [cue(start, 'blank')];

  // First content: nearest frame to FCP, only when first paint is meaningfully
  // after the start (otherwise it coincides with the blank beat and adds nothing).
  if (fcpMs !== undefined) {
    const f = nearestFrame(frames, fcpMs);
    if (f && f.timeMs > start + 150) raw.push(cue(f.timeMs, 'first-content'));
  }

  // The biggest piece (LCP) is the payoff - prefer the flagged LCP frame, else
  // the frame nearest the LCP metric.
  const lcpFrame = frames.find((f) => f.isLcp) ?? (lcpMs !== undefined ? nearestFrame(frames, lcpMs) : undefined);
  if (lcpFrame) raw.push(cue(lcpFrame.timeMs, 'main'));

  // The worst VISIBLE layout shift, if any (sub-visible ripples are not a beat).
  const shiftFrames = frames.filter((f) => maxShift(f) >= VISIBLE_SHIFT);
  if (shiftFrames.length) {
    const worst = shiftFrames.reduce((a, b) => (maxShift(b) > maxShift(a) ? b : a));
    raw.push(cue(worst.timeMs, 'jump'));
  }

  // The settled end of the meaningful window closes the story.
  raw.push(cue(cap, 'loaded'));

  // Drop anything past the trimmed clip, sort, then collapse near-coincident
  // beats to the single highest-priority one AT ITS OWN time - so "the main
  // content lands, Xs in" fires when it actually lands and its seconds match the
  // playhead, not up to CUE_MERGE_MS early. blank outranks everything, so the
  // t=0 opening is never overtaken by a fast first paint.
  const ordered = raw.filter((c) => c.atMs <= cap + 1).sort((a, b) => a.atMs - b.atMs);
  const merged: CaptionCue[] = [];
  for (const c of ordered) {
    const prev = merged[merged.length - 1];
    if (prev && c.atMs - prev.atMs < CUE_MERGE_MS) {
      if (CUE_PRIORITY[c.kind] > CUE_PRIORITY[prev.kind]) merged[merged.length - 1] = c;
      continue;
    }
    merged.push(c);
  }
  return merged;
}

export interface StoryKey {
  startingPath: string;
  leadKind: ProblemKind;
  lcpMs?: number;
}

// Two audits of the SAME path telling the SAME story (an interaction variant
// like "Scrolling the homepage" whose load metrics match the base test within
// run-to-run noise) read as a duplicated card to a client. Such a pair should
// not spend two of the detailed slots; the duplicate stays as a compact row.
// The moment the variant diverges (scroll breaks layout, different lead
// problem, materially different LCP) it stops matching and gets its own card.
export function isDuplicateStory(a: StoryKey, b: StoryKey): boolean {
  if (a.startingPath !== b.startingPath) return false;
  if (a.leadKind !== b.leadKind) return false;
  // Without an LCP on both sides there is no evidence the stories match -
  // two distinct metricless flows on the same path must keep their own cards.
  if (a.lcpMs === undefined || b.lcpMs === undefined) return false;
  return Math.abs(a.lcpMs - b.lcpMs) / Math.max(a.lcpMs, b.lcpMs) <= 0.2;
}

function shotHtml(s: Shot, pageName: string): string {
  const cls = s.isLcp ? 'shot shot--key' : s.shiftValue > 0 ? 'shot shot--shift' : s.isFcp ? 'shot shot--fcp' : 'shot';
  const boxes = s.boxes
    .map((b) => `<span class="sbox" style="left:${b.left.toFixed(2)}%;top:${b.top.toFixed(2)}%;width:${b.width.toFixed(2)}%;height:${b.height.toFixed(2)}%"></span>`)
    .join('');
  // No numeric tag on the thumbnail (illegible at this size); the precise number
  // lives in data-detail and shows in the zoom caption.
  return `
        <figure class="${cls}" role="button" tabindex="0" data-detail="${esc(s.detail)}" aria-label="Enlarge ${esc(pageName)} at ${s.timeLabel}, ${esc(s.role)}">
          <div class="phone"><div class="frame-inner"><img loading="lazy" src="${s.dataUri}" alt="${esc(pageName)} at ${s.timeLabel}" />${boxes}</div></div>
          <figcaption><span class="phase">${esc(s.role)}</span><span class="t">${s.timeLabel}</span></figcaption>
        </figure>`;
}

function pageCardHtml(rp: RenderedPage, siteUrl: string, isFirst: boolean): string {
  const { page, status, lead, rest, shots, totalFrames, videoUri, lcpMs } = rp;
  const score = metricVal(page, 'LH Score');
  const clsV = metricVal(page, 'CLS');
  // Older audits lack downloads-before-LCP; total page weight is a different
  // (larger) quantity, so the label must follow the metric actually shown.
  const beforeLcpKb = metricVal(page, 'downloads-before-LCP');
  const totalKb = metricVal(page, 'downloads');
  const liveUrl = siteUrl && page.startingPath ? `${siteUrl.replace(/\/$/, '')}${page.startingPath}` : '';
  const statusWord = status === 'good' ? 'Good' : status === 'fair' ? 'Needs work' : 'Poor';

  const hasShots = shots.length > 0;
  const filmstrip = hasShots ? shots.map((s) => shotHtml(s, page.name)).join('\n') : '';
  const chips = rest
    .map((p) => `<span class="also">also <b>${esc(p.chip)}</b></span>`)
    .join('');

  const facts = [
    beforeLcpKb !== undefined
      ? `<span class="fact"><b>${mb(beforeLcpKb)}</b> downloaded first</span>`
      : totalKb !== undefined
        ? `<span class="fact"><b>${mb(totalKb)}</b> page weight</span>`
        : '',
    score !== undefined ? `<span class="fact"><b class="sc-${scoreStatus(score)}">${Math.round(score)}/100</b> speed score</span>` : '',
    clsV !== undefined && clsV > CLS_GOOD ? `<span class="fact"><b class="sc-${clsStatus(clsV)}">${(clsV / 100).toFixed(2)}</b> layout-shift score</span>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  // Poster = the loaded/main-content frame, so the player shows the finished page
  // before you press play (then play it to watch the wait / the jump happen).
  const poster = (shots.find((s) => s.isLcp) ?? shots[shots.length - 1])?.dataUri;
  // Caption is a provocation tied to THIS page's problem, not a generic instruction.
  const vidCap = videoCaption(lead.kind, lcpMs, rp.videoCoveredSec);
  // On-video captions: the cue track rides in a data attribute and the sync
  // script (CAPTION_JS) reveals each one as the video clock reaches it. The
  // overlay band is aria-hidden because the same beats are already in the
  // accessible frame-by-frame strip + copy below; this is visual reinforcement.
  const cues = rp.captionCues ?? [];
  const cuesAttr = cues.length
    ? ` data-cues="${esc(JSON.stringify(cues.map((c) => ({ t: Math.round(c.atMs), x: c.text }))))}"`
    : '';
  const videoHtml = videoUri
    ? `<div class="loadvid">
        <div class="phone phone--vid">
          <div class="vidwrap">
            <video controls muted loop playsinline preload="none"${poster ? ` poster="${poster}"` : ''}><source src="${videoUri}" type="video/mp4" /></video>
            <div class="vidcap"${cuesAttr} aria-hidden="true"><span class="vidcap-tx"></span></div>
          </div>
        </div>
        <p class="loadvid-cap">&#9654; ${esc(vidCap)}</p>
      </div>`
    : '';

  return `
    <section class="card">
      <header class="card-head">
        <div class="card-title">
          <h2>${esc(page.name)}</h2>
          ${liveUrl ? `<a class="path" href="${esc(liveUrl)}">${esc(page.startingPath)}</a>` : `<span class="path">${esc(page.startingPath)}</span>`}
        </div>
        <span class="badge badge--${status}"><span class="dot"></span>${statusWord}</span>
      </header>

      <p class="headline headline--${status}">${lead.headline}</p>
      ${lead.note ? `<p class="subhead">${esc(lead.note)}</p>` : ''}
      ${chips ? `<div class="alsos">${chips}</div>` : ''}

      ${videoHtml}

      ${
        hasShots
          ? `<details class="frames"${isFirst ? ' open' : ''}>
        <summary>Frame-by-frame breakdown <span class="fcount">${totalFrames} frames analyzed</span></summary>
        <p class="frames-note">The moments that matter, left to right - tap any frame to enlarge it.</p>
        <div class="filmstrip">
${filmstrip}
        </div>${isFirst ? `
        <p class="strip-note">Blue = the first content lands. Orange = the moment the biggest piece of the page lands. Red boxes = parts of the page that move after a visitor is already reading. A near-blank frame is a phone still showing an empty screen.</p>` : ''}
      </details>`
          : ''
      }

      <div class="facts">
        ${facts}
      </div>

      ${page.summary ? `<p class="plain">${esc(dashSafe(page.summary))}</p>` : ''}
    </section>`;
}

// The pages past the detailed cut get a compact one-line row each, so the report
// stays punchy but still shows we looked at the whole site.
const MORE_ROWS_CAP = 8;
function moreSectionHtml(more: RenderedPage[], siteUrl: string): string {
  const shown = more.slice(0, MORE_ROWS_CAP);
  const extra = more.length - shown.length;
  const rows = shown
    .map((rp) => {
      const liveUrl = siteUrl && rp.page.startingPath ? `${siteUrl.replace(/\/$/, '')}${rp.page.startingPath}` : '';
      const pathHtml = liveUrl ? `<a href="${esc(liveUrl)}">${esc(rp.page.startingPath)}</a>` : esc(rp.page.startingPath);
      return `        <li class="more-row">
          <span class="more-dot more-dot--${rp.status}"></span>
          <span class="more-name"><b>${esc(rp.page.name)}</b> ${pathHtml}</span>
          <span class="more-prob">${esc(stripTags(rp.lead.headline))}</span>
        </li>`;
    })
    .join('\n');
  // "Same pattern" / "all the same story" is only honest when the tail rows
  // actually share one story - a clean green row under that heading (or hidden
  // clean pages behind the overflow line) reads as sloppy or false to a client.
  const uniform = more.length > 0 && more.every((rp) => rp.lead.kind === more[0].lead.kind);
  const heading = uniform ? 'The rest of your pages, same pattern' : 'The rest of the pages we checked';
  const overflowLabel = uniform ? `, all the same story` : ' in the full data';
  const overflow = extra > 0 ? `\n        <li class="more-row more-overflow">+ ${extra} more page${extra === 1 ? '' : 's'}${overflowLabel}</li>` : '';
  return `
    <section class="more">
      <h3 class="more-h">${heading}</h3>
      <ul class="more-list">
${rows}${overflow}
      </ul>
    </section>`;
}

// ============================================================================
// Accessibility tab
// ----------------------------------------------------------------------------
// A second lens over the SAME saved audit, beside Performance. The audit's
// `accessibility` stage (axe-core) writes one scan per page (full-page
// screenshot + WCAG violations with on-page bounds) to <id>/accessibility.json;
// synthesizeSite loads it onto PagePerf.a11y. Designed for a non-technical site
// owner (Sasha's brief): a recognizable Lighthouse-style score, a short
// plain-language summary of what is wrong and what to change, and 2-3 CROPPED
// SCREENSHOT FRAMES of the actual problem spots (no long scroll). Raw axe detail
// stays behind a collapsible "for your developer" block.
//
// Two enrichments come from a sibling pre-pass, read from <id>/accessibility-
// client.json (a small JSON: { score, summary, fixes[] }), with a site-level
// <results>/accessibility-site.json (summary). `score` is a real Google
// Lighthouse ACCESSIBILITY score (axe itself emits none); `summary`/`fixes` are
// an LLM rewrite of the raw axe findings into client language. When the sidecar
// is absent the card falls back to a plain-language issue list and shows no score.

export interface ImpactCounts { critical: number; serious: number; moderate: number; minor: number }

interface A11yClient { score?: number; summary?: string; fixes?: string[] }

interface A11yPageView {
  page: PagePerf;
  scan: AccessibilityScan;
  counts: ImpactCounts;
  client?: A11yClient;
}

export function tallyByImpact(violations: readonly AccessibilityViolation[]): ImpactCounts {
  const c: ImpactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    if (v.impact === 'critical') c.critical++;
    else if (v.impact === 'serious') c.serious++;
    else if (v.impact === 'moderate') c.moderate++;
    else c.minor++; // minor, plus null/unknown impact, so the tallies match the rendered issue list
  }
  return c;
}

const highImpact = (c: ImpactCounts): number => c.critical + c.serious;
const totalIssues = (c: ImpactCounts): number => c.critical + c.serious + c.moderate + c.minor;
// A page gets a card only for a MAJOR barrier (serious/critical); moderate/minor-only pages fold into the reassurance line.
export const hasMajorA11yBarrier = (c: ImpactCounts): boolean => highImpact(c) > 0;

// A11y cards worst-first by the Lighthouse score on each card (lower = worse): it
// weights every check, so it catches high-weight ARIA the axe high-impact count
// misses. Ties: high-impact breadth, critical, moderate, homepage-first/path;
// unscored pages (LH timed out) trail.
export interface A11yPageRank { counts: ImpactCounts; score?: number; startingPath: string }
export function compareA11yWorstFirst(a: A11yPageRank, b: A11yPageRank): number {
  const aScored = Number.isFinite(a.score);
  const bScored = Number.isFinite(b.score);
  if (aScored && bScored) {
    if (a.score !== b.score) return (a.score as number) - (b.score as number);
  } else if (aScored !== bScored) {
    return aScored ? -1 : 1; // unscored page (LH timed out) trails scored ones
  }
  const hi = highImpact(b.counts) - highImpact(a.counts);
  if (hi !== 0) return hi;
  if (b.counts.critical !== a.counts.critical) return b.counts.critical - a.counts.critical;
  if (b.counts.moderate !== a.counts.moderate) return b.counts.moderate - a.counts.moderate;
  const ah = a.startingPath === '/' ? 1 : 0;
  const bh = b.startingPath === '/' ? 1 : 0;
  if (ah !== bh) return bh - ah;
  return a.startingPath.localeCompare(b.startingPath);
}
const isHiImpact = (impact: AccessibilityViolation['impact']): boolean => impact === 'critical' || impact === 'serious';
// Three severity buckets so the report can color + toggle boxes per severity,
// matching the sev chips (high-impact / moderate / low).
export type A11yLevel = 'hi' | 'mid' | 'lo';
const a11yLevel = (impact: AccessibilityViolation['impact']): A11yLevel =>
  impact === 'critical' || impact === 'serious' ? 'hi' : impact === 'moderate' ? 'mid' : 'lo';
export const scoreBucket = (s: number): 'good' | 'fair' | 'poor' => (s >= 90 ? 'good' : s >= 50 ? 'fair' : 'poor');

// The phone scan for a page that actually has violations. The accessibility
// stage writes exactly one scan per (page, viewport) file; synthesis already
// resolved the phone row, so scans[0] is the phone scan.
function a11yScan(page: PagePerf): AccessibilityScan | undefined {
  const scan = page.a11y?.scans?.[0];
  if (!scan) return undefined;
  // Keep a bot-walled scan even with zero violations so the report can surface it
  // as "could not measure" rather than dropping it (or mistaking it for clean).
  return scan.violations.length > 0 || scan.blocked === true ? scan : undefined;
}

// A page is accessibility-clean ONLY if it produced a real scan with zero
// violations. A page whose scan failed or came back empty (scans: []) is
// UNMEASURED, not clean - it must never be claimed clean in a client-facing
// report (the "No accessibility issues detected on ..." line reads from this).
export function pageHasCleanA11y(page: PagePerf): boolean {
  const scan = page.a11y?.scans?.[0];
  return !!scan && scan.violations.length === 0 && scan.blocked !== true;
}

// Per-page LLM rewrite + Lighthouse score, written by the enrichment pre-pass.
export function readA11yClient(resultsDir: string, pageId: string): A11yClient | undefined {
  const p = containedJoin(resultsDir, pageId, 'accessibility-client.json');
  if (!p || !fs.existsSync(p)) return undefined;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const fixes = Array.isArray(j.fixes) ? j.fixes.filter((x): x is string => typeof x === 'string') : undefined;
    return {
      score: typeof j.score === 'number' ? j.score : undefined,
      summary: typeof j.summary === 'string' ? j.summary : undefined,
      fixes: fixes && fixes.length ? fixes : undefined,
    };
  } catch {
    return undefined;
  }
}

function readA11ySiteSummary(resultsDir: string): string | undefined {
  const p = path.join(resultsDir, 'accessibility-site.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    return typeof j.summary === 'string' ? j.summary : undefined;
  } catch {
    return undefined;
  }
}

function buildA11yPages(pages: PagePerf[], resultsDir: string): A11yPageView[] {
  const views: A11yPageView[] = [];
  for (const page of pages) {
    const scan = a11yScan(page);
    if (!scan) continue;
    views.push({ page, scan, counts: tallyByImpact(scan.violations), client: readA11yClient(resultsDir, page.id) });
  }
  // Worst accessibility first (see compareA11yWorstFirst).
  views.sort((a, b) =>
    compareA11yWorstFirst(
      { counts: a.counts, score: a.client?.score, startingPath: a.page.startingPath },
      { counts: b.counts, score: b.client?.score, startingPath: b.page.startingPath },
    ),
  );
  return views;
}

// Optional AI pass: rewrite the raw axe findings into a plain-language summary +
// fixes per page and a site summary, persisted to the sidecars the cards read.
// Cache-and-reuse: only calls claude when a page or the site summary is missing,
// never overwrites a cached page; best-effort, so a null result keeps the raw axe
// text. Only pages with violations are sent.
export async function enrichA11ySummaries(
  resultsDir: string,
  pages: PagePerf[],
  summarize: A11ySummarizer,
): Promise<void> {
  const targets = pages
    .map((page) => ({ page, scan: a11yScan(page) }))
    .filter((t): t is { page: PagePerf; scan: AccessibilityScan } => !!t.scan);
  if (targets.length === 0) return;

  const existing = targets.map((t) => readA11yClient(resultsDir, t.page.id));
  const needsPage = existing.map((c) => !(c?.summary && c.fixes && c.fixes.length));
  const siteHas = readA11ySiteSummary(resultsDir) !== undefined;
  // Everything already cached -> no claude call.
  if (!needsPage.some(Boolean) && siteHas) return;

  // Send ALL violation pages (not just the uncached ones) so the model has full
  // cross-page context for the site summary; cached pages are skipped at the
  // write step below via needsPage, never overwritten.
  const reqs: A11ySummaryRequest[] = targets.map((t, i) => ({
    pageName: t.page.name,
    path: t.page.startingPath,
    score: existing[i]?.score,
    counts: tallyByImpact(t.scan.violations),
    issues: sortViolations(t.scan.violations).map((v) => ({
      impact: v.impact,
      help: v.help,
      places: v.nodes.length,
    })),
  }));

  const result = await summarize(reqs);
  if (!result) return;

  targets.forEach((t, i) => {
    // Cache-and-reuse: never overwrite a page that already had a summary.
    if (!needsPage[i]) return;
    const ps = result.pages[i];
    if (!ps) return;
    const dir = containedJoin(resultsDir, t.page.id);
    if (dir) writeAccessibilityClientSummary(dir, ps);
  });
  if (!siteHas && result.site) writeAccessibilitySiteSummary(resultsDir, result.site);
}

// 2-3 CROPPED frames around the densest problem clusters - not a full-page
// scroll. The inline AVIF is decoded once, violating nodes are clustered by
// vertical position, the heaviest 3 clusters are cut out with sharp, and each
// node in a cut gets a box positioned in % of THAT crop.
interface A11yBox { left: string; top: string; width: string; height: string; hi: boolean; level: A11yLevel }
interface A11yFrame { dataUri: string; boxes: A11yBox[]; summary: string; count: number }

// Caption for one crop: the 1-2 dominant issue types in it, worst-weighted, in
// plain language - so it says WHAT to look at, not just where on the page.
export function a11yFrameSummary(rules: { rule: string; hi: boolean }[]): string {
  const weight = new Map<string, number>();
  for (const r of rules) {
    const label = a11yIssueLabel(r.rule);
    weight.set(label, (weight.get(label) ?? 0) + (r.hi ? 3 : 1));
  }
  // Weight desc, then label asc so ties are deterministic (stable captions/tests).
  const top = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  const phrase = top.length <= 1 ? (top[0] ?? 'accessibility issues') : `${top[0]} and ${top[1]}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

const A11Y_FRAMES = 3;
const A11Y_FRAME_MAX_PX = 600;     // tallest a single crop may be (avoids a long scroll)
const A11Y_CLUSTER_GAP_PX = 150;   // nodes within this vertical gap join one cluster
const A11Y_BOXES_PER_FRAME = 16;
// Max per-channel stddev for a crop to count as a flat placeholder. A collapsed
// or lazy section (e.g. an "Expand" grid) renders as one near-uniform grey block:
// the violation nodes have real layout boxes there, but the highlight would land
// on blank space. Real content (text/images) sits far above this.
const A11Y_BLANK_STDEV = 6;

const toPct = (ratio: number): string => `${(clamp01(ratio) * 100).toFixed(2)}%`;

// Exported for the crop-filter integration test (structural rules must yield no
// crop, spatial rules must still crop). Not part of the public report API.
// `dropEngulfing` (v2 only): skip a coarse box that covers the whole crop and
// count only the boxes actually drawn. v1 passes false so its crop output stays
// byte-for-byte unchanged.
export async function a11yCropFrames(scan: AccessibilityScan, dropEngulfing = false): Promise<A11yFrame[]> {
  const shot = scan.screenshot;
  const source = shot?.imageDataUri ?? shot?.imageHref;
  if (!shot || !source) return [];
  const m = /^data:[^;]*;base64,(.+)$/.exec(source);
  if (!m) return []; // only the inline data URI is croppable here
  let buf: Buffer;
  let avifW: number;
  let avifH: number;
  try {
    buf = Buffer.from(m[1], 'base64');
    const meta = await sharp(buf).metadata();
    avifW = meta.width ?? shot.width;
    avifH = meta.height ?? shot.height;
  } catch {
    return [];
  }
  const sx = avifW / Math.max(1, shot.width);
  const sy = avifH / Math.max(1, shot.height);
  const nodes = localizedHotspots(scan)
    // Structural rules have no spot to box - skip crops; they still count + get described.
    .filter(({ violation }) => !isStructuralA11yRule(violation.ruleId))
    .map(({ violation, node }) => ({
      x: node.bounds!.x * sx,
      y: node.bounds!.y * sy,
      w: node.bounds!.width * sx,
      h: node.bounds!.height * sy,
      hi: isHiImpact(violation.impact),
      level: a11yLevel(violation.impact),
      rule: violation.ruleId,
    }))
    .filter((n) => n.y >= 0 && n.y < avifH && n.w > 0 && n.h > 0)
    .sort((a, b) => a.y - b.y);
  if (nodes.length === 0) return [];

  type Band = { top: number; bottom: number; nodes: typeof nodes };
  const bands: Band[] = [];
  for (const n of nodes) {
    const last = bands[bands.length - 1];
    if (last && n.y - last.bottom <= A11Y_CLUSTER_GAP_PX && n.y + n.h - last.top <= A11Y_FRAME_MAX_PX) {
      last.bottom = Math.max(last.bottom, n.y + n.h);
      last.nodes.push(n);
    } else {
      bands.push({ top: n.y, bottom: n.y + n.h, nodes: [n] });
    }
  }
  // v2 (dropEngulfing) skips flat-placeholder bands and takes the next real one
  // (one blank kept as last resort); v1 selection is unchanged.
  const ranked = bands
    .map((b) => ({ b, w: b.nodes.reduce((s, n) => s + (n.level === 'hi' ? 3 : n.level === 'mid' ? 2 : 1), 0) }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.b);

  type Cut = { top: number; height: number; inWin: typeof nodes; cropUri: string };
  const cuts: Cut[] = [];
  let blankFallback: Cut | undefined;
  for (const band of ranked) {
    if (cuts.length >= A11Y_FRAMES) break;
    const top = Math.max(0, Math.round(band.top - 24));
    const height = Math.max(1, Math.min(Math.round(band.bottom - top + 24), A11Y_FRAME_MAX_PX, avifH - top));
    const inWin = band.nodes.filter((n) => n.y + n.h > top && n.y < top + height);
    if (inWin.length === 0) continue; // never emit an empty crop
    const region = sharp(buf).extract({ left: 0, top, width: avifW, height });
    // Never skip a color-contrast band: low-contrast text reads as flat but is the finding to show.
    const exemptFromBlank = !dropEngulfing || inWin.some((n) => n.rule === 'color-contrast');
    let blank = false;
    if (!exemptFromBlank) {
      try {
        const stats = await region.clone().stats();
        const maxStdev = stats.channels.length ? Math.max(...stats.channels.map((c) => c.stdev)) : Infinity;
        blank = maxStdev < A11Y_BLANK_STDEV;
      } catch {
        blank = false; // can't measure variance -> treat as content, don't drop it
      }
    }
    // skip the AVIF encode for blanks past the first (the fallback).
    if (blank && blankFallback) continue;
    let cropUri: string;
    try {
      const out = await region.clone().avif({ quality: 50 }).toBuffer();
      cropUri = `data:image/avif;base64,${out.toString('base64')}`;
    } catch {
      continue;
    }
    const cut: Cut = { top, height, inWin, cropUri };
    if (blank) {
      blankFallback = cut; // heaviest blank crop, used only if nothing better
      continue;
    }
    cuts.push(cut);
  }
  if (cuts.length === 0 && blankFallback) cuts.push(blankFallback);
  cuts.sort((a, b) => a.top - b.top);

  const frames: A11yFrame[] = [];
  for (const { top, height, inWin, cropUri } of cuts) {
    // Clamp each box to the crop edges so a node spilling past the window does
    // not render oversized. Drop a box that would ENGULF the crop (a coarse
    // container bound from axe, not a pinpoint - it localizes nothing); the crop
    // + caption still convey the issue.
    const boxes: A11yBox[] = [];
    for (const n of inWin.slice(0, A11Y_BOXES_PER_FRAME)) {
      const left = clamp01(n.x / avifW);
      const topR = clamp01((n.y - top) / height);
      const wFrac = Math.min(n.w / avifW, 1 - left);
      const hFrac = Math.min(n.h / height, 1 - topR);
      if (dropEngulfing && wFrac >= 0.85 && hFrac >= 0.6) continue; // engulfing -> not a useful highlight
      boxes.push({ left: toPct(left), top: toPct(topR), width: toPct(wFrac), height: toPct(hFrac), hi: n.hi, level: n.level });
    }
    if (dropEngulfing && boxes.length === 0) continue; // every node here was a coarse engulfing bound
    // Caption names the dominant issue type(s) in THIS crop, weighted by impact.
    // count is the true number of flagged spots in the band; the drawn boxes are
    // capped (A11Y_BOXES_PER_FRAME), so on a dense band the boxes are a sample.
    const summary = a11yFrameSummary(inWin.map((n) => ({ rule: n.rule, hi: n.hi })));
    // v2 drew only the non-engulfing boxes, so "N spots" must count those, not the
    // whole band; v1 keeps the band count (it draws every box).
    frames.push({ dataUri: cropUri, boxes, summary, count: dropEngulfing ? boxes.length : inWin.length });
  }
  return frames;
}

function a11yFramesHtml(frames: A11yFrame[]): string {
  if (!frames.length) return '';
  const figs = frames.map((f) => {
    const boxes = f.boxes
      .map((b) => `<span class="a11y-box a11y-box--${b.hi ? 'hi' : 'lo'}" style="left:${b.left};top:${b.top};width:${b.width};height:${b.height}"></span>`)
      .join('');
    const spots = `${f.count} ${f.count === 1 ? 'spot' : 'spots'}`;
    const detail = `${spots} - red is high-impact, orange is minor`;
    return `<figure class="a11y-frame" role="button" tabindex="0" data-zoom-title="${esc(f.summary)}" data-zoom-detail="${esc(detail)}" aria-label="Enlarge: ${esc(f.summary)}, ${spots}">
          <div class="a11y-frame__img"><img src="${esc(f.dataUri)}" alt="Screenshot detail with accessibility issues highlighted" loading="lazy" />${boxes}</div>
          <figcaption class="a11y-frame__cap">${esc(f.summary)} &middot; ${spots}</figcaption>
        </figure>`;
  }).join('');
  return `<div class="a11y-frames">${figs}</div>`;
}

// 3 honest buckets: high-impact (critical+serious), moderate, low (minor).
function a11yTallyHtml(c: ImpactCounts): string {
  const chip = (n: number, label: string, k: 'hi' | 'mid' | 'lo'): string =>
    n > 0 ? `<span class="a11y-sev a11y-sev--${k}">${n} ${label}</span>` : '';
  return `<div class="a11y-tally">${chip(highImpact(c), 'high-impact', 'hi')}${chip(c.moderate, 'moderate', 'mid')}${chip(c.minor, 'low', 'lo')}</div>`;
}

const A11Y_SCORE_NOTE = 'Score is the Google Lighthouse accessibility score (0-100), the same scale Chrome and PageSpeed use.';

function a11yScoreBadge(score: number | undefined): string {
  if (typeof score !== 'number') return '';
  return `<div class="a11y-score a11y-score--${scoreBucket(score)}" title="${esc(A11Y_SCORE_NOTE)}"><div class="a11y-score__num">${score}</div><div class="a11y-score__lbl">accessibility</div></div>`;
}

// LLM "what to change" list - the client-language replacement for raw axe text.
function a11yFixesHtml(fixes: string[] | undefined): string {
  if (!fixes || !fixes.length) return '';
  const items = fixes.map((f) => `<li>${esc(dashSafe(f))}</li>`).join('');
  return `<div class="a11y-fixes"><h3>What to change</h3><ul>${items}</ul></div>`;
}

// Fallback when no LLM rewrite exists. NEVER print the raw axe `help`
// sentences: they carry jargon a non-technical owner won't parse ("ARIA",
// "WCAG", rule names from the original report). Instead group the violations
// by the SAME plain-language label the crop captions use, summing the spots,
// so a card without the AI pre-pass still reads in client language.
const A11Y_ISSUE_LINES = 6;
export function a11yIssuesHtml(violations: readonly AccessibilityViolation[]): string {
  // Worst-first (sortViolations order) so the first time a label appears fixes
  // its rank; merge rules that share a label (e.g. the aria-* family) into one
  // line and sum the affected spots.
  const groups = new Map<string, { places: number; hi: boolean }>();
  for (const v of sortViolations(violations)) {
    const label = a11yIssueLabel(v.ruleId);
    const g = groups.get(label) ?? { places: 0, hi: false };
    g.places += v.nodes.length;
    g.hi = g.hi || isHiImpact(v.impact);
    groups.set(label, g);
  }
  const entries = [...groups.entries()];
  const visible = entries.slice(0, A11Y_ISSUE_LINES);
  const hidden = entries.length - visible.length;
  const items = visible.map(([label, g]) => {
    const dot = g.hi ? 'a11y-dot--hi' : 'a11y-dot--lo';
    const text = label.charAt(0).toUpperCase() + label.slice(1);
    return `<li class="a11y-issue"><span class="a11y-dot ${dot}"></span><span class="a11y-issue__text">${esc(text)} <b>&middot; ${g.places} ${g.places === 1 ? 'place' : 'places'} affected</b></span></li>`;
  }).join('');
  const more = hidden > 0 ? `<li class="a11y-issue a11y-issue--more">+${hidden} more issue${hidden === 1 ? '' : 's'} on this page</li>` : '';
  return `<ol class="a11y-issues">${items}${more}</ol>`;
}

async function a11yCardHtml(view: A11yPageView): Promise<string> {
  const { page, scan, counts, client } = view;
  const pathLabel = page.startingPath || '/';
  const frames = await a11yCropFrames(scan);
  const summary = client?.summary ? `<p class="a11y-summary">${esc(dashSafe(client.summary))}</p>` : '';
  // LLM "what to change" replaces the issue list when the enrichment ran;
  // otherwise fall back to a plain-language issue list (label-based, no jargon).
  const fixes = client?.fixes?.length ? a11yFixesHtml(client.fixes) : a11yIssuesHtml(scan.violations);
  return `<section class="a11y-card">
      <header class="card-head">
        <div class="card-title"><h2>${esc(page.name)}</h2><div class="path">${esc(pathLabel)}</div></div>
        ${a11yScoreBadge(client?.score)}
      </header>
      ${a11yTallyHtml(counts)}
      ${summary}
      ${a11yFramesHtml(frames)}
      ${fixes}
    </section>`;
}

async function a11yPanelHtml(views: A11yPageView[], cleanPaths: string[], siteSummary: string | undefined): Promise<string> {
  // Card only major-barrier pages; the rest fold into the reassurance line.
  const carded = views.filter((v) => hasMajorA11yBarrier(v.counts));
  const minorOnly = views.filter((v) => !hasMajorA11yBarrier(v.counts));
  const hi = carded.reduce((n, v) => n + highImpact(v.counts), 0);
  // Site-wide average (all scored pages, not just carded); only shown when every page is scored.
  const scores = views.map((v) => v.client?.score).filter((s): s is number => typeof s === 'number');
  const avg = scores.length === views.length && views.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : undefined;
  // allSettled so one page's render failure degrades to a skipped card instead
  // of failing the whole report.
  const cards = (await Promise.allSettled(carded.map(a11yCardHtml)))
    .map((r, i) => (r.status === 'fulfilled' ? r.value : `<!-- accessibility card omitted for ${esc(carded[i].page.id)} -->`))
    .join('\n');
  // Pages with no major barrier (moderate-only + clean): acknowledged, not carded.
  const noMajor = minorOnly.length + cleanPaths.length;
  const reassure = noMajor > 0
    ? `<p class="a11y-clean">${carded.length > 0
        ? `The other ${noMajor} page${noMajor === 1 ? '' : 's'} we checked ${noMajor === 1 ? 'has' : 'have'} no major accessibility barriers.`
        : `Every page we checked is in good shape - no major accessibility barriers.`}</p>`
    : '';
  const note = siteSummary
    ? `<p class="summary-note">${esc(dashSafe(siteSummary))}</p>`
    : `<p class="summary-note">We checked each page the way a screen-reader or keyboard-only visitor would use it. The cards below are the pages with a major barrier worth fixing first.</p>`;
  // Bridge the high score vs the flagged pages - only when there IS one to flag.
  const bridge = avg !== undefined && carded.length > 0
    ? `<p class="a11y-bridge">A high score means most of each page is fine. But it only takes one blocking issue to turn a real customer away, so the page${carded.length === 1 ? '' : 's'} below ${carded.length === 1 ? 'is' : 'are'} where we'd start.</p>`
    : '';
  const firstStat = avg !== undefined
    ? `<div class="stat"><div class="num ${scoreBucket(avg)}">${avg}</div><div class="lbl">average accessibility score</div></div>`
    : `<div class="stat"><div class="num">${views.length}</div><div class="lbl">pages checked</div></div>`;
  // The crop/legend explanation is only meaningful when there are cards to read.
  const howto = carded.length > 0
    ? `<p class="howto"><b>How to read this.</b> Each card explains what to change in plain language and shows a zoomed-in shot of any problem you can see on the page - <span class="a11y-key a11y-key--hi">red</span> is high-impact, <span class="a11y-key a11y-key--lo">orange</span> is minor. Structure issues like heading order have nothing to point at on screen, so they have no shot and are described in the text. ${esc(A11Y_SCORE_NOTE)}</p>`
    : `<p class="howto">${esc(A11Y_SCORE_NOTE)}</p>`;
  const outro = carded.length > 0
    ? `<p class="outro">The high-impact items are the ones quietly costing you customers who cannot get through the page, and they are usually quick to fix once you know where they are. Happy to walk your team through any of this.</p>`
    : `<p class="outro">Nothing here is blocking customers today. Happy to walk your team through the smaller polish items.</p>`;
  // Accessibility/SEO bridge at the top: the same structure screen readers need
  // is what search engines read, so the fixes below double as SEO work.
  const seo = '<p class="a11y-seo"><b>Accessibility helps your search ranking.</b> Search engines read the same labels, headings, and alt text that visitors with limited vision, color blindness, or keyboard navigation rely on, so these fixes help your SEO too.</p>';
  return `<div class="tab-panel" id="a11y-panel" role="tabpanel" aria-labelledby="tab-a11y" hidden>
  ${seo}
  <div class="summary">
    ${firstStat}
    <div class="stat"><div class="num ${carded.length > 0 ? 'poor' : 'good'}">${carded.length}</div><div class="lbl">page${carded.length === 1 ? '' : 's'} with serious barriers</div></div>
    <div class="stat"><div class="num ${hi > 0 ? 'poor' : 'good'}">${hi}</div><div class="lbl">high-impact issues</div></div>
  </div>
  ${bridge}
  ${note}
  ${howto}
${cards}
${reassure}
  ${outro}
</div>`;
}

function tabBarHtml(opts: { a11yIssues?: number; agentPill?: string }): string {
  const tabs: string[] = [
    `<button class="tab" role="tab" id="tab-perf" aria-controls="perf-panel" aria-selected="true" tabindex="0">Performance</button>`,
  ];
  if (opts.a11yIssues !== undefined) {
    // Pill only when there's something to fix ("Accessibility 0" reads as an error).
    const pill = opts.a11yIssues > 0 ? `<span class="tab-pill">${opts.a11yIssues}</span>` : '';
    tabs.push(`<button class="tab" role="tab" id="tab-a11y" aria-controls="a11y-panel" aria-selected="false" tabindex="-1">Accessibility${pill}</button>`);
  }
  if (opts.agentPill !== undefined) {
    tabs.push(`<button class="tab" role="tab" id="tab-agent" aria-controls="agent-panel" aria-selected="false" tabindex="-1">Agent Ready${opts.agentPill}</button>`);
  }
  return `  <div class="tabs" role="tablist" aria-label="Report sections">
    ${tabs.join('\n    ')}
  </div>`;
}

const TAB_JS = `
<script>
(function(){
  var tabs=Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  if(tabs.length<2) return;
  function select(id){
    tabs.forEach(function(t){
      var on=t.getAttribute('aria-controls')===id;
      t.setAttribute('aria-selected',on?'true':'false');
      t.tabIndex=on?0:-1;
      var panel=document.getElementById(t.getAttribute('aria-controls'));
      if(panel) panel.hidden=!on;
    });
  }
  tabs.forEach(function(t){
    t.addEventListener('click',function(){ select(t.getAttribute('aria-controls')); });
    t.addEventListener('keydown',function(e){
      if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return;
      e.preventDefault();
      var i=tabs.indexOf(t);
      var n=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
      n.focus(); n.click();
    });
  });
  select('perf-panel'); // JS-on: show the Performance panel first. JS-off: Performance stays visible; the Accessibility panel is revealed only when printed (print CSS).
})();
</script>`;

function styles(): string {
  return `
  :root{
    --ink:#1f2630; --muted:#6b7480; --line:#e7e9ee; --bg:#f6f7f9; --card:#ffffff;
    --good:#1a9e57; --fair:#d98324; --poor:#d0454c;
    --good-bg:#e9f6ee; --fair-bg:#fbf0e1; --poor-bg:#fbe9ea;
    --accent:#2b6cb0; --shift:#d0454c;
    --measure:780px;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;}
  .wrap{max-width:var(--measure); margin:0 auto; padding:40px 22px 64px}
  a{color:var(--accent); text-decoration:none} a:hover{text-decoration:underline}

  .masthead{margin:0 0 26px}
  .brand{display:inline-block; margin:0 0 18px; line-height:0}
  .brand svg{height:30px; width:auto; display:block}
  .kicker{font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 6px}
  .masthead h1{font-size:30px; line-height:1.2; margin:0 0 12px; letter-spacing:-.01em}
  .masthead h1 .site{color:var(--accent)}
  .lede{font-size:17px; color:#3b434e; margin:0 0 10px; max-width:62ch}
  .captured{font-size:16px; color:#3b434e; margin:0 0 18px; max-width:62ch}
  .captured b{color:var(--ink); font-weight:700}

  .summary{display:flex; flex-wrap:wrap; gap:0; background:var(--card); border:1px solid var(--line);
    border-radius:14px; overflow:hidden; margin:0 0 14px;}
  .summary .stat{flex:1 1 0; min-width:140px; padding:16px 18px; border-right:1px solid var(--line)}
  .summary .stat:last-child{border-right:0}
  .summary .num{font-size:24px; font-weight:700; letter-spacing:-.01em}
  .summary .lbl{font-size:14px; color:var(--muted); margin-top:2px}
  .num.good{color:var(--good)} .num.fair{color:var(--fair)} .num.poor{color:var(--poor)}
  .summary-note{font-size:16px; color:#3b434e; margin:0 0 18px; max-width:64ch}

  .howto{font-size:15px; color:var(--muted); margin:0 0 30px; line-height:1.5}
  .howto b{color:var(--ink); font-weight:600}

  .card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px 22px 20px; margin:0 0 18px;}
  .card-head{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin:0 0 10px}
  .card-title h2{font-size:19px; margin:0; letter-spacing:-.01em}
  .card-title .path{font-size:14px; color:var(--muted)}
  .badge{display:inline-flex; align-items:center; gap:7px; flex:none; font-size:13px; font-weight:600; padding:5px 11px; border-radius:999px; white-space:nowrap;}
  .badge .dot{width:8px; height:8px; border-radius:50%}
  .badge--good{background:var(--good-bg); color:#137a43} .badge--good .dot{background:var(--good)}
  .badge--fair{background:var(--fair-bg); color:#9a5a12} .badge--fair .dot{background:var(--fair)}
  .badge--poor{background:var(--poor-bg); color:#a82f36} .badge--poor .dot{background:var(--poor)}

  .headline{font-size:19px; margin:2px 0 4px; color:var(--ink); line-height:1.35}
  .headline strong{font-weight:700}
  .headline--good strong{color:var(--good)} .headline--fair strong{color:var(--fair)} .headline--poor strong{color:var(--poor)}
  .subhead{font-size:15.5px; color:#5a626d; margin:0 0 8px; max-width:62ch}
  .alsos{display:flex; flex-wrap:wrap; gap:6px; margin:0 0 4px}
  .also{font-size:13.5px; color:#7a818b; background:#f3f4f6; border-radius:7px; padding:4px 10px}
  .also b{color:#48515c; font-weight:600}

  .frames-note{font-size:14px; color:var(--muted); margin:10px 0 8px}
  .frames-note b{color:var(--ink)}

  /* The .shot--key scale(1.07) grows a key frame ~17px UPWARD (transform-origin
     is center bottom). row-gap clears that between rows; the top padding clears
     it for the FIRST row, which has the section text above it, not a row. */
  .filmstrip{display:flex; gap:28px 13px; justify-content:center; align-items:flex-start; flex-wrap:wrap; padding:20px 0 6px}
  .shot{margin:0; flex:0 0 auto; text-align:center; width:118px; cursor:zoom-in; outline:none}
  .shot:focus-visible .phone{box-shadow:0 0 0 3px var(--accent)}
  /* dark device bezel so a BLANK (white) screen reads as a phone, not a broken image */
  .phone{border-radius:14px; padding:5px; background:#363c47; box-shadow:0 2px 5px rgba(20,30,45,.16)}
  .frame-inner{position:relative; border-radius:9px; overflow:hidden; background:#f2f4f7}
  .frame-inner img{display:block; width:100%; height:auto}
  /* layout-shift regions, drawn in % so they scale in the strip AND the zoom */
  .sbox{position:absolute; border:2px solid var(--shift); background:rgba(208,69,76,.22); border-radius:2px; box-shadow:0 0 0 1px rgba(255,255,255,.4)}
  /* scale only the phone, not the whole shot, so the caption text stays crisp
     (a transform on the shot sub-pixel-blurs its figcaption -> looks like a
     different font). Row-gap above already clears the phone's upward overflow. */
  .shot--key .phone{transform:scale(1.07); transform-origin:center bottom}
  .shot--key .phone{background:#3b3326; box-shadow:0 0 0 4px #d98324, 0 0 0 5px rgba(217,131,36,.28), 0 3px 8px rgba(20,30,45,.18)}
  .shot--shift .phone{box-shadow:0 0 0 2px rgba(208,69,76,.55), 0 2px 6px rgba(20,30,45,.14)}
  .shot--fcp .phone{box-shadow:0 0 0 3px #2b6cb0, 0 0 0 4px rgba(43,108,176,.28), 0 2px 6px rgba(20,30,45,.14)}
  figcaption{margin-top:10px; font-size:16px; line-height:1.4}
  figcaption .phase{display:block; font-weight:600; color:var(--ink)}
  figcaption .t{color:var(--muted)}
  .shot--key figcaption .phase{color:#9a5a12}
  .shot--shift figcaption .phase{color:#a82f36}
  .shot--fcp figcaption .phase{color:var(--accent)}
  .strip-note{margin:4px 0 2px; font-size:13.5px; color:var(--muted); text-align:center; font-style:italic; line-height:1.45}
  .sc-good{color:var(--good)} .sc-fair{color:var(--fair)} .sc-poor{color:var(--poor)}

  /* load video - the "watch it happen" hero, in a phone bezel like the frames */
  .loadvid{margin:16px 0 6px; text-align:center}
  .phone--vid{display:inline-block; width:280px; max-width:86%; padding:6px; vertical-align:top}
  .vidwrap{position:relative; line-height:0; border-radius:11px; overflow:hidden}
  .phone--vid video{display:block; width:100%; height:auto; border-radius:11px; background:#0b0e12}
  /* on-video captions: a lower-third band that fades each beat in as the clip
     reaches it. The text is raised (bottom padding) so it clears the native
     control bar when that's visible on pause/hover; the scrim still anchors to
     the bottom so white text stays legible over any frame, even a blank white one. */
  .vidcap{position:absolute; left:0; right:0; bottom:0; padding:34px 12px 54px;
    background:linear-gradient(to top, rgba(8,11,15,.92) 0%, rgba(8,11,15,.74) 42%, rgba(8,11,15,0) 100%);
    text-align:center; opacity:0; transition:opacity .25s ease; pointer-events:none}
  .vidcap.show{opacity:1}
  .vidcap-tx{display:inline-block; max-width:92%; color:#fff; font-size:14px; line-height:1.35;
    font-weight:600; letter-spacing:.004em; text-shadow:0 1px 3px rgba(0,0,0,.7)}
  .loadvid-cap{font-size:15px; color:#5a626d; margin:10px auto 0; max-width:46ch}

  /* frame-by-frame: collapsed by default (video is the hero), depth on demand */
  details.frames{margin:14px 0 2px; border-top:1px solid var(--line); padding-top:10px}
  details.frames > summary{cursor:pointer; font-size:15px; font-weight:600; color:#48515c; list-style:none; display:flex; align-items:center; gap:8px}
  details.frames > summary::-webkit-details-marker{display:none}
  details.frames > summary::before{content:"\\25B8"; color:var(--muted); font-size:11px}
  details.frames[open] > summary::before{content:"\\25BE"}
  details.frames > summary:hover{color:var(--ink)}
  details.frames > summary .fcount{font-weight:400; color:var(--muted); font-size:13.5px}

  .facts{display:flex; flex-wrap:wrap; gap:8px 10px; margin:12px 0 0}
  .fact{font-size:15px; color:#48515c; background:#f3f4f6; border-radius:8px; padding:7px 11px}
  .fact b{color:var(--ink); font-weight:700}

  .plain{font-size:16px; color:#3b434e; margin:14px 0 0; padding:12px 14px; background:#f7f8fa; border-left:3px solid var(--line); border-radius:0 8px 8px 0}

  .more{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 22px; margin:0 0 18px}
  .more-h{font-size:16px; margin:0 0 8px; color:var(--ink); font-weight:600}
  .more-list{list-style:none; margin:0; padding:0}
  .more-row{display:flex; align-items:baseline; gap:10px; padding:9px 0; border-top:1px solid var(--line)}
  .more-row:first-child{border-top:0}
  .more-dot{width:8px; height:8px; border-radius:50%; flex:none; transform:translateY(1px)}
  .more-dot--good{background:var(--good)} .more-dot--fair{background:var(--fair)} .more-dot--poor{background:var(--poor)}
  .more-name{flex:1 1 auto; font-size:15.5px} .more-name b{font-weight:600} .more-name a{color:var(--muted); font-size:14px}
  .more-prob{flex:0 0 auto; font-size:15px; color:#5a626d; text-align:right}
  .more-overflow{color:var(--muted); font-style:italic}

  .outro{font-size:16px; line-height:1.5; color:#3b434e; margin:26px 2px 0}
  .a11y-seo{font-size:14.5px; line-height:1.5; color:#475063; margin:0 0 18px; padding:10px 13px; background:#f4f7fb; border-radius:8px}

  .foot{margin:26px 2px 0; font-size:14px; color:var(--muted); line-height:1.6}
  .foot .by{color:#48515c}

  /* lightbox */
  .lightbox{position:fixed; inset:0; background:rgba(15,20,28,.85); display:none; align-items:center; justify-content:center; flex-direction:column; z-index:50; cursor:zoom-out; padding:24px}
  .lightbox.on{display:flex}
  .lb-stage{max-width:min(440px,92vw); width:100%; display:flex; align-items:center; justify-content:center; min-height:0}
  .lb-stage .phone{padding:7px; border-radius:20px; max-width:100%; margin:0}
  .lb-stage .frame-inner{border-radius:13px}
  /* Height-bound the enlarged frame so the bezel shrinks WITH the window and the
     caption below it always stays on screen (the base .frame-inner img is
     width:100%, which on a short window made the frame tall enough to push the
     caption off the bottom). Reserve ~180px for caption + hint + padding. */
  .lb-stage .frame-inner img{width:auto; height:auto; max-width:100%; max-height:calc(100vh - 180px); object-fit:contain; display:block}
  .lb-cap{color:#eef1f4; margin-top:16px; font-size:15px; text-align:center; max-width:min(440px,92vw); line-height:1.45}
  .lb-cap b{color:#fff}
  .lb-hint{color:#9aa3ad; font-size:12.5px; margin-top:4px}
  .lb-close{position:absolute; top:14px; right:16px; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:rgba(255,255,255,.14); color:#fff; font-size:28px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:3}
  .lb-arrow{position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px; padding:0; border:0; border-radius:50%; background:rgba(255,255,255,.14); color:#fff; font-size:30px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:3}
  .lb-prev{left:14px} .lb-next{right:14px}
  .lb-close:hover,.lb-arrow:not(:disabled):hover{background:rgba(255,255,255,.26)}
  .lb-arrow:disabled{opacity:.42; cursor:default}

  @media (max-width:560px){
    .wrap{padding:26px 16px 48px}
    .masthead h1{font-size:25px}
    .summary .stat{flex-basis:50%; border-bottom:1px solid var(--line)}
    .shot{width:96px}
    .lb-stage{max-width:84vw}
    .lb-arrow{width:40px; height:40px; font-size:26px}
    .lb-prev{left:2px} .lb-next{right:2px}
  }
  @media print{
    body{background:#fff}
    .card,.summary{break-inside:avoid; box-shadow:none}
    .lightbox{display:none !important}
    details.frames:not([open]) > *{display:block}
  }`;
}

// Accessibility-tab CSS. Appended to the <style> block ONLY when the report has
// accessibility data, so a Performance-only report (no accessibility.json on
// disk) keeps styles() verbatim and stays byte-for-byte identical to before.
function a11yStyles(): string {
  return `
  /* ---- accessibility panel ---- */
  .a11y-card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px 22px 20px; margin:0 0 18px}
  .a11y-card .card-head{align-items:flex-start}
  .a11y-score{flex:none; text-align:center; border-radius:12px; padding:8px 12px; min-width:64px; border:1px solid}
  .a11y-score__num{font-size:26px; font-weight:800; line-height:1}
  .a11y-score__lbl{font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-top:3px; opacity:.8}
  .a11y-score--good{background:var(--good-bg); border-color:#bfe6cd; color:#137a43}
  .a11y-score--fair{background:var(--fair-bg); border-color:#f0d9b8; color:#9a5a12}
  .a11y-score--poor{background:var(--poor-bg); border-color:#f1c7cb; color:#a82f36}
  .a11y-tally{display:flex; flex-wrap:wrap; gap:6px 8px; margin:4px 0 14px}
  .a11y-sev{font-size:13px; font-weight:600; border-radius:7px; padding:4px 10px}
  .a11y-sev--hi{background:var(--poor-bg); color:#a82f36}
  .a11y-sev--mid{background:var(--fair-bg); color:#9a5a12}
  .a11y-sev--lo{background:#eef0f4; color:#5a626d}
  .a11y-summary{font-size:16px; line-height:1.55; color:#2c333c; margin:0 0 16px}
  .a11y-bridge{font-size:15.5px; line-height:1.5; color:#3b434e; margin:-6px 0 18px; padding-left:13px; border-left:3px solid var(--line)}
  .a11y-frames{display:flex; flex-wrap:wrap; gap:14px; margin:0 0 6px}
  .a11y-frame{margin:0; flex:1 1 220px; max-width:300px; cursor:zoom-in; outline:none}
  .a11y-frame:focus-visible .a11y-frame__img{box-shadow:0 0 0 3px var(--accent)}
  .a11y-frame__img{position:relative; line-height:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff}
  .a11y-frame__img img{display:block; width:100%; height:auto}
  .a11y-frame__cap{font-size:12px; color:var(--muted); margin:6px 0 0; text-align:center; font-weight:600}
  /* enlarged a11y crop in the lightbox: these are wide page-details, so give the
     stage more room than the narrow phone frames; bound height so the caption
     stays on screen; the % overlay boxes scale with the image. */
  .lb-stage:has(.a11y-frame__img){max-width:min(860px,94vw)}
  .lb-stage:has(.a11y-frame__img) ~ .lb-cap{max-width:min(860px,94vw)}
  .lb-stage .a11y-frame__img{max-width:100%; margin:0; border-radius:12px}
  .lb-stage .a11y-frame__img img{width:auto; height:auto; max-width:100%; max-height:calc(100vh - 180px); object-fit:contain}
  .a11y-box{position:absolute; border:2px solid; border-radius:3px; box-shadow:0 0 0 1px rgba(255,255,255,.55)}
  .a11y-box--hi{border-color:#dc2626; background:rgba(220,38,38,.20)}
  /* minor: a bright amber-orange, clearly lighter + yellower than the red so the
     two are easy to tell apart while staying visible on light screenshots. */
  .a11y-box--lo{border-color:#f59e0b; background:rgba(245,158,11,.22)}
  .a11y-fixes{margin:16px 0 0}
  .a11y-fixes h3{font-size:14px; font-weight:700; color:var(--ink); margin:0 0 8px}
  .a11y-fixes ul{margin:0; padding-left:20px}
  .a11y-fixes li{font-size:15.5px; line-height:1.5; color:#3b434e; margin:0 0 6px}
  .a11y-key{font-weight:700; padding:1px 7px; border-radius:5px; font-size:12px}
  .a11y-key--hi{background:var(--poor-bg); color:#a82f36}
  .a11y-key--lo{background:rgba(245,158,11,.18); color:#9a5a12}
  .a11y-issues{list-style:none; margin:16px 0 0; padding:0}
  .a11y-issue{display:flex; gap:10px; align-items:flex-start; font-size:15.5px; color:#3b434e;
    padding:9px 0; border-top:1px solid var(--line); line-height:1.45}
  .a11y-issue:first-child{border-top:0}
  .a11y-issue__text b{color:var(--ink); font-weight:600; white-space:nowrap}
  .a11y-dot{flex:none; width:11px; height:11px; border-radius:50%; margin-top:5px}
  .a11y-dot--hi{background:#dc2626} .a11y-dot--lo{background:#d97706}
  .a11y-issue--more{color:var(--muted); font-style:italic; padding-left:21px}
  .a11y-clean{font-size:15px; color:var(--muted); margin:18px 0 0; line-height:1.5}
  .a11y-clean b{color:var(--good); font-weight:600}

  @media print{
    .a11y-card,.a11y-frame{break-inside:avoid}
  }`;
}

// The official ShakaCode mark - red shaka badge + dark-charcoal "ShakaCode"
// wordmark - inlined so the self-contained report makes zero external requests.
// Linked back to shakacode.com at the top of the report (Justin's 2026-06-16 ask).
const SHAKACODE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 206 47" fill="none" role="img" aria-label="ShakaCode"><defs><linearGradient x1="50%" y1="0%" x2="50%" y2="100%" id="b-shaka"><stop stop-color="#F32B05" offset="0%"/><stop stop-color="#B00012" offset="100%"/></linearGradient><linearGradient x1="50%" y1="24.608%" x2="50%" y2="72.622%" id="c-shaka"><stop stop-color="#FF6956" offset=".792%"/><stop stop-color="#FF6956" stop-opacity=".01" offset="96.579%"/></linearGradient><path d="M11.207 0h41.586a2 2 0 011.77 1.069l8.702 16.534a2 2 0 01-.453 2.437L33.317 45.848a2 2 0 01-2.634 0L1.188 20.04a2 2 0 01-.453-2.437L9.438 1.069A2 2 0 0111.207 0z" id="a-shaka"/></defs><g fill="none" fill-rule="evenodd"><text font-family="Montserrat, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#333738"><tspan x="80" y="31">ShakaCode</tspan></text><g><mask id="d-shaka" fill="#fff"><use xlink:href="#a-shaka"/></mask><use fill="url(#b-shaka)" xlink:href="#a-shaka"/><path d="M7 33c22.118-2.144 33.57-6.578 34.354-13.303 1.178-10.088-17.4-1.454-20.927-1 9.658-7.17 22.018-11.721 37.08-13.652H66V47H7V33z" fill="url(#c-shaka)" mask="url(#d-shaka)"/></g></g></svg>`;

const LIGHTBOX_JS = `
<script>
(function(){
  var lb=document.getElementById('lb'), stage=document.getElementById('lbStage'), cap=document.getElementById('lbCap');
  var btnPrev=document.getElementById('lbPrev'), btnNext=document.getElementById('lbNext'), btnClose=document.getElementById('lbClose');
  if(!lb) return;
  var strip=[], idx=-1, opener=null;
  function enabledButtons(){ return [btnClose,btnPrev,btnNext].filter(function(b){return b && !b.disabled;}); }
  function render(){
    var shot=strip[idx]; if(!shot) return;
    var inner=shot.querySelector('.phone, .a11y-frame__img'); // perf frame or a11y crop
    stage.innerHTML=''; if(inner) stage.appendChild(inner.cloneNode(true));
    cap.innerHTML='';
    var role=shot.querySelector('figcaption .phase');
    if(role){ // performance frame: bold role + time + data-detail
      var tEl=shot.querySelector('figcaption .t');
      var time=(tEl&&tEl.textContent)?tEl.textContent:'';
      var detail=(shot.getAttribute('data-detail')||'').replace(/^.*?- /, ''); // drop the leading "Role - " so the caption doesn't repeat the bold role label
      var b=document.createElement('b'); b.textContent=role.textContent||'Frame'; cap.appendChild(b);
      var tail=[time,detail].filter(function(x){return x;}).join(' · ');
      if(tail) cap.appendChild(document.createTextNode(' · '+tail));
    } else { // a11y crop: bold issue summary + spot count / colour key
      var b2=document.createElement('b'); b2.textContent=shot.getAttribute('data-zoom-title')||'Accessibility detail'; cap.appendChild(b2);
      var d2=shot.getAttribute('data-zoom-detail')||'';
      if(d2) cap.appendChild(document.createTextNode(' · '+d2));
    }
    if(btnPrev) btnPrev.disabled=idx<=0;
    if(btnNext) btnNext.disabled=idx>=strip.length-1;
    if(document.activeElement && document.activeElement.disabled && btnClose) btnClose.focus();
  }
  function open(shot){
    var box=shot.closest('.filmstrip, .a11y-frames')||shot.parentNode;
    strip=Array.prototype.slice.call(box.querySelectorAll('.shot, .a11y-frame'));
    idx=strip.indexOf(shot); if(idx<0){ strip=[shot]; idx=0; }
    opener=shot; render(); lb.classList.add('on');
    var sbw=window.innerWidth-document.documentElement.clientWidth;
    document.body.style.overflow='hidden';
    if(sbw>0) document.body.style.paddingRight=sbw+'px';
    if(btnClose) btnClose.focus();
  }
  function close(){
    lb.classList.remove('on'); document.body.style.overflow=''; document.body.style.paddingRight='';
    if(opener && opener.focus) opener.focus(); opener=null;
  }
  function go(d){ var n=idx+d; if(n<0||n>=strip.length) return; idx=n; render(); }
  document.querySelectorAll('.shot, .a11y-frame').forEach(function(s){
    s.addEventListener('click',function(){open(s)});
    s.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();open(s);} });
  });
  if(btnPrev) btnPrev.addEventListener('click',function(e){e.stopPropagation();go(-1)});
  if(btnNext) btnNext.addEventListener('click',function(e){e.stopPropagation();go(1)});
  if(btnClose) btnClose.addEventListener('click',function(e){e.stopPropagation();close()});
  // Close on any click in the backdrop - the dim area, the empty space beside the
  // frame, the caption or hint - but not on the frame image itself or the buttons.
  lb.addEventListener('click',function(e){ var t=e.target; if(t instanceof Element && !t.closest('.phone, .a11y-frame__img, button')) close(); });
  document.addEventListener('keydown',function(e){
    if(!lb.classList.contains('on')) return;
    if(e.key==='Escape'){ e.preventDefault(); close(); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); go(-1); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); go(1); }
    else if(e.key==='Tab'){
      var f=enabledButtons(); if(!f.length) return;
      var first=f[0], last=f[f.length-1], a=document.activeElement;
      if(e.shiftKey){ if(a===first || !lb.contains(a)){ e.preventDefault(); last.focus(); } }
      else { if(a===last || !lb.contains(a)){ e.preventDefault(); first.focus(); } }
    }
  });
})();
</script>`;

// Reveals each on-video caption as the load video's clock reaches its beat. The
// cue times are navigation-relative ms (== video.currentTime*1000), so this is a
// straight "last cue at or before now" lookup, re-run on timeupdate (~4Hz, plenty
// for a short clip) and on play/seek. No caption rides over the pristine poster
// (the finished-page still shown before first play); once playing - including
// every loop back to the blank start - the right beat shows.
const CAPTION_JS = `
<script>
(function(){
  var bands=document.querySelectorAll('.vidcap[data-cues]');
  Array.prototype.forEach.call(bands,function(band){
    var cues;
    try{ cues=JSON.parse(band.getAttribute('data-cues')||'[]'); }catch(e){ return; }
    if(!cues||!cues.length) return;
    var wrap=band.parentNode, video=wrap?wrap.querySelector('video'):null, tx=band.querySelector('.vidcap-tx');
    if(!video||!tx) return;
    var cur=-1;
    function sync(){
      // Pristine poster state (never played, or scrubbed back to the very start
      // while paused): keep the finished-page poster caption-free.
      if(video.paused && video.currentTime===0){ if(cur!==-1){ cur=-1; band.classList.remove('show'); } return; }
      var ms=video.currentTime*1000, i=0;
      for(var k=0;k<cues.length;k++){ if(cues[k].t<=ms) i=k; else break; }
      if(i===cur) return;
      cur=i; tx.textContent=cues[i].x; band.classList.add('show');
    }
    video.addEventListener('timeupdate',sync);
    video.addEventListener('play',sync);
    video.addEventListener('seeking',sync);
    video.addEventListener('pause',sync);
  });
})();
</script>`;

export interface ClientReportResult {
  html: string;
  pageCount: number;
}

// The audited site's own favicon, inlined so the hosted report's browser tab
// shows the client's logo instead of a blank icon. Self-contained by design:
// the bytes are embedded at render time, nothing is fetched when the report
// opens. Best-effort - any failure falls back to a blank icon.

const FAVICON_MAX_BYTES = 512 * 1024;

// Pure: fetched favicon bytes + content-type -> an inline data URI, or null
// when unusable. Guards an empty body and an absurdly large file (it inlines
// into the HTML, so cap it). The content-type is attacker-controlled (it comes
// from the audited site), so only a clean `image/<subtype>` token is accepted -
// anything with a quote, angle bracket, or space could otherwise break out of
// the href attribute faviconLinkTag puts it in.
export function faviconDataUri(bytes: Uint8Array, contentType: string | null): string | null {
  if (bytes.length === 0 || bytes.length > FAVICON_MAX_BYTES) return null;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const mime = /^image\/[a-z0-9.+-]+$/.test(type) ? type : 'image/x-icon';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

// Pure: the report head's icon link. The inlined favicon when we have one, else
// a blank icon that suppresses the browser's default /favicon.ico request.
// esc() is defense-in-depth: faviconDataUri already constrains the MIME and
// base64 has no HTML-special chars, but the href is attacker-influenced so we
// escape at the boundary like every other attribute in this file.
export function faviconLinkTag(faviconUri: string | null): string {
  return `<link rel="icon" href="${esc(faviconUri ?? 'data:,')}" />`;
}

// Pure: reject hosts that point at the machine itself or a private network -
// the obvious SSRF targets (loopback, RFC1918, CGNAT, link-local incl. the
// 169.254.169.254 cloud-metadata endpoint) - when an audited site redirects its
// favicon, or declares an icon URL, at an internal address. IP-literal only; a
// hostname that DNS-resolves to a private IP is out of scope for a cosmetic
// favicon fetch on a dev/CI box.
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h.includes(':')) {
    // IPv6 literal: loopback ::1, unique-local fc00::/7, link-local fe80::/10.
    return !(h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h));
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

// Pure: the favicon href a homepage declares, or null. Bounded input + a
// de-nested tag scan (no adjacent unbounded quantifiers) so a hostile body
// cannot cause catastrophic backtracking, and it requires the bare `icon` rel
// token so `apple-touch-icon` / `mask-icon` (an oversized iOS PNG or a flat
// mask SVG) are not mistaken for the tab favicon.
export function parseIconHref(html: string): string | null {
  for (const tag of html.slice(0, 200_000).match(/<link\b[^>]{0,2000}>/gi) ?? []) {
    const rel = tag.match(/\brel=["']([^"']*)["']/i)?.[1]?.toLowerCase();
    if (!rel || !rel.split(/\s+/).includes('icon')) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

// Fetch the audited site's favicon. Tries the conventional /favicon.ico, then
// the homepage's declared <link rel=icon> (SPAs often ship only PNG). Each
// request is bounded by an 8s timeout that COVERS the body read, streamed with
// a hard 512KB cap, and refuses any URL (or redirect hop) that resolves to a
// non-public host. Returns null on any failure - the report falls back to the
// blank icon.
async function fetchSiteFavicon(siteUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }
  // One bounded fetch: validates scheme + host up front, reads the body under
  // the same timeout, and aborts the moment the stream exceeds the cap. Returns
  // the final (post-redirect) URL so a relative icon href resolves correctly.
  const fetchBounded = async (
    url: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string } | null> => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return null;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (!isPublicHost(target.hostname)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (shaka-perf client-report favicon)' },
      });
      // A redirect can land on an internal host even when the start URL was
      // public - re-check the final hop before reading anything back.
      if (!res.ok || !isPublicHost(new URL(res.url).hostname)) return null;
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > FAVICON_MAX_BYTES) return null;
      const reader = res.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > FAVICON_MAX_BYTES) {
          ctl.abort();
          return null;
        }
        chunks.push(value);
      }
      if (total === 0) return null;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return { bytes, contentType: res.headers.get('content-type'), finalUrl: res.url };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  // 1) The conventional location - works for most sites (both live clients).
  const ico = await fetchBounded(`${origin}/favicon.ico`);
  if (ico) {
    const uri = faviconDataUri(ico.bytes, ico.contentType);
    if (uri) return uri;
  }
  // 2) Fall back to the homepage's declared icon link.
  const page = await fetchBounded(origin);
  if (page) {
    const href = parseIconHref(new TextDecoder().decode(page.bytes));
    if (href) {
      let iconUrl: string;
      try {
        iconUrl = new URL(href, page.finalUrl).href;
      } catch {
        return null;
      }
      const icon = await fetchBounded(iconUrl);
      if (icon) return faviconDataUri(icon.bytes, icon.contentType);
    }
  }
  return null;
}

// One on-video caption track handed to the optional AI rewriter: the page it
// belongs to, the problem the card leads with (context for tone), and the
// ordered cues with their deterministic phrasing + the second they fire.
export interface CaptionRefineRequest {
  pageName: string;
  problem: string;
  cues: { kind: string; atSec: string; text: string }[];
}

// Rewrites caption phrasing without touching the timing or beat order. Result
// index i aligns to request i; each inner array must align 1:1 to that page's
// cues (a null inner array, a length mismatch, or a null overall result all
// leave the deterministic captions untouched - the caller enforces this).
export type CaptionRefiner = (reqs: CaptionRefineRequest[]) => Promise<(string[] | null)[] | null>;

// One page's issues for the summary pass: score (tone) + distinct violations, worst first.
export interface A11ySummaryRequest {
  pageName: string;
  path: string;
  score?: number;
  counts: ImpactCounts;
  issues: { impact: AccessibilityViolation['impact']; help: string; places: number }[];
}
// The client-language rewrite of one page's findings.
export interface A11ySummary {
  summary: string;
  fixes: string[];
}
// Per-page summaries aligned to the request order (null = fall back) + optional site summary.
export interface A11ySummaryResult {
  pages: (A11ySummary | null)[];
  site: string | null;
}
export type A11ySummarizer = (reqs: A11ySummaryRequest[]) => Promise<A11ySummaryResult | null>;

export interface RenderClientReportOptions {
  // When set, an AI pass that rewrites the on-video caption phrasing. Omitted by
  // default so the renderer stays dependency-free (and tests never spawn it);
  // the CLI wires in the `claude`-backed one unless --no-ai-captions is passed.
  refineCaptions?: CaptionRefiner;
  // AI pass that writes plain-language a11y summaries/fixes to the sidecars. Off
  // by default (tests never spawn it); the CLI wires it unless --no-ai-a11y. Cached.
  summarizeA11y?: A11ySummarizer;
  // AI pass that writes plain-language Agent Ready summaries/fixes to the sidecars.
  // Off by default (tests never spawn it); the CLI wires it unless --no-ai-agent. Cached.
  summarizeAgent?: AgentSummarizer;
  // Which visual design to render. 'v2' (the product-owner-first redesign) is the
  // default; 'v1' is the original mobile-speed-led report, reached via `--design v1`.
  // v1 output is byte-for-byte unchanged when this is 'v1' or unset-at-call (the
  // CLI defaults it to 'v2'); see ./client-report-v2.ts.
  design?: 'v1' | 'v2';
  // Optional AI pass (v2 only) that rewrites the narrative copy - the bottom line
  // and each tab's verdict. Off by default (tests never spawn it); the CLI wires
  // the claude-backed one unless --no-ai-narrative. Best-effort + cached: a missing
  // /slow/failed claude leaves the built-in deterministic verdict copy in place.
  narrate?: NarrativeSummarizer;
}

export async function renderClientReport(
  resultsDir: string,
  opts: RenderClientReportOptions = {},
): Promise<ClientReportResult> {
  const sc: SiteScorecard = synthesizeSite(resultsDir);
  const domain = (sc.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

  const rendered: RenderedPage[] = [];
  for (const page of sc.pages) {
    const lcpMs = metricVal(page, 'LCP');
    const { lead, rest } = detectProblems(page);
    // Frames are read (cheap JSON) for every page - the masthead counts them -
    // but encoded into shots only for the detailed pages, after sorting.
    const frames = readFrames(resultsDir, page.id);
    rendered.push({
      page,
      lcpMs,
      status: lead.status,
      lead,
      rest,
      frames,
      shots: [],
      totalFrames: frames.length,
      windowMs: windowEndMs(frames, lcpMs, metricVal(page, 'FCP')),
    });
  }
  // Homepage first - it's the page the owner cares about most and the strongest
  // hook - then worst-problem-first for the rest.
  rendered.sort((a, b) => {
    const ah = a.page.startingPath === '/' ? 1 : 0;
    const bh = b.page.startingPath === '/' ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return b.lead.severity - a.lead.severity;
  });

  // Pages whose audit failed are listed but never counted as "loaded" or
  // averaged - the masthead must not claim measurements that did not happen.
  const measured = rendered.filter((r) => r.lead.kind !== 'no-data');
  const slowCount = rendered.filter((r) => (r.lcpMs ?? 0) > LCP_WAIT_MS).length;
  // Same line the cards use (a card says "jumps around" from CLS_GOOD up) - a
  // client can count the cards, so the masthead stat must agree with them.
  const jumpyCount = rendered.filter((r) => (metricVal(r.page, 'CLS') ?? 0) > CLS_GOOD).length;
  const avgMs = sc.lcpMs ? sc.lcpMs.avg : undefined;
  const avgLabel = avgMs !== undefined ? secs(avgMs) : 'n/a';
  const avgStatus = lcpStatus(avgMs);
  // No LCP anywhere = nothing honest to say about the typical wait; drop the
  // sentence rather than interpolate a literal "about n/a".
  const framing = avgMs !== undefined
    ? `In plain terms, a visitor on a phone waits about ${avgLabel} before the typical page here is usable${jumpyCount > 0 ? `, and ${jumpyCount} of your pages visibly jump around under their thumb while loading` : ''}.`
    : '';

  const totalFramesAll = rendered.reduce((n, r) => n + r.totalFrames, 0);
  // Fill the detailed slots skipping near-duplicate stories (same path, same
  // lead, LCP within noise - e.g. a scroll-variant of the homepage); the
  // skipped ones stay in the compact list, in the same overall order.
  const storyKey = (rp: RenderedPage): StoryKey => ({
    startingPath: rp.page.startingPath,
    leadKind: rp.lead.kind,
    ...(rp.lcpMs !== undefined ? { lcpMs: rp.lcpMs } : {}),
  });
  const detailed: RenderedPage[] = [];
  const more: RenderedPage[] = [];
  for (const rp of rendered) {
    // An unmeasured page never spends a detailed slot - its whole story is one line.
    if (rp.lead.kind !== 'no-data' && detailed.length < DETAIL_PAGES && !detailed.some((d) => isDuplicateStory(storyKey(d), storyKey(rp)))) {
      detailed.push(rp);
    } else {
      more.push(rp);
    }
  }
  // Build the filmstrip + load video only for the pages shown in full (so a
  // 54-page site does not AVIF-encode strips the compact list never renders,
  // nor spawn 54 ffmpeg runs). Sequential - each is fast and we avoid a spawn
  // storm.
  for (const rp of detailed) {
    // A layout-shift story anywhere on the card (lead OR an "also" chip) earns
    // the dense strip: the jump frames are the evidence even when a slow load
    // outranks them for the headline.
    const hasShiftStory = rp.lead.kind === 'layout-shift' || rp.rest.some((p) => p.kind === 'layout-shift');
    rp.shots = await buildShots(resultsDir, rp.page, rp.frames, hasShiftStory);
    const video = await buildVideo(resultsDir, rp.page.id, rp.windowMs);
    rp.videoUri = video?.uri;
    rp.videoCoveredSec = video?.coveredSec;
    // On-video captions only make sense when there's a video to sync them to.
    if (rp.videoUri) {
      // Cap cues at the clip's REAL length, not just the window. buildVideo
      // hard-clamps the clip to 60s (and to the source screencast length), so on
      // a 60s+ page a cue placed at the 62s LCP would sit past the end of the
      // clip and never fire. videoCoveredSec is that real length when ffmpeg
      // reported the source duration; fall back to the 60s ceiling otherwise.
      const clipMs = Math.min(rp.windowMs, (rp.videoCoveredSec ?? 60) * 1000);
      rp.captionCues = buildCaptionCues(rp.frames, rp.lcpMs, metricVal(rp.page, 'FCP'), clipMs);
    }
  }

  // One optional AI pass rewrites the deterministic caption phrasing into
  // natural, page-specific narration (Justin's "have an AI add the captions").
  // Batched across every page so it is a single `claude` call; the timings and
  // beat order are fixed here and never touched by the model. Entirely
  // best-effort: a missing `claude` CLI, a timeout, or unparseable output all
  // leave the deterministic captions in place (handled inside refineCaptions).
  if (opts.refineCaptions) {
    const targets = detailed.filter((d) => d.captionCues && d.captionCues.length > 0);
    if (targets.length > 0) {
      const refined = await opts.refineCaptions(
        targets.map((d) => ({
          pageName: d.page.name,
          problem: stripTags(d.lead.headline),
          cues: d.captionCues!.map((c) => ({ kind: c.kind, atSec: secs(c.atMs), text: c.text })),
        })),
      );
      if (refined) {
        targets.forEach((d, i) => {
          const texts = refined[i];
          if (!texts || texts.length !== d.captionCues!.length) return; // shape mismatch: keep deterministic
          d.captionCues = d.captionCues!.map((c, j) => {
            const t = texts[j]?.trim();
            return t ? { ...c, text: dashSafe(t) } : c;
          });
        });
      }
    }
  }
  // Frameless audits (legacy runs) have no strips to read or tap - every piece
  // of frame-by-frame copy must disappear with them, or the report opens with
  // "recorded each one frame by frame - 0 frames in all" and instructions to
  // tap frames that do not exist.
  const anyShots = detailed.some((d) => d.shots.length > 0);

  // v2 (default) reuses the artifacts gathered above; v1 (below) is byte-unchanged.
  const design = opts.design ?? 'v2';
  if (design === 'v2') {
    const model = await buildClientReportV2Model(
      resultsDir,
      sc,
      domain,
      { detailed, more, measured, totalFramesAll, avgMs, avgLabel, avgStatus, slowCount, jumpyCount },
      opts,
    );
    return { html: renderClientReportV2(model), pageCount: rendered.length };
  }

  const cards = detailed.map((rp, i) => pageCardHtml(rp, sc.url, i === 0)).join('\n');
  const moreHtml = more.length ? moreSectionHtml(more, sc.url) : '';

  const dateStr = sc.generatedAt
    ? new Date(sc.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const faviconUri = await fetchSiteFavicon(sc.url);

  // Accessibility tab. Built from the per-page accessibility.json the audit's
  // axe stage wrote (loaded onto page.a11y by synthesizeSite). When NO page has
  // a11y data (audits predating the stage, or runs that skipped it) hasA11y is
  // false and every inserted expression below is '' - the emitted bytes are then
  // identical to the Performance-only report, so existing reports are untouched.
  // Write the AI summaries to the sidecars before the readers below pick them up.
  if (opts.summarizeA11y) {
    await enrichA11ySummaries(resultsDir, sc.pages, opts.summarizeA11y);
  }
  const a11yViews = buildA11yPages(sc.pages, resultsDir);
  const a11ySiteSummary = readA11ySiteSummary(resultsDir);
  const cleanPaths = sc.pages
    .filter(pageHasCleanA11y)
    .map((p) => p.startingPath || '/');
  const hasA11y = a11yViews.length > 0;
  // Badge counts only surfaced (carded) issues, so it matches the cards the reader sees.
  const a11ySurfacedIssues = a11yViews
    .filter((v) => hasMajorA11yBarrier(v.counts))
    .reduce((n, v) => n + totalIssues(v.counts), 0);

  // Agent Ready tab. Built from the per-page agent-readiness.json the audit's
  // agent-readiness stage wrote (loaded onto page.agentReady by synthesizeSite).
  // Same byte-stability rule as Accessibility: when NO page has agent data every
  // inserted expression below is '' and the report is unchanged.
  let hasAgent = hasAgentData(sc.pages);
  let agentPanel = '';
  let agentPill = '';
  if (hasAgent) {
    // A side lens must never sink the whole report: any failure here (a corrupt
    // agent-readiness.json that slipped the synthesis guard, a render error)
    // drops just the Agent Ready tab, leaving Performance + Accessibility intact.
    try {
      let agentViews: AgentPageView[] = buildAgentPages(sc.pages, resultsDir);
      // robots.txt / sitemap / llms.txt, fetched once from the live origin (the same
      // bounded, best-effort pattern as the favicon fetch above).
      const agentSite: SiteAccessSignals | undefined = await fetchSiteAccessSignals(sc.url);
      if (opts.summarizeAgent) {
        await enrichAgentSummaries(resultsDir, agentViews, agentSite, opts.summarizeAgent);
        agentViews = buildAgentPages(sc.pages, resultsDir); // re-read the sidecars the enrich just wrote
      }
      const agentSiteSummary = readAgentSiteSummary(resultsDir);
      agentPanel = `${await agentPanelHtml(agentViews, agentSite, agentSiteSummary)}\n`;
      agentPill = agentTabPill(agentViews, agentSite);
    } catch (err) {
      console.warn(chalk.yellow(`shaka-perf: the Agent Ready tab failed to render, omitting it: ${(err as Error).message}`));
      hasAgent = false;
      agentPanel = '';
      agentPill = '';
    }
  }

  const hasExtra = hasA11y || hasAgent;
  const tabBar = hasExtra
    ? `${tabBarHtml({ ...(hasA11y ? { a11yIssues: a11ySurfacedIssues } : {}), ...(hasAgent ? { agentPill } : {}) })}\n\n`
    : '';
  const perfPanelOpen = hasExtra ? `  <div class="tab-panel" id="perf-panel" role="tabpanel" aria-labelledby="tab-perf">\n` : '';
  const perfPanelClose = hasExtra ? `  </div>\n` : '';
  const a11yPanel = hasA11y ? `${await a11yPanelHtml(a11yViews, cleanPaths, a11ySiteSummary)}\n` : '';
  const tabScript = hasExtra ? TAB_JS : '';
  const extraStyles = `${hasExtra ? tabStyles() : ''}${hasA11y ? a11yStyles() : ''}${hasAgent ? agentStyles() : ''}`;

  const thirdStat =
    jumpyCount > 0
      ? `<div class="stat"><div class="num poor">${jumpyCount}</div><div class="lbl">pages that jump around</div></div>`
      : `<div class="stat"><div class="num ${slowCount > 0 ? 'poor' : 'good'}">${slowCount}</div><div class="lbl">pages a visitor waits on</div></div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
${faviconLinkTag(faviconUri)}
<title>Mobile speed report - ${esc(domain)}</title>
<style>${styles()}${extraStyles}</style>
</head>
<body>
<main class="wrap">
  <div class="masthead">
    <a class="brand" href="https://www.shakacode.com" target="_blank" rel="noopener" aria-label="ShakaCode - shakacode.com">${SHAKACODE_LOGO}</a>
    <p class="kicker">Mobile speed report${dateStr ? ` &middot; ${esc(dateStr)}` : ''}</p>
    <h1>How <span class="site">${esc(domain)}</span> loads on a phone</h1>
    <p class="lede">We loaded ${measured.length} of your pages on a typical phone over a normal cellular connection${totalFramesAll > 0 ? ` and recorded each one frame by frame - ${totalFramesAll.toLocaleString('en-US')} frames in all` : ''}. On a fast desktop these pages feel fine, which is exactly why what is below is easy to miss.</p>
    ${dateStr ? `<p class="captured">Captured <b>${esc(dateStr)}</b> - a snapshot of the live site that day. If the site has changed since, this report may no longer reflect it.</p>` : ''}
  </div>

${tabBar}${perfPanelOpen}  <div class="summary">
    <div class="stat"><div class="num">${measured.length}</div><div class="lbl">pages checked</div></div>
    <div class="stat"><div class="num ${avgStatus}">${esc(avgLabel)}</div><div class="lbl">average wait for the biggest piece</div></div>
    ${thirdStat}
  </div>
${framing ? `  <p class="summary-note">${esc(framing)}</p>\n` : ''}
${anyShots ? `  <p class="howto"><b>How to read this.</b> Each strip is one of your pages loading on a phone, left to right in real time. We pulled the moments that matter out of every frame we captured. <b>Tap any frame to enlarge it.</b></p>\n` : ''}
${cards}
${moreHtml}

  <p class="foot">
    <span class="by">Measured ${dateStr ? `on ${esc(dateStr)} ` : ''}on an emulated mid-range phone over the Slow-4G throttling profile Google PageSpeed uses - the conditions a real mobile visitor faces, not a developer's fast laptop. "Speed score" is the same 0-100 scale Google PageSpeed uses for mobile (90 and up is fast, under 50 is slow); "layout-shift score" is Google's CLS, where anything above 0.25 is poor.</span><br/>
    Put together by ShakaCode.
  </p>
${perfPanelClose}${a11yPanel}${agentPanel}</main>

<div class="lightbox" id="lb" role="dialog" aria-modal="true" aria-labelledby="lbCap">
  <button class="lb-close" id="lbClose" type="button" aria-label="Close">&times;</button>
  <button class="lb-arrow lb-prev" id="lbPrev" type="button" aria-label="Previous frame">&#8249;</button>
  <button class="lb-arrow lb-next" id="lbNext" type="button" aria-label="Next frame">&#8250;</button>
  <div class="lb-stage" id="lbStage"></div>
  <div class="lb-cap" id="lbCap"></div>
  <div class="lb-hint">Tap &times; to close &middot; &#8249; &#8250; for previous / next</div>
</div>
${LIGHTBOX_JS}
${CAPTION_JS}${tabScript}
</body>
</html>
`;
  return { html, pageCount: rendered.length };
}

// ---- Client report DESIGN v2: model assembly ----
// Maps the gathered artifacts onto the `ClientReportV2Model` the v2 renderer takes.
// All async/IO (a11y crops, agent fetch, AI passes) is here; the renderer is pure.

const PROBLEM_KINDS: ReadonlySet<ProblemKind> = new Set<ProblemKind>(['slow-lcp', 'layout-shift', 'blank', 'late-paint', 'sluggish']);

// Plain-language names for the three per-page agent factors (the design renames
// the internal category names into owner-friendly phrasing).
const AGENT_FACTOR_NAME: Record<string, string> = {
  ssr: 'Readable without running code',
  structure: 'Labeled so AI knows what it is',
  semantics: 'Clear structure & enough text',
};

const NARRATIVE_V2_FILENAME = 'client-narrative-v2.json';

// Cache stores the AI OVERLAY (plain text), not the composed narrative, so every
// render recomposes from current facts: a newly-present tab gets fresh copy, and
// the bottom-line HTML is re-escaped here (never trusted raw). Bad file -> null.
function readNarrativeOverlay(resultsDir: string): NarrativeOverlay | null {
  const p = path.join(resultsDir, NARRATIVE_V2_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return parseNarrativeResponse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeNarrativeOverlay(resultsDir: string, overlay: NarrativeOverlay): void {
  try {
    fs.writeFileSync(path.join(resultsDir, NARRATIVE_V2_FILENAME), `${JSON.stringify(overlay, null, 2)}\n`);
  } catch {
    /* a polish artifact must never fail the report */
  }
}

function liveUrlFor(siteUrl: string, startingPath: string): string | undefined {
  return siteUrl && startingPath ? `${siteUrl.replace(/\/$/, '')}${startingPath}` : undefined;
}

function perfCardModel(rp: RenderedPage, siteUrl: string): V2PerfCard {
  const { page, status, lead } = rp;
  const score = metricVal(page, 'LH Score');
  const clsV = metricVal(page, 'CLS');
  const beforeLcpKb = metricVal(page, 'downloads-before-LCP');
  const totalKb = metricVal(page, 'downloads');

  const frames: V2Frame[] = rp.shots.map((s) => {
    // Beat precedence mirrors v1's shotHtml: biggest piece (LCP) > layout jump > first content.
    const beat: V2Frame['beat'] = s.isLcp ? 'lcp' : s.shiftValue > 0 ? 'shift' : s.isFcp ? 'first-content' : undefined;
    const fr: V2Frame = {
      key: s.isLcp || s.shiftValue > 0,
      blank: s.role === 'Blank',
      label: s.role,
      detail: s.detail,
      time: s.timeLabel,
      imgUri: s.dataUri,
      boxes: s.boxes.map((b) => ({
        left: `${b.left.toFixed(2)}%`,
        top: `${b.top.toFixed(2)}%`,
        width: `${b.width.toFixed(2)}%`,
        height: `${b.height.toFixed(2)}%`,
      })),
    };
    if (beat) fr.beat = beat;
    return fr;
  });

  const facts: V2PerfCard['facts'] = [];
  if (beforeLcpKb !== undefined) facts.push({ val: mb(beforeLcpKb), label: 'downloaded first', status });
  else if (totalKb !== undefined) facts.push({ val: mb(totalKb), label: 'page weight', status });
  if (score !== undefined) facts.push({ val: `${Math.round(score)}/100`, label: 'speed score', status: scoreStatus(score) });
  if (clsV !== undefined && clsV > CLS_GOOD) facts.push({ val: (clsV / 100).toFixed(2), label: 'layout-shift score', status: clsStatus(clsV) });

  const poster = (rp.shots.find((s) => s.isLcp) ?? rp.shots[rp.shots.length - 1])?.dataUri;
  const card: V2PerfCard = {
    name: page.name,
    path: page.startingPath,
    status,
    headlineHtml: lead.headline,
    videoCap: videoCaption(lead.kind, rp.lcpMs, rp.videoCoveredSec),
    frames,
    totalFrames: rp.totalFrames,
    facts,
  };
  const liveUrl = liveUrlFor(siteUrl, page.startingPath);
  if (liveUrl) card.liveUrl = liveUrl;
  if (lead.note) card.sub = lead.note;
  if (rp.videoUri) card.videoUri = rp.videoUri;
  if (poster) card.posterUri = poster;
  if (rp.captionCues && rp.captionCues.length) card.cues = rp.captionCues.map((c) => ({ t: Math.round(c.atMs), x: c.text }));
  if (page.summary) card.plain = dashSafe(page.summary);
  return card;
}

// Plain "what to change" fallback when no AI a11y rewrite exists: the distinct
// issue labels worst-first (the same client-language labels the crops use).
function a11yFallbackFixes(scan: AccessibilityScan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of sortViolations(scan.violations)) {
    const label = a11yIssueLabel(v.ruleId);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label.charAt(0).toUpperCase() + label.slice(1));
    if (out.length >= 3) break;
  }
  return out;
}

function a11ySevChips(counts: ImpactCounts): V2A11yCard['sev'] {
  const hi = counts.critical + counts.serious;
  const chips: V2A11yCard['sev'] = [];
  if (hi > 0) chips.push({ num: hi, label: 'high-impact', status: 'poor' });
  if (counts.moderate > 0) chips.push({ num: counts.moderate, label: 'moderate', status: 'fair' });
  if (counts.minor > 0) chips.push({ num: counts.minor, label: 'low', status: 'good' });
  return chips;
}

const A11Y_STRUCTURAL_CAPTION = 'No spot is highlighted because this problem lives in how the whole page is built, not in one place you can see on the screen.';
const A11Y_WHOLEPAGE_CAPTION = 'Showing the full page; the flagged issues are listed below.';

// When a page has no crop frames, show the whole page so the card still has a
// visual. The caller picks the caption (structural vs generic).
async function a11yWholePageFrame(scan: AccessibilityScan, caption: string): Promise<V2A11yCard['frames'][number] | null> {
  const shot = scan.screenshot;
  const source = shot?.imageDataUri;
  if (!shot || !source) return null;
  const m = /^data:[^;]*;base64,(.+)$/.exec(source);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], 'base64');
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? shot.width;
    const h = meta.height ?? shot.height;
    let img = sharp(buf);
    const maxH = Math.round(w * 2.2); // a very tall page -> show the top, near phone aspect
    if (h > maxH) img = img.extract({ left: 0, top: 0, width: w, height: maxH });
    const out = await img.resize({ width: Math.min(w, 480), withoutEnlargement: true }).avif({ quality: 50 }).toBuffer();
    return { imgUri: `data:image/avif;base64,${out.toString('base64')}`, boxes: [], cap: caption, count: 0 };
  } catch {
    return null;
  }
}

// A plain imperative fix clause ("it" = the page) that weaves in who it helps.
function a11yFixClause(ruleId: string): string {
  if (ruleId === 'meta-refresh') return 'stop it from reloading on its own so screen reader and keyboard visitors are not thrown back to the top';
  if (ruleId === 'color-contrast') return 'raise its text contrast so low-vision visitors can read it';
  if (ruleId.startsWith('landmark') || ruleId === 'region') return 'label its page areas clearly so screen reader visitors can reach the main content and tell sections apart';
  if (ruleId.startsWith('heading') || ruleId === 'page-has-heading-one' || ruleId === 'empty-heading') return 'fix its heading order so screen reader visitors can move through it';
  if (ruleId === 'image-alt' || ruleId === 'svg-img-alt' || ruleId === 'input-image-alt') return 'add text descriptions to its images so screen reader visitors know what they show';
  if (ruleId === 'button-name' || ruleId === 'link-name' || ruleId === 'label' || ruleId === 'select-name' || ruleId === 'aria-input-field-name' || ruleId.startsWith('aria-')) return 'label its controls clearly so screen reader visitors know what they do';
  return 'fix its accessibility barriers so screen reader and keyboard visitors can use it';
}

// "Start here" as one plain sentence (not the "Page (label)" list the other tabs
// use). `allSameFix` gates the "same fix" rollup so it is only claimed when the
// other pages share the worst page's top fix.
function a11yStartHereLead(worst: A11yPageView, otherPages: number, allSameFix: boolean): string {
  const top = sortViolations(worst.scan.violations)[0];
  const clause = a11yFixClause(top ? top.ruleId : '');
  const name = worst.page.name.replace(/[\s:.,;-]+$/, ''); // page names are <title>s; trim trailing punctuation
  let rest = '';
  if (otherPages > 0) {
    rest = allSameFix
      ? ` The other ${otherPages} ${otherPages === 1 ? 'page needs' : 'pages need'} the same fix.`
      : ` The other ${otherPages} ${otherPages === 1 ? 'page has' : 'pages have'} their own barriers; see the cards below.`;
  }
  return `Start with your worst-affected page (${name}): ${clause}.${rest}`;
}

async function a11yCardModel(view: A11yPageView): Promise<V2A11yCard> {
  const { page, scan, counts, client } = view;
  const crops = await a11yCropFrames(scan, true);
  const score = client?.score;
  const status: V2Status = typeof score === 'number' ? scoreBucket(score) : 'poor';
  const topLabel = sortViolations(scan.violations)[0] ? a11yIssueLabel(sortViolations(scan.violations)[0].ruleId) : '';
  const hi = counts.critical + counts.serious;
  const summary = client?.summary
    ? dashSafe(client.summary)
    : `${hi} high-impact issue${hi === 1 ? '' : 's'} on this page${topLabel ? `, mainly ${topLabel}` : ''}.`;
  let frames: V2A11yCard['frames'] = crops.map((f) => ({
    imgUri: f.dataUri,
    boxes: f.boxes.map((b) => ({ left: b.left, top: b.top, width: b.width, height: b.height, hi: b.hi, level: b.level })),
    cap: f.summary,
    count: f.count,
  }));
  if (frames.length === 0) {
    // The structural caption only holds when nothing was boxable; crops can also
    // be empty for technical reasons (e.g. a too-tall page), so use a neutral
    // caption then.
    const hasBoxable = scan.violations.some((v) => !isStructuralA11yRule(v.ruleId) && (v.nodes ?? []).some((n) => n.bounds != null));
    const caption = hasBoxable ? A11Y_WHOLEPAGE_CAPTION : A11Y_STRUCTURAL_CAPTION;
    // Show the a11y stage's own screenshot - the exact frame the violations were
    // detected on. If it is a reload / bot-challenge interstitial, that IS what we
    // measured and must be shown, not a cleaner perf-timeline frame.
    const whole = await a11yWholePageFrame(scan, caption);
    if (whole) frames = [whole];
  }
  const card: V2A11yCard = {
    name: page.name,
    path: page.startingPath || '/',
    status,
    sev: a11ySevChips(counts),
    summary,
    frames,
    fixes: client?.fixes?.length ? client.fixes.map(dashSafe) : a11yFallbackFixes(scan),
  };
  if (typeof score === 'number') card.score = score;
  return card;
}

function agentFactor(cat: CategoryScore): { name: string; score: number; status: V2Status } {
  const frac = cat.max > 0 ? cat.points / cat.max : 1;
  const status: V2Status = frac >= 0.8 ? 'good' : frac >= 0.5 ? 'fair' : 'poor';
  return { name: AGENT_FACTOR_NAME[cat.id] ?? cat.name, score: Math.round(frac * 100), status };
}

function agentCardModel(view: AgentPageView): V2AgentCard {
  const { page, struct } = view;
  const lead = agentPageLead(view);
  const fixes = view.client?.fixes?.length
    ? view.client.fixes.map(dashSafe)
    : Array.from(new Set(agentPageFindings(struct).map((f) => f.action).filter((a): a is string => !!a))).slice(0, 3).map(dashSafe);
  const card: V2AgentCard = {
    name: page.name,
    path: page.startingPath || '/',
    score: struct.score,
    status: struct.bucket,
    capped: struct.shellCapped,
    headlineHtml: lead.headline,
    factors: struct.categories.map(agentFactor),
    fixes,
  };
  if (lead.note) card.sub = lead.note;
  return card;
}

const MAX_START_HERE_ITEMS = 2; // "the main problem, or a unique pair"

// A "Start here" priority list of the DISTINCT problems (deduped by `key`), each
// shown on one representative page, worst-first, capped at a pair - then a single
// line rolls up the rest. A page whose issue we already showed is "the same"; a
// page with an issue we did NOT show (beyond the cap) is a genuinely DIFFERENT
// problem and must never be called "similar".
export function buildStartHere(
  entries: { page: string; issue: string; key: string }[],
  fineCount: number,
  sameNoun: string,
  otherNoun: string,
  fineClause: (n: number) => string,
): V2StartHere | undefined {
  if (entries.length === 0) return undefined;
  const items: { page: string; issue: string }[] = [];
  const shownKeys = new Set<string>();
  for (const e of entries) {
    if (!shownKeys.has(e.key) && items.length < MAX_START_HERE_ITEMS) {
      shownKeys.add(e.key);
      items.push({ page: e.page, issue: e.issue });
    }
  }
  const shownPages = new Set(items.map((i) => i.page));
  let same = 0;
  let other = 0;
  for (const e of entries) {
    if (shownPages.has(e.page)) continue;
    if (shownKeys.has(e.key)) same++;
    else other++;
  }
  const parts: string[] = [];
  if (same > 0) parts.push(`${same} more ${same === 1 ? 'page has' : 'pages have'} ${sameNoun}`);
  if (other > 0) parts.push(`${other} more ${other === 1 ? 'page has' : 'pages have'} ${otherNoun}`);
  if (fineCount > 0) parts.push(fineClause(fineCount));
  const sh: V2StartHere = { items };
  if (parts.length) sh.rest = `${parts.join('; ')}.`;
  return sh;
}

export function perfProblemPhrase(lead: Problem, page: PagePerf): string | undefined {
  switch (lead.kind) {
    case 'slow-lcp': {
      const lcp = metricVal(page, 'LCP');
      return lcp === undefined ? undefined : `biggest piece appears after ${secs(lcp)}`;
    }
    case 'layout-shift':
      return 'the layout jumps around';
    case 'blank': {
      const fcp = metricVal(page, 'FCP');
      return fcp === undefined ? undefined : `screen stays blank for ${secs(fcp)}`;
    }
    case 'late-paint': {
      const fcp = metricVal(page, 'FCP');
      return fcp === undefined ? undefined : `nothing appears for ${secs(fcp)}`;
    }
    case 'sluggish':
      return 'slow to react to taps';
    default:
      return undefined;
  }
}

function perfProblemVerdict(lead: Problem): string | undefined {
  switch (lead.kind) {
    case 'slow-lcp':
      return 'Main content is late';
    case 'layout-shift':
      return 'Jumpy on phones';
    case 'blank':
      return 'Blank screen first';
    case 'late-paint':
      return 'Slow to start';
    case 'sluggish':
      return 'Slow to react';
    default:
      return undefined;
  }
}

function perfProblemKicker(lead: Problem): string | undefined {
  switch (lead.kind) {
    case 'slow-lcp':
    case 'blank':
    case 'late-paint':
      return 'Mobile loading';
    case 'layout-shift':
      return 'Mobile stability';
    case 'sluggish':
      return 'Mobile response';
    default:
      return undefined;
  }
}

function perfProblemMetricSub(lead: Problem): string | undefined {
  switch (lead.kind) {
    case 'slow-lcp':
      return 'typical wait before a page is usable';
    case 'blank':
      return 'main content timing; first screen is blank';
    case 'late-paint':
      return 'main content timing; first paint is late';
    case 'layout-shift':
      return 'main content timing; stability is the issue';
    case 'sluggish':
      return 'main content timing; taps lag while loading';
    default:
      return undefined;
  }
}

function perfProblemConseq(lead: Problem): string | undefined {
  switch (lead.kind) {
    case 'slow-lcp':
      return 'The page starts, but the main content lands late enough that visitors may give up.';
    case 'layout-shift':
      return 'Content moves while the page loads, so visitors can lose their place or tap the wrong thing.';
    case 'blank':
      return 'A visitor sees nothing at first, which can read as a broken page.';
    case 'late-paint':
      return 'The first pixels arrive late, so the page feels stalled before it starts.';
    case 'sluggish':
      return 'The page may look loaded, but taps and scrolls can lag behind the visitor.';
    default:
      return undefined;
  }
}

interface PerfProblemTileCopy {
  kicker: string;
  wordTx: string;
  metricSub: string;
  conseq: string;
}

export function perfProblemTileCopy(lead: Problem): PerfProblemTileCopy | undefined {
  const kicker = perfProblemKicker(lead);
  const wordTx = perfProblemVerdict(lead);
  const metricSub = perfProblemMetricSub(lead);
  const conseq = perfProblemConseq(lead);
  return kicker && wordTx && metricSub && conseq ? { kicker, wordTx, metricSub, conseq } : undefined;
}

async function buildClientReportV2Model(
  resultsDir: string,
  sc: SiteScorecard,
  domain: string,
  ctx: {
    detailed: RenderedPage[];
    more: RenderedPage[];
    measured: RenderedPage[];
    totalFramesAll: number;
    avgMs?: number;
    avgLabel: string;
    avgStatus: Status;
    slowCount: number;
    jumpyCount: number;
  },
  opts: RenderClientReportOptions,
): Promise<ClientReportV2Model> {
  const dateStr = sc.generatedAt
    ? new Date(sc.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const faviconUri = await fetchSiteFavicon(sc.url);
  const faviconTag = faviconLinkTag(faviconUri);

  // ---- PERFORMANCE ----
  const carded = ctx.detailed.filter((rp) => PROBLEM_KINDS.has(rp.lead.kind));
  const perfCards = carded.map((rp) => perfCardModel(rp, sc.url));
  const fineRows = [
    ...ctx.detailed.filter((rp) => !PROBLEM_KINDS.has(rp.lead.kind)),
    ...ctx.more,
  ];
  const perfFine = fineRows.map((rp) => {
    const row: ClientReportV2Model['perfFine'][number] = {
      name: rp.page.name,
      path: rp.page.startingPath,
      status: rp.lead.status,
      note: stripTags(rp.lead.headline),
    };
    const liveUrl = liveUrlFor(sc.url, rp.page.startingPath);
    if (liveUrl) row.liveUrl = liveUrl;
    return row;
  });
  // "Start here": the DISTINCT slow patterns (deduped by problem kind), each on one
  // page with its own short problem (the lead chip, e.g. "biggest piece at 4.2s").
  const perfStartHere = buildStartHere(
    carded.map((rp) => ({ page: rp.page.name, issue: rp.lead.chip || stripTags(rp.lead.headline), key: rp.lead.kind })),
    fineRows.length,
    'a similar slowdown',
    'a different problem',
    (n) => `${n} ${n === 1 ? 'page loads' : 'pages load'} fine`,
  );
  // Show Performance whenever there's any page to list (failed pages land in perfFine).
  const hasPerf = perfCards.length > 0 || perfFine.length > 0;
  // No measured page -> never claim 'good' off zero data; stay neutral.
  const perfStatus: V2Status = ctx.measured.length === 0
    ? 'fair'
    : ctx.measured.some((r) => r.lead.status === 'poor')
      ? 'poor'
      : ctx.measured.some((r) => r.lead.status === 'fair')
        ? 'fair'
        : 'good';
  let dominantPerfProblem: RenderedPage | undefined;
  for (const rp of ctx.measured) {
    if (!PROBLEM_KINDS.has(rp.lead.kind)) continue;
    if (!dominantPerfProblem || rp.lead.severity > dominantPerfProblem.lead.severity) dominantPerfProblem = rp;
  }
  const perfProblemTx = dominantPerfProblem ? perfProblemPhrase(dominantPerfProblem.lead, dominantPerfProblem.page) : undefined;

  // ---- ACCESSIBILITY ----
  if (opts.summarizeA11y) await enrichA11ySummaries(resultsDir, sc.pages, opts.summarizeA11y);
  const a11yViews = buildA11yPages(sc.pages, resultsDir);
  const hasA11y = a11yViews.length > 0;
  // A page whose a11y scan landed on a bot-protection challenge: its violations are
  // the challenge page's, not the site's. Surface as "could not measure", never count.
  // Trust the a11y scan's OWN verdict. Pre-flag audits (no `blocked`) read as not
  // blocked rather than guessing from another stage's artifact - re-audit to detect.
  const isA11yBlocked = (v: A11yPageView): boolean => v.scan.blocked === true;
  const a11yBlockedViews = a11yViews.filter(isA11yBlocked);
  const a11yMeasurable = a11yViews.filter((v) => !isA11yBlocked(v));
  const a11yBlocked: V2BlockedPage[] = a11yBlockedViews.map((v) => ({ name: v.page.name, path: v.page.startingPath || '/' }));
  const a11yCouldNotMeasure = a11yMeasurable.length === 0 && a11yBlockedViews.length > 0;
  const cardedA11y = a11yMeasurable.filter((v) => hasMajorA11yBarrier(v.counts));
  const fineA11y = a11yMeasurable.filter((v) => !hasMajorA11yBarrier(v.counts));
  const a11yCards = await Promise.all(cardedA11y.map(a11yCardModel));
  const a11yFine = fineA11y.map((v) => {
    const score = v.client?.score;
    const row: ClientReportV2Model['a11yFine'][number] = {
      name: v.page.name,
      path: v.page.startingPath || '/',
      status: typeof score === 'number' ? scoreBucket(score) : 'good',
      summary: v.client?.summary ? dashSafe(v.client.summary) : 'Only minor issues here.',
    };
    if (typeof score === 'number') row.score = score;
    return row;
  });
  const highImpactTotal = cardedA11y.reduce((n, v) => n + v.counts.critical + v.counts.serious, 0);
  const criticalTotal = cardedA11y.reduce((n, v) => n + v.counts.critical, 0);
  const a11yStatus: V2Status = !hasA11y || highImpactTotal === 0 ? 'good' : criticalTotal > 0 ? 'poor' : 'fair';
  // top issue labels across carded pages, impact-weighted, worst first
  const a11yIssueWeight = new Map<string, number>();
  for (const v of cardedA11y) {
    for (const vio of v.scan.violations) {
      const label = a11yIssueLabel(vio.ruleId);
      a11yIssueWeight.set(label, (a11yIssueWeight.get(label) ?? 0) + (vio.impact === 'critical' || vio.impact === 'serious' ? 3 : 1));
    }
  }
  const a11yTopIssues = [...a11yIssueWeight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l).slice(0, 2);
  // "Start here": one plain instruction sentence on the worst page (the first
  // card, so the named page matches what the reader sees first), with a "same
  // fix" line only when the other pages share that fix.
  const a11yWorst = cardedA11y[0];
  let a11yStartHere: V2StartHere | undefined;
  if (a11yWorst) {
    const worstClause = a11yFixClause(sortViolations(a11yWorst.scan.violations)[0]?.ruleId ?? '');
    const others = cardedA11y.slice(1);
    const allSameFix = others.length > 0 && others.every((v) => a11yFixClause(sortViolations(v.scan.violations)[0]?.ruleId ?? '') === worstClause);
    a11yStartHere = { items: [], lead: a11yStartHereLead(a11yWorst, others.length, allSameFix) };
  }

  // ---- AI VISIBILITY (Agent Ready) ----
  let hasAgent = hasAgentData(sc.pages);
  let agentSite: ClientReportV2Model['agentSite'];
  let agentCards: V2AgentCard[] = [];
  let agentFine: ClientReportV2Model['agentFine'] = [];
  let agentStatus: V2Status = 'good';
  let agentOverall = 0;
  let agentAccessBlocked = false;
  let agentCoveragePct: number | undefined;
  let agentTopGap: string | undefined;
  let agentStartHere: V2StartHere | undefined;
  let agentBlocked: V2BlockedPage[] = [];
  let agentCouldNotMeasure = false;
  if (hasAgent) {
    try {
      let agentViews: AgentPageView[] = buildAgentPages(sc.pages, resultsDir);
      const siteSignals: SiteAccessSignals | undefined = await fetchSiteAccessSignals(sc.url);
      if (opts.summarizeAgent) {
        await enrichAgentSummaries(resultsDir, agentViews, siteSignals, opts.summarizeAgent);
        agentViews = buildAgentPages(sc.pages, resultsDir);
      }
      // A page whose raw fetch OR rendered DOM was a bot-protection challenge: its
      // signals are the challenge page's, not the site's. "Could not measure", never scored.
      const isAgentBlocked = (v: AgentPageView): boolean =>
        typeof v.result.blocked === 'boolean'
          ? v.result.blocked
          : v.result.raw.likelyBlocked || looksLikeBotWall({ title: v.result.rendered?.title });
      const agentBlockedViews = agentViews.filter(isAgentBlocked);
      const agentMeasurable = agentViews.filter((v) => !isAgentBlocked(v));
      agentBlocked = agentBlockedViews.map((v) => ({ name: v.page.name, path: v.page.startingPath || '/' }));
      agentCouldNotMeasure = agentMeasurable.length === 0 && agentBlockedViews.length > 0;
      if (agentMeasurable.length > 0) {
        const overall = scoreSite(agentMeasurable.map((v) => v.result), siteSignals);
        agentStatus = overall.bucket;
        agentOverall = overall.overall;
        agentAccessBlocked = overall.accessBlocked;
        agentSite = {
          score: overall.access.score,
          status: overall.access.bucket,
          checks: overall.access.category.items.map((it) => ({
            ok: it.state === 'pass' ? 'ok' : it.state === 'na' ? 'na' : 'bad',
            tx: dashSafe(it.detail),
          })),
        };
        const cardViews = agentMeasurable.filter((v) => v.struct.bucket !== 'good');
        const fineViews = agentMeasurable.filter((v) => v.struct.bucket === 'good');
        agentCards = cardViews.map(agentCardModel);
        const firstGap = cardViews[0] ? agentPageFindings(cardViews[0].struct)[0] : undefined;
        if (firstGap?.label) agentTopGap = firstGap.label.toLowerCase();
        agentFine = fineViews.map((v) => ({
          name: v.page.name,
          path: v.page.startingPath || '/',
          score: v.struct.score,
          status: v.struct.bucket,
        }));
        const reachable = agentMeasurable.filter((v) => v.struct.rawReachable);
        if (reachable.length > 0) agentCoveragePct = Math.round((reachable.reduce((s, v) => s + v.struct.coverage, 0) / reachable.length) * 100);
        // "Start here": the DISTINCT gaps (deduped), each on one page (in parens) + rest.
        agentStartHere = buildStartHere(
          cardViews.map((v) => {
            const gap = agentPageFindings(v.struct)[0];
            const label = gap?.label || 'content needs JavaScript to read';
            return { page: v.page.name, issue: label.toLowerCase(), key: label };
          }),
          fineViews.length,
          'similar gaps',
          'different gaps',
          (n) => `${n} ${n === 1 ? 'page reads' : 'pages read'} well for AI`,
        );
      }
    } catch (err) {
      console.warn(chalk.yellow(`shaka-perf: the AI visibility section failed to render, omitting it: ${(err as Error).message}`));
      hasAgent = false;
      agentSite = undefined;
      agentCards = [];
      agentFine = [];
      agentBlocked = [];
      agentCouldNotMeasure = false;
    }
  }

  // ---- worst dimension (for the bottom line) ----
  const rank: Record<V2Status, number> = { good: 0, fair: 1, poor: 2 };
  const present: { dim: Dim; status: V2Status }[] = [];
  if (hasPerf) present.push({ dim: 'perf', status: perfStatus });
  if (hasA11y && !a11yCouldNotMeasure) present.push({ dim: 'a11y', status: a11yStatus });
  if (hasAgent && !agentCouldNotMeasure) present.push({ dim: 'agent', status: agentStatus });
  const worstDim: Dim = present.length
    ? present.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a)).dim
    : 'perf';

  // ---- narrative (deterministic, optionally AI-refined; cached) ----
  const facts: NarrativeFacts = { domain, worstDim };
  if (hasPerf) {
    const perfFact: NonNullable<NarrativeFacts['perf']> = {
      status: perfStatus,
      slowCount: ctx.slowCount,
      jumpyCount: ctx.jumpyCount,
      worst: carded.slice(0, 3).map((rp) => ({ name: rp.page.name, problem: stripTags(rp.lead.headline) })),
    };
    if (ctx.avgMs !== undefined) perfFact.avgLabel = ctx.avgLabel;
    facts.perf = perfFact;
  }
  if (hasA11y) {
    const a11yFact: NonNullable<NarrativeFacts['a11y']> = {
      status: a11yStatus,
      highImpact: highImpactTotal,
      pagesWithBarriers: cardedA11y.length,
      topIssues: a11yTopIssues,
    };
    if (a11yWorst) a11yFact.worstPage = a11yWorst.page.name;
    if (a11yCouldNotMeasure) a11yFact.couldNotMeasure = true;
    facts.a11y = a11yFact;
  }
  if (hasAgent) {
    const agentFact: NonNullable<NarrativeFacts['agent']> = {
      status: agentStatus,
      score: agentOverall,
      accessBlocked: agentAccessBlocked,
    };
    if (agentCoveragePct !== undefined) agentFact.coveragePct = agentCoveragePct;
    if (agentCards[0]) agentFact.worstPage = agentCards[0].name;
    if (agentTopGap) agentFact.topGap = agentTopGap;
    if (agentCouldNotMeasure) agentFact.couldNotMeasure = true;
    facts.agent = agentFact;
  }

  // Only touch the AI/cache when a narrator is wired (NOT --no-ai-narrative), so
  // that flag stays deterministic even if a prior run cached an overlay.
  let overlay: NarrativeOverlay | null = null;
  if (opts.narrate) {
    overlay = readNarrativeOverlay(resultsDir);
    if (!overlay) {
      overlay = await opts.narrate(facts);
      if (overlay) writeNarrativeOverlay(resultsDir, overlay);
    }
  }
  const narrative = composeNarrative(facts, overlay);

  // ---- exec tiles ----
  const tiles: V2Tile[] = [];
  if (hasPerf) {
    const defaultPerfMetricSub = 'typical wait before a page is usable';
    const defaultPerfConseq = perfStatus === 'good'
      ? 'Pages load quickly on a phone, so visitors are not lost to waiting.'
      : `Phone visitors wait around ${ctx.avgMs !== undefined ? ctx.avgLabel : 'several seconds'} - long enough that many leave first.`;
    const dominantPerfTileCopy = dominantPerfProblem ? perfProblemTileCopy(dominantPerfProblem.lead) : undefined;
    const perfKicker = dominantPerfTileCopy?.kicker ?? 'Mobile speed';
    const perfWordTx = ctx.measured.length === 0
      ? 'Could not measure'
      : dominantPerfTileCopy?.wordTx ?? narrative.perf.verdictWord;
    const perfMetricSub = ctx.measured.length === 0
      ? 'no usable mobile speed data'
      : dominantPerfTileCopy?.metricSub ?? defaultPerfMetricSub;
    const perfConseq = ctx.measured.length === 0
      ? 'The audit did not return enough mobile speed data to make a speed claim.'
      : dominantPerfTileCopy?.conseq ?? defaultPerfConseq;
    tiles.push({
      target: 'perf',
      kicker: perfKicker,
      status: perfStatus,
      wordTx: perfWordTx,
      metric: ctx.avgMs !== undefined ? ctx.avgLabel : 'n/a',
      ...(perfProblemTx ? { problemTx: perfProblemTx } : {}),
      metricSub: perfMetricSub,
      conseq: perfConseq,
    });
  }
  if (hasA11y) {
    tiles.push({
      target: 'a11y',
      kicker: 'Accessibility',
      status: a11yStatus,
      wordTx: narrative.a11y.verdictWord,
      metric: a11yCouldNotMeasure ? 'n/a' : String(highImpactTotal),
      // Denominator matches the narrative (pages with a barrier), else pages checked.
      metricSub: a11yCouldNotMeasure
        ? `${a11yBlocked.length} page${a11yBlocked.length === 1 ? '' : 's'} blocked by bot protection`
        : highImpactTotal > 0
          ? `high-impact issue${highImpactTotal === 1 ? '' : 's'} across ${cardedA11y.length} page${cardedA11y.length === 1 ? '' : 's'}`
          : `high-impact issues across ${a11yMeasurable.length} page${a11yMeasurable.length === 1 ? '' : 's'} checked`,
      conseq: a11yCouldNotMeasure
        ? "The site's bot protection served our checker a challenge page, so we could not measure this."
        : highImpactTotal > 0
          ? 'One blocking issue can turn a customer away - and the same fixes lift your SEO.'
          : 'Most visitors can use the site; only minor polish is left.',
      ...(a11yCouldNotMeasure ? { blocked: true } : {}),
    });
  }
  if (hasAgent) {
    tiles.push({
      target: 'agent',
      kicker: 'AI visibility',
      status: agentStatus,
      wordTx: narrative.agent.verdictWord,
      metric: agentCouldNotMeasure ? 'n/a' : String(agentOverall),
      metricSub: agentCouldNotMeasure
        ? `${agentBlocked.length} page${agentBlocked.length === 1 ? '' : 's'} blocked by bot protection`
        : 'out of 100 - can AI read & recommend you',
      conseq: agentCouldNotMeasure
        ? "The site's bot protection served our checker a challenge page, so we could not measure this."
        : agentAccessBlocked
          ? 'AI crawlers are blocked, so AI assistants will not recommend you.'
          : agentStatus === 'good'
            ? 'AI assistants can already read most of your site and are allowed in.'
            : agentStatus === 'fair'
              ? 'AI is allowed in, but misses content that loads after the page runs code.'
              : 'AI can read little of your site, so it rarely gets recommended.',
      ...(agentCouldNotMeasure ? { blocked: true } : {}),
    });
  }

  // The intro/outro promise only the dimensions this report actually contains.
  const aspects: string[] = [];
  if (hasPerf) aspects.push('stay');
  if (hasA11y) aspects.push('can use the page');
  if (hasAgent) aspects.push('get recommended by AI');
  const aspectList = aspects.length <= 1
    ? aspects[0] ?? 'have a good experience'
    : `${aspects.slice(0, -1).join(', ')}, and ${aspects[aspects.length - 1]}`;
  const lede = `We loaded ${ctx.measured.length} of your pages the way a customer does - on a typical phone, on a normal cellular connection - and checked what decides whether visitors ${aspectList}.`;
  const outro = `The single fix behind most of this is making sure your full page content is present the moment the page loads - done well, it speeds the page up for real visitors${hasAgent ? ' and makes you readable to AI at the same time' : ''}. That is the work we do every day at ShakaCode; happy to walk through what we found.`;
  const footnote = `Measured ${dateStr ? `${dateStr} ` : ''}on an emulated mid-range phone over the Slow-4G profile Google PageSpeed uses - the conditions a real mobile visitor faces, not a developer's laptop. Speed score is Google's 0-100 mobile scale (90+ is fast, under 50 is slow); layout shift is Google's CLS (above 0.25 is poor)${hasA11y ? '; accessibility score is the Google Lighthouse 0-100 scale' : ''}. Put together by ShakaCode.`;

  const model: ClientReportV2Model = {
    domain,
    dateStr,
    faviconLinkTag: faviconTag,
    lede,
    tiles,
    hasPerf,
    perfStatus,
    perfCards,
    perfFine,
    hasA11y,
    a11yStatus,
    a11yCards,
    a11yFine,
    a11yBlocked,
    a11yCouldNotMeasure,
    hasAgent,
    agentStatus,
    agentCards,
    agentFine,
    agentBlocked,
    agentCouldNotMeasure,
    narrative,
    outro,
    footnote,
  };
  if (agentSite) model.agentSite = agentSite;
  if (perfStartHere) model.perfStartHere = perfStartHere;
  if (a11yStartHere) model.a11yStartHere = a11yStartHere;
  if (agentStartHere) model.agentStartHere = agentStartHere;
  return model;
}

export async function writeClientReport(
  resultsDir: string,
  outPath: string,
  opts: RenderClientReportOptions = {},
): Promise<number> {
  const { html, pageCount } = await renderClientReport(resultsDir, opts);
  if (pageCount === 0) {
    throw new Error(`No pages in ${path.join(resultsDir, 'report.json')} - refusing to write an empty client report (interrupted audit, or wrong --results dir?).`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return pageCount;
}
