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
import { faviconLinkTag, fetchSiteFavicon } from './site-assets';
import { escapeHtml as esc } from './html-escape';
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
  buildAgentPages,
  enrichAgentSummaries,
  hasAgentData,
  type AgentPageView,
  type AgentSummarizer,
} from './agent-ready-report';
import { fetchSiteAccessSignals } from './agent-ready-site';
import {
  BENCHMARK_LINES,
  buildPerfCost,
} from './client-report-model/cost';
import { buildCopyPrompt } from './copy-prompt';
import {
  renderClientReportHtml,
  type ClientReportModel,
  type ClientReportA11yCard,
  type ClientReportFrame,
  type ClientReportPerfCard,
  type ClientReportStartHere,
  type ClientReportStatus,
} from './client-report-renderer';
import { looksLikeBotWall } from '../audit/bot-wall';
import {
  parseNarrativeResponse,
  versionNarrativeOverlay,
  type NarrativeOverlay,
  type NarrativeSummarizer,
} from './client-report-narrative';
import {
  CLS_GOOD,
  LCP_WAIT_MS,
  PROBLEM_KINDS,
  VISIBLE_SHIFT,
  clamp01,
  clsStatus,
  comparePerfProblem,
  detectProblems,
  dominantPerfProblem,
  metricVal,
  perfCostCopyPromptEnabled,
  scoreStatus,
  secs,
  reportPagePerfStatus,
  reportPerfStatus,
  type Problem,
  type ProblemKind,
  type Status,
  type ClientReportPerfProblemCandidate,
} from './client-report-model/perf';
import {
  a11yPromptRules,
  buildA11ySection,
  prepareA11ySection,
  summarizeA11yRuleFamilies,
  type A11yPromptContext,
  type A11ySectionCounts,
  type A11ySectionView,
} from './client-report-model/a11y';
import { buildAgentSection, type AgentPromptContext, type AgentSection } from './client-report-model/ai';
import {
  assembleClientReportModel,
  buildClientReportNarrativeFacts,
  type ClientReportReportInput,
} from './client-report-model/report';
import { dashSafe, liveUrlFor, stripTags } from './client-report-model/shared';

export {
  detectProblems,
  perfProblemPhrase,
  perfProblemTileCopy,
  reportClsStatus,
  reportFcpStatus,
  reportLcpStatus,
  reportPagePerfStatus,
  reportPerfStatus,
  reportTbtStatus,
} from './client-report-model/perf';
export type { Problem, ProblemKind, ClientReportPagePerfStatusInput } from './client-report-model/perf';
export { dashSafe };
export { hasMajorA11yBarrier } from './client-report-model/a11y';
export { faviconDataUri, faviconLinkTag, parseIconHref } from './site-assets';

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

// ---- frame/image budgets ----
const FRAME_W = 380; // inlined frame width (px) - enough detail for the zoom
// Frame budgets per strip. The timeline is already visually deduped upstream
// (every frame in timeline_frames.json is a frame where something changed), so
// when a page's meaningful window holds fewer frames than the budget the strip
// simply shows all of them; sampling only kicks in on animation-churn pages
// where a background animation keeps emitting near-identical frames.
const STRIP_DENSE = 12; // pages with a layout-shift story (every frame differs)
const STRIP_SPARSE = 8; // load-story pages (enough beats without a wall of blank phones)
const DETAIL_PAGES = 5; // pages shown in full; the rest get a one-line summary

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
export type CueKind = 'blank' | 'first-content' | 'main' | 'jump' | 'loaded' | 'google-good-line';

export interface CaptionCue {
  atMs: number;
  kind: CueKind;
  text: string; // the deterministic phrase; an optional AI pass may rewrite it
  rewriteable?: boolean;
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
  'google-good-line': 1,
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
    case 'google-good-line':
      return "Google's good line passes here.";
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
  const googleGoodLineCue = (): CaptionCue => ({
    atMs: BENCHMARK_LINES.lcpMs.good,
    kind: 'google-good-line',
    text: "Google's good line passes here.",
    rewriteable: false,
  });
  if (frames.length === 0) {
    return lcpMs !== undefined && lcpMs > BENCHMARK_LINES.lcpMs.good && windowMs >= BENCHMARK_LINES.lcpMs.good
      ? [googleGoodLineCue()]
      : [];
  }
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

  if (lcpMs !== undefined && lcpMs > BENCHMARK_LINES.lcpMs.good && cap >= BENCHMARK_LINES.lcpMs.good) {
    raw.push(googleGoodLineCue());
  }

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

export type ImpactCounts = A11ySectionCounts;

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

// A11y cards worst-first by the Lighthouse score on each card (lower = worse): it
// weights every check, so it catches high-weight ARIA the axe high-impact count
// misses. Ties: high-impact defect count, critical, moderate, homepage-first/path;
// unscored pages (LH timed out) trail.
export interface A11yPageRank { counts: ImpactCounts; highImpact?: number; score?: number; startingPath: string }
export function compareA11yWorstFirst(a: A11yPageRank, b: A11yPageRank): number {
  const aScored = Number.isFinite(a.score);
  const bScored = Number.isFinite(b.score);
  if (aScored && bScored) {
    if (a.score !== b.score) return (a.score as number) - (b.score as number);
  } else if (aScored !== bScored) {
    return aScored ? -1 : 1; // unscored page (LH timed out) trails scored ones
  }
  const hi = (b.highImpact ?? highImpact(b.counts)) - (a.highImpact ?? highImpact(a.counts));
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

// The phone scan for a page that completed accessibility measurement. The
// stage writes exactly one scan per (page, viewport) file; synthesis already
// resolved the phone row, so scans[0] is the phone scan.
function a11yScan(page: PagePerf): AccessibilityScan | undefined {
  return page.a11y?.scans?.[0];
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
export function readA11yClient(resultsDir: string, pageId: string): A11ySectionView['client'] | undefined {
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

function buildA11yPages(pages: PagePerf[], resultsDir: string): A11ySectionView[] {
  const views: A11ySectionView[] = [];
  for (const page of pages) {
    const scan = a11yScan(page);
    if (!scan) continue;
    views.push({ page, scan, counts: tallyByImpact(scan.violations), client: readA11yClient(resultsDir, page.id) });
  }
  const highImpactByView = new Map(views.map((view) => [view, summarizeA11yRuleFamilies([view.scan]).headlineCount]));
  // Worst accessibility first (see compareA11yWorstFirst).
  views.sort((a, b) =>
    compareA11yWorstFirst(
      { counts: a.counts, highImpact: highImpactByView.get(a), score: a.client?.score, startingPath: a.page.startingPath },
      { counts: b.counts, highImpact: highImpactByView.get(b), score: b.client?.score, startingPath: b.page.startingPath },
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
    .filter((t): t is { page: PagePerf; scan: AccessibilityScan } => !!t.scan && t.scan.violations.length > 0);
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

// The accessibility stage writes its screenshot as an artifact FILE and records
// a results-relative path in `imageHref` (ArtifactScope.pathFor), so every crop
// below starts by reading those bytes back off disk. An unreadable path (escapes
// the results dir, or the artifact is gone) warns rather than returning a quiet
// null: it costs the report EVERY accessibility screenshot at once, which is
// otherwise invisible until someone notices the cards lost their frames.
function readA11yScreenshot(resultsDir: string, source: string): Buffer | null {
  const abs = containedJoin(resultsDir, source);
  if (!abs) {
    console.warn(chalk.yellow(`shaka-perf: accessibility screenshot ${source} escapes ${resultsDir}, skipping its frames`));
    return null;
  }
  try {
    return fs.readFileSync(abs);
  } catch (err) {
    console.warn(chalk.yellow(`shaka-perf: cannot read accessibility screenshot ${abs}, skipping its frames: ${(err as Error).message}`));
    return null;
  }
}

// Exported for the crop-filter integration test (structural rules must yield no
// crop, spatial rules must still crop). Not part of the public report API.
// `dropEngulfing`: skip a coarse box that covers the whole crop and count only
// the boxes actually drawn.
export async function a11yCropFrames(resultsDir: string, scan: AccessibilityScan, dropEngulfing = false): Promise<A11yFrame[]> {
  const shot = scan.screenshot;
  const source = shot?.imageHref;
  if (!shot || !source) return [];
  const buf = readA11yScreenshot(resultsDir, source);
  if (!buf) return [];
  let avifW: number;
  let avifH: number;
  try {
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
  // With dropEngulfing, skip flat-placeholder bands and take the next real one
  // (one blank kept as last resort).
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
    // With dropEngulfing, "N spots" must count drawn boxes, not the whole band.
    frames.push({ dataUri: cropUri, boxes, summary, count: dropEngulfing ? boxes.length : inWin.length });
  }
  return frames;
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

export interface ClientReportResult {
  html: string;
  pageCount: number;
  model: ClientReportModel;
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
  // Optional AI pass that rewrites the narrative copy - the bottom line
  // and each tab's verdict. Off by default (tests never spawn it); the CLI wires
  // the claude-backed one unless --no-ai-narrative. Best-effort + cached: a missing
  // /slow/failed claude leaves the built-in deterministic verdict copy in place.
  narrate?: NarrativeSummarizer;
  // Optional path for the carded page where the owner starts an inquiry or booking.
  moneyPage?: string;
}

export function captionCuesForRewrite(cues: readonly CaptionCue[]): CaptionCue[] {
  return cues.filter((cue) => cue.rewriteable !== false);
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
    const rewriteTargets = targets.map((target) => ({ target, cues: captionCuesForRewrite(target.captionCues!) }))
      .filter((target) => target.cues.length > 0);
    if (rewriteTargets.length > 0) {
      const refined = await opts.refineCaptions(
        rewriteTargets.map(({ target, cues }) => ({
          pageName: target.page.name,
          problem: stripTags(target.lead.headline),
          cues: cues.map((cue) => ({ kind: cue.kind, atSec: secs(cue.atMs), text: cue.text })),
        })),
      );
      if (refined) {
        rewriteTargets.forEach(({ target, cues }, i) => {
          const texts = refined[i];
          if (!texts || texts.length !== cues.length) return; // shape mismatch: keep deterministic
          let rewritten = 0;
          target.captionCues = target.captionCues!.map((cue) => {
            if (cue.rewriteable === false) return cue;
            const text = texts[rewritten++]?.trim();
            return text ? { ...cue, text: dashSafe(text) } : cue;
          });
        });
      }
    }
  }
  const model = await buildClientReportModel(
    resultsDir,
    sc,
    domain,
    { detailed, more, measured, avgMs, avgLabel, slowCount, jumpyCount },
    opts,
  );
  return { html: renderClientReportHtml(model), pageCount: rendered.length, model };
}

// ---- Client report model assembly ----
// Maps the gathered artifacts onto the `ClientReportModel` the renderer takes.
// All async/IO (a11y crops, agent fetch, AI passes) is here; the renderer is pure.

const NARRATIVE_FILENAME = 'client-narrative.json';
const LEGACY_NARRATIVE_FILENAME = 'client-narrative-v2.json';

// Cache stores the AI OVERLAY (plain text), not the composed narrative, so every
// render recomposes from current facts: a newly-present tab gets fresh copy, and
// the bottom-line HTML is re-escaped here (never trusted raw). Bad file -> null.
function readNarrativeOverlay(resultsDir: string): NarrativeOverlay | null {
  const current = path.join(resultsDir, NARRATIVE_FILENAME);
  const legacy = path.join(resultsDir, LEGACY_NARRATIVE_FILENAME);
  const p = fs.existsSync(current) ? current : legacy;
  if (!fs.existsSync(p)) return null;
  try {
    const overlay = parseNarrativeResponse(fs.readFileSync(p, 'utf8'), { requireSchemaVersion: true });
    if (!overlay) console.warn('shaka-perf: cached AI narrative overlay is stale or unreadable - regenerating verdict copy.');
    return overlay;
  } catch {
    return null;
  }
}

function writeNarrativeOverlay(resultsDir: string, overlay: NarrativeOverlay): void {
  try {
    fs.writeFileSync(path.join(resultsDir, NARRATIVE_FILENAME), `${JSON.stringify(versionNarrativeOverlay(overlay), null, 2)}\n`);
  } catch {
    /* a polish artifact must never fail the report */
  }
}

function cardPerfProblem(rp: RenderedPage): ClientReportPerfProblemCandidate | undefined {
  const candidate = dominantPerfProblem(rp);
  if (!candidate || candidate.status === 'good') return undefined;
  return candidate;
}

function perfCardModel(rp: RenderedPage, siteUrl: string, promptCtx: PerfPromptContext, includeCopyPrompt: boolean): ClientReportPerfCard {
  const { page, lead } = rp;
  const cardCandidate = cardPerfProblem(rp);
  const cardStatus = cardCandidate?.status ?? reportPagePerfStatus(rp);
  const cardProblem = cardCandidate?.problem.headline ? cardCandidate.problem : lead;
  const score = metricVal(page, 'LH Score');
  const clsV = metricVal(page, 'CLS');
  const beforeLcpKb = metricVal(page, 'downloads-before-LCP');
  const totalKb = metricVal(page, 'downloads');

  const frames: ClientReportFrame[] = rp.shots.map((s) => {
    // Beat precedence: biggest piece (LCP) > layout jump > first content.
    const beat: ClientReportFrame['beat'] = s.isLcp ? 'lcp' : s.shiftValue > 0 ? 'shift' : s.isFcp ? 'first-content' : undefined;
    const fr: ClientReportFrame = {
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

  const facts: ClientReportPerfCard['facts'] = [];
  if (beforeLcpKb !== undefined) facts.push({ val: mb(beforeLcpKb), label: 'downloaded first', status: cardStatus });
  else if (totalKb !== undefined) facts.push({ val: mb(totalKb), label: 'page weight', status: cardStatus });
  if (score !== undefined) facts.push({ val: `${Math.round(score)}/100`, label: 'speed score', status: scoreStatus(score) });
  if (clsV !== undefined && clsV > CLS_GOOD) facts.push({ val: (clsV / 100).toFixed(2), label: 'layout-shift score', status: clsStatus(clsV) });

  const poster = (rp.shots.find((s) => s.isLcp) ?? rp.shots[rp.shots.length - 1])?.dataUri;
  const card: ClientReportPerfCard = {
    id: page.id,
    name: page.name,
    path: page.startingPath,
    status: cardStatus,
    headlineHtml: cardProblem.headline || lead.headline,
    videoCap: videoCaption(cardProblem.kind, rp.lcpMs, rp.videoCoveredSec),
    frames,
    totalFrames: rp.totalFrames,
    facts,
  };
  const liveUrl = liveUrlFor(siteUrl, page.startingPath);
  if (liveUrl) card.liveUrl = liveUrl;
  if (cardProblem.note) card.sub = cardProblem.note;
  if (rp.videoUri) card.videoUri = rp.videoUri;
  if (poster) card.posterUri = poster;
  if (rp.captionCues && rp.captionCues.length) card.cues = rp.captionCues.map((c) => ({ t: Math.round(c.atMs), x: c.text }));
  if (page.summary) card.plain = dashSafe(page.summary);
  if (includeCopyPrompt && cardStatus !== 'good' && cardCandidate && perfCostCopyPromptEnabled(cardCandidate.problem)) {
    const copyPrompt = perfCopyPromptForPage(page, siteUrl, promptCtx);
    if (copyPrompt) card.copyPrompt = copyPrompt;
  }
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

function lowerImpactDefectCount(scan: AccessibilityScan, impact: 'moderate' | 'minor'): number {
  const summary = summarizeA11yRuleFamilies([{
    violations: scan.violations.filter((violation) => violation.impact === impact),
  }], Number.MAX_SAFE_INTEGER);
  return summary.notCountedExtras.reduce((total, family) => total + family.defectCount, 0);
}

function a11ySevChips(scan: AccessibilityScan, highImpact: number): ClientReportA11yCard['sev'] {
  const chips: ClientReportA11yCard['sev'] = [];
  if (highImpact > 0) chips.push({ num: highImpact, label: 'high-impact', status: 'poor' });
  const moderate = lowerImpactDefectCount(scan, 'moderate');
  const minor = lowerImpactDefectCount(scan, 'minor');
  if (moderate > 0) chips.push({ num: moderate, label: 'moderate', status: 'fair' });
  if (minor > 0) chips.push({ num: minor, label: 'low', status: 'good' });
  return chips;
}

const A11Y_STRUCTURAL_CAPTION = 'No spot is highlighted because this problem lives in how the whole page is built, not in one place you can see on the screen.';
const A11Y_WHOLEPAGE_CAPTION = 'Showing the full page; the flagged issues are listed below.';

// When a page has no crop frames, show the whole page so the card still has a
// visual. The caller picks the caption (structural vs generic).
async function a11yWholePageFrame(resultsDir: string, scan: AccessibilityScan, caption: string): Promise<ClientReportA11yCard['frames'][number] | null> {
  const shot = scan.screenshot;
  const source = shot?.imageHref;
  if (!shot || !source) return null;
  const buf = readA11yScreenshot(resultsDir, source);
  if (!buf) return null;
  try {
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

function a11yPageUrl(siteUrl: string, view: A11ySectionView): string {
  return liveUrlFor(siteUrl, view.page.startingPath || '/') || view.scan.url || siteUrl;
}

function a11yCopyPromptForView(view: A11ySectionView, siteUrl: string, ctx: A11yPromptContext): string | undefined {
  return buildCopyPrompt('a11y', {
    url: a11yPageUrl(siteUrl, view),
    host: ctx.host,
    date: ctx.date,
    rawState: view.scan.blocked === true ? 'blocked' : 'ok',
    topRules: a11yPromptRules(view.scan),
  });
}

async function a11yCardModel(resultsDir: string, view: A11ySectionView, siteUrl?: string, promptCtx?: A11yPromptContext): Promise<ClientReportA11yCard> {
  const { page, scan, client } = view;
  const crops = await a11yCropFrames(resultsDir, scan, true);
  const score = client?.score;
  const status: ClientReportStatus = typeof score === 'number' ? scoreStatus(score) : 'poor';
  const topLabel = sortViolations(scan.violations)[0] ? a11yIssueLabel(sortViolations(scan.violations)[0].ruleId) : '';
  const hi = summarizeA11yRuleFamilies([scan]).headlineCount;
  const summary = client?.summary
    ? dashSafe(client.summary)
    : `${hi} high-impact issue${hi === 1 ? '' : 's'} on this page${topLabel ? `, mainly ${topLabel}` : ''}.`;
  let frames: ClientReportA11yCard['frames'] = crops.map((f) => ({
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
    const whole = await a11yWholePageFrame(resultsDir, scan, caption);
    if (whole) frames = [whole];
  }
  const card: ClientReportA11yCard = {
    name: page.name,
    path: page.startingPath || '/',
    highImpact: hi,
    status,
    sev: a11ySevChips(scan, hi),
    summary,
    frames,
    fixes: client?.fixes?.length ? client.fixes.map(dashSafe) : a11yFallbackFixes(scan),
  };
  if (typeof score === 'number') card.score = score;
  if (siteUrl && promptCtx) {
    const copyPrompt = a11yCopyPromptForView(view, siteUrl, promptCtx);
    if (copyPrompt) card.copyPrompt = copyPrompt;
  }
  return card;
}

const PSI_DEFAULT_THROTTLE_PROFILE = 'Slow-4G';

interface PerfPromptContext {
  host: string;
  date: string;
  viewportLabel: string;
  throttleProfile: string;
}

function agentPromptHost(siteUrl: string, domain: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return domain;
  }
}

function agentPromptDate(dateStr: string, generatedAt: string): string {
  return dateStr || generatedAt || 'date not recorded';
}

function perfViewportLabel(sc: SiteScorecard): string {
  return sc.viewport ? `${sc.viewport.width}x${sc.viewport.height} mobile viewport` : 'mobile viewport';
}

function perfThrottleProfile(sc: SiteScorecard): string {
  return sc.throttleProfile || PSI_DEFAULT_THROTTLE_PROFILE;
}

function normalizedProfile(profile: string): string {
  return profile.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sameAsPsiDefaultProfile(profile: string | undefined): boolean {
  if (!profile) return false;
  return normalizedProfile(profile) === normalizedProfile(PSI_DEFAULT_THROTTLE_PROFILE);
}

function footnoteThrottlePhrase(profile: string): string {
  return sameAsPsiDefaultProfile(profile)
    ? `the ${profile} profile Google PageSpeed uses`
    : `the ${profile} profile`;
}

function perfPageUrl(siteUrl: string, page: PagePerf): string {
  return liveUrlFor(siteUrl, page.startingPath || '/') || siteUrl;
}

function perfCopyPromptForPage(page: PagePerf, siteUrl: string, ctx: PerfPromptContext): string | undefined {
  const url = perfPageUrl(siteUrl, page);
  const lcpMs = metricVal(page, 'LCP');
  return buildCopyPrompt('perf', {
    url,
    host: ctx.host,
    date: ctx.date,
    viewportLabel: ctx.viewportLabel,
    throttleProfile: ctx.throttleProfile,
    lcpLabel: lcpMs !== undefined ? secs(lcpMs) : 'not measured',
    jsKb: metricVal(page, 'js') ?? 0,
    jsFileCount: metricVal(page, 'js-count') ?? 0,
    kbBeforeLcp: metricVal(page, 'downloads-before-LCP'),
  });
}

function agentPromptConditions(sc: SiteScorecard): string {
  const parts = [
    sc.viewport ? `${sc.viewport.width}x${sc.viewport.height} mobile viewport` : undefined,
    sc.throttleProfile,
    'raw HTML versus rendered page',
  ];
  return parts.filter((p): p is string => !!p).join(', ');
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
): ClientReportStartHere | undefined {
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
  const sh: ClientReportStartHere = { items };
  if (parts.length) sh.rest = `${parts.join('; ')}.`;
  return sh;
}


async function buildClientReportModel(
  resultsDir: string,
  sc: SiteScorecard,
  domain: string,
  ctx: {
    detailed: RenderedPage[];
    more: RenderedPage[];
    measured: RenderedPage[];
    avgMs?: number;
    avgLabel: string;
    slowCount: number;
    jumpyCount: number;
  },
  opts: RenderClientReportOptions,
): Promise<ClientReportModel> {
  const dateStr = sc.generatedAt
    ? new Date(sc.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const faviconTag = faviconLinkTag(await fetchSiteFavicon(sc.url));
  const perfPromptCtx: PerfPromptContext = {
    host: agentPromptHost(sc.url, domain),
    date: agentPromptDate(dateStr, sc.generatedAt),
    viewportLabel: perfViewportLabel(sc),
    throttleProfile: perfThrottleProfile(sc),
  };

  const perfCouldNotMeasure = ctx.measured.length === 0;
  const perfStatus = reportPerfStatus(ctx.measured, perfCouldNotMeasure);
  const rankedCarded = [...ctx.detailed.filter((page) => PROBLEM_KINDS.has(page.lead.kind))].sort(comparePerfProblem);
  const perfCards = rankedCarded.map((page) =>
    perfCardModel(page, sc.url, perfPromptCtx, !perfCouldNotMeasure && perfStatus !== 'good'));
  const perfFine = [
    ...ctx.detailed.filter((page) => !PROBLEM_KINDS.has(page.lead.kind)),
    ...ctx.more,
  ].map((page) => {
    const row: ClientReportModel['perfFine'][number] = {
      name: page.page.name,
      path: page.page.startingPath,
      status: reportPagePerfStatus(page),
      note: stripTags(page.lead.headline),
    };
    const liveUrl = liveUrlFor(sc.url, page.page.startingPath);
    if (liveUrl) row.liveUrl = liveUrl;
    return row;
  });
  const hasPerf = perfCards.length > 0 || perfFine.length > 0;
  const perf = {
    hasPerf,
    perfStatus,
    ...(sc.score !== null ? { perfScore: Math.round(sc.score.avg) } : {}),
    perfCouldNotMeasure,
    perfCards,
    perfFine,
    ...buildPerfCost({
      hasPerf,
      perfCouldNotMeasure,
      perfStatus,
      measured: ctx.measured,
      rankedCarded,
      siteUrl: sc.url,
      throttleProfile: sc.throttleProfile,
      promptCtx: perfPromptCtx,
      moneyPage: opts.moneyPage,
      pageUrl: (page) => perfPageUrl(sc.url, page),
      copyPromptForPage: (page) => perfCopyPromptForPage(page, sc.url, perfPromptCtx),
      sameAsPsiDefaultProfile,
    }),
  };

  if (opts.summarizeA11y) await enrichA11ySummaries(resultsDir, sc.pages, opts.summarizeA11y);
  const preparedA11y = prepareA11ySection(buildA11yPages(sc.pages, resultsDir));
  const a11yPromptCtx: A11yPromptContext = {
    host: agentPromptHost(sc.url, domain),
    date: agentPromptDate(dateStr, sc.generatedAt),
  };
  const a11yCards = await Promise.all(
    preparedA11y.cardedA11y.map((view) => a11yCardModel(resultsDir, view, sc.url, a11yPromptCtx)),
  );
  const a11y = buildA11ySection(preparedA11y, a11yCards, sc.url, a11yPromptCtx);

  let hasAgent = hasAgentData(sc.pages);
  let agent: AgentSection = {
    agentCards: [],
    agentFine: [],
    agentStatus: 'good',
    agentOverall: 0,
    agentAccessBlocked: false,
    agentBlocked: [],
    agentCouldNotMeasure: false,
  };
  if (hasAgent) {
    try {
      let agentViews = buildAgentPages(sc.pages, resultsDir);
      const agentPromptCtx: AgentPromptContext = {
        siteUrl: sc.url,
        host: agentPromptHost(sc.url, domain),
        date: agentPromptDate(dateStr, sc.generatedAt),
        conditions: agentPromptConditions(sc),
      };
      const siteSignals = await fetchSiteAccessSignals(sc.url);
      if (opts.summarizeAgent) {
        await enrichAgentSummaries(resultsDir, agentViews, siteSignals, opts.summarizeAgent);
        agentViews = buildAgentPages(sc.pages, resultsDir);
      }
      const isAgentBlocked = (view: AgentPageView): boolean =>
        typeof view.result.blocked === 'boolean'
          ? view.result.blocked
          : view.result.raw.likelyBlocked || looksLikeBotWall({ title: view.result.rendered?.title });
      const agentBlockedViews = agentViews.filter(isAgentBlocked);
      agent = buildAgentSection(
        agentViews.filter((view) => !isAgentBlocked(view)),
        agentBlockedViews.map((view) => ({ name: view.page.name, path: view.page.startingPath || '/' })),
        agentPromptCtx,
        siteSignals,
      );
    } catch (err) {
      console.warn(chalk.yellow(`shaka-perf: the AI visibility section failed to render, omitting it: ${(err as Error).message}`));
      hasAgent = false;
    }
  }

  const reportInput: ClientReportReportInput = {
    domain,
    dateStr,
    faviconLinkTag: faviconTag,
    measuredCount: ctx.measured.length,
    ...(ctx.avgMs !== undefined ? { avgMs: ctx.avgMs } : {}),
    avgLabel: ctx.avgLabel,
    slowCount: ctx.slowCount,
    jumpyCount: ctx.jumpyCount,
    footnoteThrottle: footnoteThrottlePhrase(perfPromptCtx.throttleProfile),
    perf,
    a11y,
    hasAgent,
    agent,
  };
  const facts = buildClientReportNarrativeFacts(reportInput);
  let overlay: NarrativeOverlay | null = null;
  if (opts.narrate) {
    overlay = readNarrativeOverlay(resultsDir);
    if (!overlay) {
      overlay = await opts.narrate(facts);
      if (overlay) writeNarrativeOverlay(resultsDir, overlay);
    }
  }
  return assembleClientReportModel(reportInput, overlay);
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
