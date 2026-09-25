/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { pipeAndFilterStderr } from './ffmpeg-stderr';
import { rendererMainThreadEvents } from './main-thread-tasks';
import type { RecordedInteraction } from './interaction-recorder';
import { SCREENCAST_FILENAME, SCREENCAST_START_FILENAME } from './lighthouse-config';
import {
  alignAnnotations,
  alignedMs,
  type SideAlignment,
  type TimelineAlignment,
} from './timeline-alignment';
import { decodeJpeg } from './decode-jpeg';

// Re-exported: this module was decodeJpeg's home before the frame matcher
// needed it too, and several callers import it from here.
export { decodeJpeg };
import { matchFrames, pairUnmatchedFrames, signFrames, type FrameMatch, type FramePair } from './frame-matching';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jpeg = require('jpeg-js') as { decode(buf: Buffer, opts?: { useTArray: boolean }): { width: number; height: number; data: Uint8Array } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pixelmatch = require('pixelmatch') as (img1: Uint8Array, img2: Uint8Array, output: Uint8Array | null, width: number, height: number, options?: { threshold?: number; diffMask?: boolean }) => number;

interface TraceEvent {
  cat: string;
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  // Process/thread ids — used to keep only the renderer main thread's RunTasks.
  pid?: number;
  tid?: number;
  // Async event correlation id (used to pair `performance.measure` begin/end
  // events, which Chrome emits as nestable-async `b`/`e` phases).
  id?: string | number;
  id2?: { local?: string; global?: string };
  args?: Record<string, any>;
}

interface TraceData {
  traceEvents: TraceEvent[];
}

export interface Screenshot {
  timeMs: number;
  dataUri: string;
  snapshot: Buffer; // raw JPEG bytes for pixel operations
  copiedForAnnotation?: boolean;
}

interface TimelineEvent {
  timeMs: number;
  label: string;
  category: 'paint' | 'user-timing' | 'layout-shift' | 'network-start' | 'network-end' | 'interaction';
  detail?: string;
  // Layout-shift specifics
  score?: number;
  cumulativeScore?: number;
  rects?: number[][];
  // Interaction specifics
  durationMs?: number;
  interactionType?: string;
  // LCP specifics
  isLcpFinal?: boolean;
  // network-end specifics: encoded bytes transferred
  sizeBytes?: number;
}

export interface ProfileData {
  screenshots: Screenshot[];
  events: TimelineEvent[];
  maxTimeMs: number;
  baseOrigin: string;
  viewport?: { width: number; height: number };
  // operationName query suffix (e.g. `?operationName="popmenuConfig"`) for each
  // same-origin `/graphql` request, in start-time order — the POST body isn't in
  // the trace, so this is read from the sibling network_activity.txt.
  graphqlOps?: string[];
  // Renderer main-thread timeline events (>= MIN_MAIN_TASK_MS) with their flame
  // depth, start-time order — the rich call tree behind the main-thread column.
  mainThreadEvents?: MainThreadEvent[];
}

// A single renderer-main-thread timeline event, navigation-relative, with the
// nesting depth (0 = top-level Task) used as its flame-chart lane and the raw
// trace `name` + a human detail (function/url/event type) for title and matching.
interface MainThreadEvent {
  name: string;
  startMs: number;
  durMs: number;
  depth: number;
  detail: string;
}

const PAINT_EVENTS = new Set([
  'firstPaint', 'firstContentfulPaint', 'largestContentfulPaint::Candidate',
]);

/** Correlation key pairing a `performance.measure` begin (`ph:'b'`) with its end
 *  (`ph:'e'`). Chrome scopes these by name + async id, so the same key matches
 *  the two halves of one measure even when measures overlap. */
function userTimingMeasureKey(e: TraceEvent): string {
  const id = e.id ?? e.id2?.local ?? e.id2?.global ?? '';
  return `${e.name}\u0000${id}`;
}

/** The network breakdown file that sits beside a saved profile (written by the
 *  same bench run). It's the only place `/graphql` POSTs carry their
 *  operationName, since the trace has no request body. */
function deriveNetworkActivityPath(profilePath: string): string {
  return profilePath.endsWith('_performance_profile.json')
    ? profilePath.replace(/_performance_profile\.json$/, '_network_activity.txt')
    : profilePath + '.network_activity.txt';
}

/**
 * Ordered operationName query suffixes for the `/graphql` requests, parsed from
 * network_activity.txt. Index N is the Nth same-origin `/graphql` request in
 * start-time order, so the timeline can label graphql bars with their operation
 * exactly as the network log does. Returns [] when the file is missing.
 */
function loadGraphqlOps(networkActivityPath: string): string[] {
  let text: string;
  try { text = readFileSync(networkActivityPath, 'utf-8'); } catch { return []; }
  const ops: string[] = [];
  for (const line of text.split('\n')) {
    // e.g. `[6.78 KB] /graphql?operationName="popmenuConfig"` — the URL
    // is the last whitespace-separated token (op names never contain spaces).
    const url = line.trim().split(/\s+/).pop() ?? '';
    const q = url.indexOf('?');
    const path = q === -1 ? url : url.slice(0, q);
    // Only exactly-`/graphql` (matches how saveNetworkActivity normalised them).
    if (path === '/graphql') ops.push(q === -1 ? '' : url.slice(q));
  }
  return ops;
}

export function parseProfile(filePath: string): ProfileData {
  const data: TraceData = JSON.parse(readFileSync(filePath, 'utf-8'));
  const events = data.traceEvents;

  const navStartEvent = events.find(e => e.name === 'navigationStart');
  const navStart = navStartEvent?.ts ?? 0;

  // Renderer main-thread flame; see rendererMainThreadEvents for what's kept and
  // how depth (the flame lane) is computed.
  const mainThreadEvents: MainThreadEvent[] = rendererMainThreadEvents(events).map(({ event: e, depth }) => ({
    name: e.name,
    startMs: Math.max(0, (e.ts - navStart) / 1000),
    durMs: e.dur! / 1000,
    depth,
    detail: mainThreadDetail(e),
  }));

  // Extract screenshots
  const screenshots: Screenshot[] = [];
  for (const e of events) {
    if (e.name === 'Screenshot' && e.cat?.includes('screenshot') && e.args?.snapshot) {
      screenshots.push({
        timeMs: Math.max(0, (e.ts - navStart) / 1000),
        dataUri: `data:image/jpeg;base64,${e.args.snapshot}`,
        snapshot: Buffer.from(e.args.snapshot, 'base64'),
      });
    }
  }
  screenshots.sort((a, b) => a.timeMs - b.timeMs);

  // Build requestId -> URL map for network finish events
  const requestUrls = new Map<string, string>();
  for (const e of events) {
    if (e.name === 'ResourceSendRequest' && e.args?.data?.requestId && e.args.data.url) {
      requestUrls.set(e.args.data.requestId, e.args.data.url);
    }
  }

  // Extract timeline events
  const timelineEvents: TimelineEvent[] = [];
  // Open `performance.measure` begins, keyed by name+id; an end pops the most
  // recent matching begin (LIFO, so nested measures pair correctly).
  const openMeasures = new Map<string, number[]>();
  for (const e of events) {
    const timeMs = Math.max(0, (e.ts - navStart) / 1000);

    if (PAINT_EVENTS.has(e.name)) {
      timelineEvents.push({ timeMs, label: e.name, category: 'paint' });
    } else if (e.cat?.includes('blink.user_timing')) {
      // User Timing has two shapes: instant *marks* (`performance.mark`,
      // phase 'R'/'I') and *measures* (`performance.measure`) that span a
      // range. Chrome emits a measure as a nestable-async begin/end pair
      // ('b'/'e'), or occasionally a single complete event ('X') with `dur`.
      // Marks stay points; measures become spans so e.g. `popmenu-hydration`
      // covers `…-start`→`…-end` instead of collapsing onto its start mark.
      if (e.ph === 'b') {
        const key = userTimingMeasureKey(e);
        const open = openMeasures.get(key);
        if (open) open.push(timeMs); else openMeasures.set(key, [timeMs]);
      } else if (e.ph === 'e') {
        const startMs = openMeasures.get(userTimingMeasureKey(e))?.pop();
        if (startMs != null) {
          timelineEvents.push({ timeMs: startMs, label: e.name, category: 'user-timing', durationMs: timeMs - startMs });
        }
      } else if (e.ph === 'X' && e.dur) {
        timelineEvents.push({ timeMs, label: e.name, category: 'user-timing', durationMs: e.dur / 1000 });
      } else {
        timelineEvents.push({ timeMs, label: e.name, category: 'user-timing' });
      }
    } else if (e.name === 'LayoutShift') {
      const score: number | undefined = e.args?.data?.score;
      const cumulativeScore: number | undefined = e.args?.data?.cumulative_score;
      const rawRects: unknown = e.args?.data?.region_rects;
      const rects = Array.isArray(rawRects)
        ? (rawRects as unknown[]).filter((r): r is number[] =>
            Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number'))
        : undefined;
      timelineEvents.push({
        timeMs,
        label: 'LayoutShift',
        category: 'layout-shift',
        detail: score != null ? `score=${score.toFixed(4)}` : undefined,
        score,
        cumulativeScore,
        rects,
      });
    } else if (e.name === 'ResourceSendRequest' && e.args?.data?.url) {
      timelineEvents.push({
        timeMs,
        label: e.args.data.url,
        category: 'network-start',
      });
    } else if (e.name === 'ResourceFinish' && e.args?.data?.requestId) {
      const url = requestUrls.get(e.args.data.requestId);
      if (url) {
        timelineEvents.push({
          timeMs,
          label: url,
          category: 'network-end',
          sizeBytes: typeof e.args.data.encodedDataLength === 'number' ? e.args.data.encodedDataLength : undefined,
        });
      }
    }
  }
  // Collect interactions (group EventTiming by interactionId > 0).
  const interactionGroups = new Map<number, {
    type: string;
    durationMs: number;
    timeMs: number;
  }>();
  for (const e of events) {
    if (e.name !== 'EventTiming') continue;
    const d = e.args?.data;
    const id: number = d?.interactionId ?? 0;
    if (id <= 0) continue;
    const dur: number = d?.duration ?? 0;
    const type: string = d?.type ?? 'event';
    const timeMs = Math.max(0, (e.ts - navStart) / 1000);
    const prev = interactionGroups.get(id);
    // Prefer 'click'/'keydown' type names over pointerdown/pointerup; keep max duration.
    const preferred = /^(click|keydown|keyup|tap|input)$/i.test(type);
    if (!prev) {
      interactionGroups.set(id, { type, durationMs: dur, timeMs });
    } else {
      const nextType = preferred ? type : prev.type;
      interactionGroups.set(id, {
        type: nextType,
        durationMs: Math.max(prev.durationMs, dur),
        timeMs: Math.min(prev.timeMs, timeMs),
      });
    }
  }
  for (const g of interactionGroups.values()) {
    timelineEvents.push({
      timeMs: g.timeMs,
      label: g.type,
      category: 'interaction',
      durationMs: g.durationMs,
      interactionType: g.type,
    });
  }

  timelineEvents.sort((a, b) => a.timeMs - b.timeMs);

  // Mark the LATEST largestContentfulPaint::Candidate as the final LCP.
  let lcpIndex = -1;
  for (let i = 0; i < timelineEvents.length; i++) {
    if (timelineEvents[i].category === 'paint' &&
        timelineEvents[i].label === 'largestContentfulPaint::Candidate') {
      lcpIndex = i;
    }
  }
  if (lcpIndex >= 0) timelineEvents[lcpIndex].isLcpFinal = true;

  // Extract CSS viewport from the trace (loading 'viewport' event).
  let viewport: { width: number; height: number } | undefined;
  for (const e of events) {
    if (e.name === 'viewport' && e.args?.data?.width && e.args?.data?.height) {
      viewport = { width: e.args.data.width, height: e.args.data.height };
      break;
    }
  }

  const allTimes = [
    ...screenshots.map(s => s.timeMs),
    ...timelineEvents.map(e => e.timeMs),
    ...mainThreadEvents.map(e => e.startMs + e.durMs),
  ];
  const maxTimeMs = allTimes.length > 0 ? Math.max(...allTimes) : 0;

  // Detect base origin from the first network request
  const firstUrl = timelineEvents.find(e => e.category === 'network-start')?.label;
  let baseOrigin = '';
  if (firstUrl) {
    try { baseOrigin = new URL(firstUrl).origin; } catch {}
  }

  const graphqlOps = loadGraphqlOps(deriveNetworkActivityPath(filePath));

  return { screenshots, events: timelineEvents, maxTimeMs, baseOrigin, viewport, graphqlOps, mainThreadEvents };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMs(ms: number): string {
  return Math.round(ms) + 'ms';
}

// Compute the minimum pxPerMs so screenshots never overlap in either column.
// Each screenshot occupies FRAME_HEIGHT + FRAME_GAP pixels vertically.
const FRAME_HEIGHT = 200;
const FRAME_GAP = 10;
const FRAME_SLOT = FRAME_HEIGHT + FRAME_GAP;

function minTimeDelta(screenshots: Screenshot[]): number {
  let minDelta = Infinity;
  for (let i = 1; i < screenshots.length; i++) {
    const delta = screenshots[i].timeMs - screenshots[i - 1].timeMs;
    if (delta > 0 && delta < minDelta) minDelta = delta;
  }
  return minDelta;
}

function computePxPerMs(control: ProfileData, experiment: ProfileData): number {
  const deltas = [
    minTimeDelta(control.screenshots),
    minTimeDelta(experiment.screenshots),
  ].filter(d => isFinite(d) && d > 0);

  if (deltas.length === 0) return 3; // neutral default

  const globalMinDelta = Math.min(...deltas);
  return Math.max(FRAME_SLOT / globalMinDelta, 0.5);
}



function encodePngDataUri(pixels: Uint8Array, width: number, height: number): string {
  const png = new PNG({ width, height });
  png.data = Buffer.from(pixels);
  const buf = PNG.sync.write(png);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/**
 * Per frame, a transparent PNG with every pixel that changed at all since the
 * previous frame painted red. Exact, like the dedupe, so on a deduped side
 * every frame after the first marks the pixels that got it kept. The encoding
 * is deterministic, so unchanged JPEG blocks decode identically and the red
 * stays within the blocks a repaint touched. null for the first frame and
 * after a size change: there is nothing to compare against.
 */
export function progressMaskDataUris(screenshots: readonly Screenshot[]): (string | null)[] {
  let previous: ReturnType<typeof decodeJpeg> | null = null;
  return screenshots.map((s) => {
    const current = decodeJpeg(s.snapshot);
    const before = previous;
    previous = current;
    if (!before || before.width !== current.width || before.height !== current.height) return null;
    const mask = new Uint8Array(current.width * current.height * 4);
    for (let p = 0; p < mask.length; p += 4) {
      if (
        before.data[p] !== current.data[p] ||
        before.data[p + 1] !== current.data[p + 1] ||
        before.data[p + 2] !== current.data[p + 2]
      ) {
        mask[p] = 255;
        mask[p + 3] = 255;
      }
    }
    return encodePngDataUri(mask, current.width, current.height);
  });
}

function computeFrameWidth(control: ProfileData, experiment: ProfileData): number {
  const first = control.screenshots[0] ?? experiment.screenshots[0];
  if (!first) return 120;
  const img = decodeJpeg(first.snapshot);
  return Math.round(img.width * FRAME_HEIGHT / img.height);
}

// Per-rectangle lane width in the tetris-packed strip. Narrow so a busy page
// (dozens of concurrent requests/events) still fits beside the screenshots, but
// wide enough for the vertical label text rendered inside each rectangle.
const NET_LANE_W = 14;

// Width of the middle column holding the match lines. Narrow: the lines carry
// no labels and no arrowheads, so the space is better spent on the frames.
const MATCH_COL_W = 64;

// Point-in-time events (paint marks, user timings, layout shifts, interactions)
// have no duration, so their rectangle gets a fixed pixel height — tall enough
// to show a few characters of vertical label before truncating. This height is
// deliberately NOT time-proportional (no `data-h`), so it stays readable at any
// zoom level while network spans grow/shrink with the timeline.
const MARKER_PX = 46;

// Every rectangle in the strip belongs to a category. Network requests are
// further split by resource kind so JS/CSS/fonts/images read as distinct
// colours at a glance. Colour is keyed purely off the category (NOT the
// individual URL), so the same kind of work is always the same colour.
type StripCategory =
  | 'net-js' | 'net-css' | 'net-font' | 'net-image' | 'net-document' | 'net-other'
  | 'paint' | 'user-timing' | 'layout-shift' | 'interaction'
  // Main-thread flame, bucketed like the DevTools performance panel: scripting,
  // rendering, painting, loading, GC, and plain Task. `long-task` is a top-level
  // Task >= LONG_TASK_MS (the blocking signal). All render in the main-thread column.
  | 'mt-task' | 'mt-scripting' | 'mt-rendering' | 'mt-painting' | 'mt-loading' | 'mt-gc' | 'long-task';

// Lane-packing weight per category, applied WITHIN each column (network and
// other events render in separate columns — see computeStripLayout). Heavier
// categories claim the lanes nearest the central diagram; lighter ones get
// pushed outward when they overlap in time. All network kinds weigh the same
// (ties break by start time); among the other markers the most semantically
// meaningful (paint, interactions) sit inside the noisier nav timings.
const STRIP_CATEGORY_WEIGHT: Record<StripCategory, number> = {
  'net-js': 100, 'net-css': 100, 'net-font': 100,
  'net-image': 100, 'net-document': 100, 'net-other': 100,
  paint: 60, interaction: 55, 'layout-shift': 45, 'user-timing': 30,
  // Main-thread flame lanes come from call-stack depth, not weighted packing, so
  // these weights are unused — present only to satisfy the category record.
  'mt-task': 0, 'mt-scripting': 0, 'mt-rendering': 0, 'mt-painting': 0,
  'mt-loading': 0, 'mt-gc': 0, 'long-task': 0,
};

// Category → rectangle background colour. All chosen mid-to-dark enough to carry
// white label text. Drives both the bars and the legend, so they never drift.
const STRIP_CATEGORY_COLOR: Record<StripCategory, string> = {
  'net-js': '#ca8a04', 'net-css': '#2563eb', 'net-font': '#db2777',
  'net-image': '#0d9488', 'net-document': '#4f46e5', 'net-other': '#64748b',
  paint: '#16a34a', 'user-timing': '#7c3aed', 'layout-shift': '#ea580c', interaction: '#0891b2',
  // DevTools-like flame palette: scripting amber, rendering purple, painting
  // green, loading blue, GC stone, plain Task grey, long task red.
  'mt-task': '#6b7280', 'mt-scripting': '#a16207', 'mt-rendering': '#7e22ce',
  'mt-painting': '#15803d', 'mt-loading': '#1d4ed8', 'mt-gc': '#78716c', 'long-task': '#dc2626',
};

// Legend rows (label shown to the user) in strip-display order.
const STRIP_LEGEND: readonly { cat: StripCategory; label: string }[] = [
  { cat: 'net-document', label: 'Document' }, { cat: 'net-js', label: 'JS' },
  { cat: 'net-css', label: 'CSS' }, { cat: 'net-font', label: 'Font' },
  { cat: 'net-image', label: 'Image' }, { cat: 'net-other', label: 'Other request' },
  { cat: 'paint', label: 'Paint' }, { cat: 'user-timing', label: 'Timing' },
  { cat: 'layout-shift', label: 'Layout shift' }, { cat: 'interaction', label: 'Interaction' },
  { cat: 'mt-task', label: 'Task' }, { cat: 'mt-scripting', label: 'Scripting' },
  { cat: 'mt-rendering', label: 'Rendering' }, { cat: 'mt-painting', label: 'Painting' },
  { cat: 'mt-loading', label: 'Loading' }, { cat: 'mt-gc', label: 'GC' },
  { cat: 'long-task', label: 'Long task (>50ms)' },
];

// A top-level main-thread Task at or above this duration is flagged as a "long
// task" (the standard 50ms blocking threshold), rendered in the long-task colour.
const LONG_TASK_MS = 50;

// Trace event name → DevTools-style display title for the main-thread flame.
const MAIN_THREAD_TITLES: Record<string, string> = {
  RunTask: 'Task', FunctionCall: 'Function Call', EvaluateScript: 'Evaluate Script',
  'v8.compile': 'Compile Script', TimerFire: 'Timer Fired', TimerInstall: 'Install Timer',
  TimerRemove: 'Remove Timer', FireAnimationFrame: 'Animation Frame Fired',
  RequestAnimationFrame: 'Request Animation Frame', EventDispatch: 'Event',
  RunMicrotasks: 'Run Microtasks', UpdateLayoutTree: 'Recalculate Style', Layout: 'Layout',
  Paint: 'Paint', PrePaint: 'Pre-Paint', Commit: 'Commit', Layerize: 'Layerize',
  UpdateLayer: 'Update Layer', CompositeLayers: 'Composite Layers', HitTest: 'Hit Test',
  ParseHTML: 'Parse HTML', ParseAuthorStyleSheet: 'Parse Stylesheet', XHRLoad: 'XHR Load',
  XHRReadyStateChange: 'XHR Ready State Change', MinorGC: 'Minor GC', MajorGC: 'Major GC',
  'IntersectionObserverController::computeIntersections': 'Compute Intersections',
};

/** DevTools-style title for a main-thread event name (raw name as fallback). */
function mainThreadTitle(name: string): string {
  if (MAIN_THREAD_TITLES[name]) return MAIN_THREAD_TITLES[name];
  if (name.startsWith('V8.GC') || name.includes('GC_') || name.includes('marking')) return 'GC';
  return name;
}

/** DevTools-style category bucket (drives the flame colour) for a main-thread
 *  event name. RunTask's long-task promotion is decided by the caller. */
function mainThreadCategory(name: string): StripCategory {
  if (name.startsWith('V8.GC') || name.includes('GC_') || name.includes('marking')) return 'mt-gc';
  if (/^(FunctionCall|EvaluateScript|v8\.|TimerFire|TimerInstall|TimerRemove|FireAnimationFrame|RequestAnimationFrame|EventDispatch|RunMicrotasks|XHR)/.test(name)) return 'mt-scripting';
  if (/^(Layout|UpdateLayoutTree|HitTest|PrePaint|InvalidateLayout|ScheduleStyleRecalculation|IntersectionObserver)/.test(name)) return 'mt-rendering';
  if (/^(Paint|Commit|Layerize|UpdateLayer|CompositeLayers|RasterTask|Decode|Draw)/.test(name)) return 'mt-painting';
  if (/^(ParseHTML|ParseAuthorStyleSheet|Resource)/.test(name)) return 'mt-loading';
  return 'mt-task';
}

/** Origin-relative `path:line` form of a script URL for a compact, matchable
 *  detail string. */
function shortScriptUrl(url: string): string {
  try { const u = new URL(url); return u.pathname + (u.search ?? ''); } catch { return url; }
}

/** Human, cross-side-stable detail for a main-thread event — the function name,
 *  script location, or event type — used in the title and the match key. */
function mainThreadDetail(e: TraceEvent): string {
  const d = e.args?.data;
  if (!d) return '';
  if (e.name === 'FunctionCall') {
    const fn = d.functionName || '(anonymous)';
    return d.url ? `${fn} ${shortScriptUrl(d.url)}:${d.lineNumber ?? ''}` : fn;
  }
  if (e.name === 'EvaluateScript' || e.name === 'v8.compile') {
    return d.url ? `${shortScriptUrl(d.url)}:${d.lineNumber ?? ''}` : '';
  }
  if (e.name === 'EventDispatch') return d.type ?? '';
  if (e.name === 'ParseHTML' || e.name === 'ParseAuthorStyleSheet') return d.url ? shortScriptUrl(d.url) : '';
  return '';
}

/** Classify a request URL into a network sub-category by file extension, so JS,
 *  CSS, fonts and images each render in their own colour. The navigation root
 *  (path `/`) and `.html` count as the document. */
function classifyNetworkResource(url: string): StripCategory {
  let pathname = url;
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { pathname = url.toLowerCase(); }
  const ext = pathname.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'net-js';
  if (ext === 'css') return 'net-css';
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'net-font';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'].includes(ext)) return 'net-image';
  if (['html', 'htm'].includes(ext) || pathname === '/' || pathname === '') return 'net-document';
  return 'net-other';
}

/** Network categories share the inner column (nearest the screenshots); every
 *  other marker category shares the separate outer "events" column. */
function isNetworkCategory(category: StripCategory): boolean {
  return category.startsWith('net-');
}

// Label for the synthetic group covering everything before the first test
// annotation — mirrors the audit annotated-timeline's `initial page load`.
const TIMELINE_GROUP_INITIAL_LABEL = 'initial page load';

interface TimelineGroupColor {
  accent: string;
  tint: string;
}

// Iterating accent + tint per annotation group. Adjacent timeline phases cycle
// the palette so they stay visually distinct; the leading `initial page load`
// group is index 0.
const TIMELINE_GROUP_PALETTE: readonly TimelineGroupColor[] = [
  { accent: '#2563eb', tint: 'rgba(37,99,235,0.07)' }, // blue
  { accent: '#16a34a', tint: 'rgba(22,163,74,0.07)' }, // green
  { accent: '#d97706', tint: 'rgba(217,119,6,0.08)' }, // amber
  { accent: '#9333ea', tint: 'rgba(147,51,234,0.07)' }, // purple
  { accent: '#dc2626', tint: 'rgba(220,38,38,0.07)' }, // red
  { accent: '#0891b2', tint: 'rgba(8,145,178,0.08)' }, // cyan
  { accent: '#db2777', tint: 'rgba(219,39,119,0.07)' }, // pink
  { accent: '#65a30d', tint: 'rgba(101,163,13,0.08)' }, // lime
];

interface TimelineAnnotationGroup {
  label: string;
  startMs: number;
  endMs: number;
  colorIndex: number;
}

/**
 * Partition a profile's timeline into annotation groups, the comparison-view
 * analogue of the audit timeline's `groupFramesByAnnotation`. Each
 * `test-annotation` (a `user-timing` event carrying `SHAKA_PERF_ANNOTATION_PREFIX`)
 * opens a group spanning from its time to the next annotation; frames before the
 * first annotation collapse into a synthetic `initial page load` group.
 * Annotations sharing a timestamp join into one `' · '` header label. Groups are
 * laid out per-side because control and experiment hit the same annotation at
 * different times.
 */
function buildAnnotationGroups(profile: ProfileData): TimelineAnnotationGroup[] {
  const byTime = new Map<number, string[]>();
  for (const e of profile.events) {
    if (e.category !== 'user-timing' || !e.label.startsWith(SHAKA_PERF_ANNOTATION_PREFIX)) continue;
    const label = e.label.slice(SHAKA_PERF_ANNOTATION_PREFIX.length);
    const arr = byTime.get(e.timeMs);
    if (arr) arr.push(label);
    else byTime.set(e.timeMs, [label]);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  if (times.length === 0) return [];
  const maxMs = Math.max(profile.maxTimeMs, times[times.length - 1]);
  const groups: TimelineAnnotationGroup[] = [];
  let colorIndex = 0;
  if (times[0] > 0) {
    groups.push({ label: TIMELINE_GROUP_INITIAL_LABEL, startMs: 0, endMs: times[0], colorIndex: colorIndex++ });
  }
  for (let i = 0; i < times.length; i++) {
    const startMs = times[i];
    const endMs = i + 1 < times.length ? times[i + 1] : maxMs;
    groups.push({ label: byTime.get(startMs)!.join(' · '), startMs, endMs, colorIndex: colorIndex++ });
  }
  return groups;
}

/** The test annotations of a profile as alignment points, one per group band
 *  (so annotations sharing a timestamp pair up as one joined label). */
function annotationPoints(profile: ProfileData): { label: string; timeMs: number }[] {
  return buildAnnotationGroups(profile)
    .filter(g => !(g.startMs === 0 && g.label === TIMELINE_GROUP_INITIAL_LABEL))
    .map(g => ({ label: g.label, timeMs: g.startMs }));
}

interface NetworkRequest {
  url: string;
  startMs: number;
  endMs: number;
  sizeBytes: number;
}

/**
 * Pair `network-start`/`network-end` events by URL into request spans. Requests
 * for the same URL are matched FIFO (a start is closed by the next end for that
 * URL). A start with no matching end (request still in flight at trace end) runs
 * to `maxTimeMs`. Returned sorted by start time so lane packing is deterministic.
 */
function buildNetworkRequests(profile: ProfileData): NetworkRequest[] {
  const openStarts = new Map<string, number[]>();
  const requests: NetworkRequest[] = [];
  for (const e of profile.events) {
    if (e.category === 'network-start') {
      const arr = openStarts.get(e.label);
      if (arr) arr.push(e.timeMs);
      else openStarts.set(e.label, [e.timeMs]);
    } else if (e.category === 'network-end') {
      const arr = openStarts.get(e.label);
      if (arr && arr.length > 0) {
        requests.push({ url: e.label, startMs: arr.shift()!, endMs: e.timeMs, sizeBytes: e.sizeBytes ?? 0 });
      }
    }
  }
  for (const [url, starts] of openStarts) {
    for (const startMs of starts) {
      requests.push({ url, startMs, endMs: profile.maxTimeMs, sizeBytes: 0 });
    }
  }
  requests.sort((a, b) => a.startMs - b.startMs);
  return requests;
}

// One rectangle in a side's tetris strip. Network requests are time-proportional
// spans (height grows with the timeline, so they scale on zoom); point markers
// get a fixed pixel height. `weight` drives lane placement (see assignStripLanes)
// and `key`/`idx` wire into the cross-side hover-highlight + click-to-jump JS.
interface StripRect {
  category: StripCategory;
  key: string;            // cross-side match key (origin-relative URL or event label)
  label: string;          // text rendered (vertically) inside the rectangle
  title: string;          // full tooltip shown on hover
  topMs: number;          // start time → vertical position
  endMs: number;          // end time (== topMs for point markers)
  heightPx: number;       // base pixel height of the rectangle
  timeProportional: boolean; // true → height scales with zoom (network spans)
  weight: number;         // lane-packing priority; heavier hugs the diagram
  // Inputs to the above-cursor counter (see the status panel script).
  kb?: number;            // network request: encoded size
  cls?: number;           // layout shift: score
  taskMs?: number;        // top-level main-thread task: duration
}

/** Origin-relative form of a URL/label, so `https://host/a.js` shows as `/a.js`. */
function originRelative(label: string, baseOrigin: string): string {
  return baseOrigin && label.startsWith(baseOrigin) ? label.slice(baseOrigin.length) : label;
}

/**
 * Build every strip rectangle for one profile: network requests as
 * time-proportional spans, plus all point events (paint marks, user timings,
 * layout shifts, interactions) as fixed-height markers. Annotation user-timings
 * are excluded — they render as full-height group bands instead.
 */
function buildStripRects(profile: ProfileData, pxPerMs: number): StripRect[] {
  const rects: StripRect[] = [];
  const graphqlOps = profile.graphqlOps ?? [];
  let graphqlSeen = 0;

  for (const r of buildNetworkRequests(profile)) {
    const category = classifyNetworkResource(r.url);
    let key = originRelative(r.url, profile.baseOrigin);
    // Same-origin `/graphql` POSTs all share the URL `/graphql`; the operationName
    // lives only in the POST body (read into profile.graphqlOps from the network
    // log). Assign ops to graphql requests in start order — buildNetworkRequests
    // is sorted by start time, same as the log — so the bar reads e.g.
    // `/graphql?operationName="popmenuConfig"` and the two sides match per op.
    if (key === '/graphql') key += graphqlOps[graphqlSeen++] ?? '';
    rects.push({
      category, key, label: key,
      title: `${key} · ${formatMs(r.startMs)}–${formatMs(r.endMs)} (${formatMs(r.endMs - r.startMs)})`,
      topMs: r.startMs,
      endMs: r.endMs,
      heightPx: Math.max(2, Math.round((r.endMs - r.startMs) * pxPerMs)),
      timeProportional: true,
      weight: STRIP_CATEGORY_WEIGHT[category],
      kb: r.sizeBytes / 1024,
    });
  }

  for (const e of profile.events) {
    if (e.category === 'network-start' || e.category === 'network-end') continue;
    if (e.category === 'user-timing' && isInternalMark(e.label)) continue;
    const category = e.category as StripCategory;
    const key = originRelative(e.label, profile.baseOrigin);
    const detail = e.detail ? ` (${e.detail})` : '';
    // Events carrying a duration (measures, interactions) render as a
    // time-proportional span from start to end; instant marks stay fixed-height
    // points. Spans scale on zoom (`timeProportional`); points don't.
    const hasSpan = e.durationMs != null && e.durationMs > 0;
    const endMs = hasSpan ? e.timeMs + e.durationMs! : e.timeMs;
    rects.push({
      category, key, label: `${key}${detail}`,
      title: hasSpan
        ? `${key}${detail} · ${formatMs(e.timeMs)}–${formatMs(endMs)} (${formatMs(e.durationMs!)})`
        : `${key}${detail} · ${formatMs(e.timeMs)}`,
      topMs: e.timeMs,
      endMs,
      heightPx: hasSpan ? Math.max(2, Math.round(e.durationMs! * pxPerMs)) : MARKER_PX,
      timeProportional: hasSpan,
      weight: STRIP_CATEGORY_WEIGHT[category] ?? 30,
      cls: e.category === 'layout-shift' ? e.score : undefined,
    });
  }
  return rects;
}

/**
 * Flame-chart layout for the renderer main thread: one time-proportional span per
 * timeline event, its lane fixed to the call-stack depth (not weighted packing),
 * so nested events render as a flame fanning outward from the centre. Each rect
 * is titled like DevTools ("Task", "Evaluate Script", "Function Call", …) with a
 * detail (function/script/event type) and timing in its hover tooltip; a
 * top-level Task >= LONG_TASK_MS is promoted to the red `long-task` colour. The
 * match key is title+detail so clicking jumps to the same logical event on the
 * other side.
 */
function buildMainThreadFlame(profile: ProfileData, pxPerMs: number): StripLayout {
  const rects: StripRect[] = [];
  const laneOf: number[] = [];
  let laneCount = 0;
  for (const e of profile.mainThreadEvents ?? []) {
    const isLongTask = e.name === 'RunTask' && e.depth === 0 && e.durMs >= LONG_TASK_MS;
    const category: StripCategory = isLongTask ? 'long-task' : mainThreadCategory(e.name);
    const title = mainThreadTitle(e.name);
    const label = e.detail ? `${title} · ${e.detail}` : title;
    const endMs = e.startMs + e.durMs;
    rects.push({
      category,
      key: e.detail ? `${title} ${e.detail}` : title,
      label,
      title: `${label} · ${formatMs(e.startMs)}–${formatMs(endMs)} (${formatMs(e.durMs)})`,
      topMs: e.startMs,
      endMs,
      heightPx: Math.max(2, Math.round(e.durMs * pxPerMs)),
      timeProportional: true,
      weight: 0,
      taskMs: e.name === 'RunTask' && e.depth === 0 ? e.durMs : undefined,
    });
    laneOf.push(e.depth);
    if (e.depth + 1 > laneCount) laneCount = e.depth + 1;
  }
  return { rects, laneOf, laneCount };
}

/**
 * Weighted tetris packing. Lane 0 is the lane nearest the central diagram;
 * lanes increase outward. Rectangles are placed heaviest-first (then by start
 * time), each dropping into the lowest lane whose previous rectangle has already
 * ended — so heavier categories (network) claim the inner lanes and lighter
 * markers get pushed outward wherever they overlap in time. Packing is done in
 * pixel space so fixed-height markers and time-proportional spans coexist.
 */
function assignStripLanes(rects: readonly StripRect[], pxPerMs: number): { laneOf: number[]; laneCount: number } {
  const topPx = rects.map(r => Math.round(r.topMs * pxPerMs));
  const botPx = rects.map((r, i) => topPx[i] + r.heightPx);
  const order = rects.map((_, i) => i).sort((a, b) =>
    rects[b].weight - rects[a].weight || topPx[a] - topPx[b]);

  const laneEnd: number[] = [];
  const laneOf = new Array<number>(rects.length);
  for (const i of order) {
    let lane = laneEnd.findIndex(end => end <= topPx[i]);
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(botPx[i]);
    } else {
      laneEnd[lane] = botPx[i];
    }
    laneOf[i] = lane;
  }
  return { laneOf, laneCount: laneEnd.length };
}

interface StripLayout {
  rects: StripRect[];
  laneOf: number[];
  laneCount: number;
}

/** Lay out one (already filtered) set of rectangles into weighted lanes. */
function layoutStrip(rects: StripRect[], pxPerMs: number): StripLayout {
  const { laneOf, laneCount } = assignStripLanes(rects, pxPerMs);
  return { rects, laneOf, laneCount };
}

interface SideStripLayout {
  net: StripLayout;
  mainThread: StripLayout;
  other: StripLayout;
}

/** Network, main-thread activity, and all other events render in separate
 *  columns, so each profile gets three independently lane-packed strips: `net`
 *  (inner, nearest the centre), `mainThread` (the CPU occupancy track), and
 *  `other` (the outer events column). Computed once per side and reused for both
 *  the column widths and the rectangle rendering. */
function computeStripLayout(profile: ProfileData, pxPerMs: number): SideStripLayout {
  const rects = buildStripRects(profile, pxPerMs);
  return {
    net: layoutStrip(rects.filter(r => isNetworkCategory(r.category)), pxPerMs),
    // Main-thread lanes are call-stack depth (computed in buildMainThreadFlame),
    // not weighted packing, so it skips layoutStrip.
    mainThread: buildMainThreadFlame(profile, pxPerMs),
    other: layoutStrip(rects.filter(r => !isNetworkCategory(r.category)), pxPerMs),
  };
}

// ── Frame annotations ──────────────────────────────────────────────────────
// Mirrors the audit annotated-timeline's in-frame overlays (see
// build_annotated_timeline/report.tsx `FrameOverlaySvg`): the same trace events
// the side strips show as bars are ALSO drawn directly on the screenshots — a
// green LCP pill on the LCP frame, red boxes + score pill over each layout
// shift's moved regions, and a blue pill for every click/interaction (with its
// INP duration). Test-annotation user-timings stay as the full-height group
// bands (see renderGroupBands), so they are not overlaid here.

type FrameAnnotationKind = 'lcp' | 'layout-shift' | 'interaction';

interface FrameOverlayAnnotation {
  kind: FrameAnnotationKind;
  label: string;
  rects?: number[][]; // layout-shift moved regions in CSS-viewport px ([x,y,w,h])
}

// Pill/box colour per kind — identical to the audit overlay so the two reports
// read the same: LCP green, layout-shift red, interaction blue.
const FRAME_ANNOTATION_FILL: Record<FrameAnnotationKind, string> = {
  lcp: '#16a34a', 'layout-shift': '#dc2626', interaction: '#2563eb',
};

/**
 * Bucket a profile's annotatable events onto its screenshot frames. LCP and
 * interactions attach to the nearest frame in time (the frame on screen when
 * they happened); a layout shift attaches to the first frame at/after it (the
 * frame that shows the post-shift layout, matching the audit's "next frame"
 * placement). Returns a map keyed by screenshot index.
 */
function buildFrameAnnotations(profile: ProfileData): Map<number, FrameOverlayAnnotation[]> {
  const out = new Map<number, FrameOverlayAnnotation[]>();
  const times = profile.screenshots.map(s => s.timeMs);
  if (times.length === 0) return out;

  const nearestFrame = (t: number): number => {
    let best = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const delta = Math.abs(times[i] - t);
      if (delta < bestDelta) { bestDelta = delta; best = i; }
    }
    return best;
  };
  const frameAtOrAfter = (t: number): number => {
    const i = times.findIndex(time => time >= t);
    return i === -1 ? times.length - 1 : i;
  };
  const add = (idx: number, ann: FrameOverlayAnnotation): void => {
    const arr = out.get(idx);
    if (arr) arr.push(ann); else out.set(idx, [ann]);
  };

  for (const e of profile.events) {
    if (e.isLcpFinal) {
      add(nearestFrame(e.timeMs), { kind: 'lcp', label: 'LCP' });
    } else if (e.category === 'layout-shift') {
      const label = e.score != null ? `Layout Shift ${e.score.toFixed(3)}` : 'Layout Shift';
      add(frameAtOrAfter(e.timeMs), { kind: 'layout-shift', label, rects: e.rects });
    } else if (e.category === 'interaction') {
      const inp = e.durationMs != null ? ` ${Math.round(e.durationMs)}ms` : '';
      add(nearestFrame(e.timeMs), { kind: 'interaction', label: `${e.interactionType ?? e.label}${inp}` });
    }
  }
  return out;
}

/** Decoded pixel size of a profile's frames (all frames share the capture
 *  dimensions). Only the fallback overlay viewBox when the trace carried no CSS
 *  viewport — layout-shift rects are in CSS-viewport px, not these (downscaled)
 *  capture px. Returns {0,0} when there are no frames (overlay renders empty). */
function frameNaturalSize(profile: ProfileData): { width: number; height: number } {
  const first = profile.screenshots[0];
  if (!first) return { width: 0, height: 0 };
  const { width, height } = decodeJpeg(first.snapshot);
  return { width, height };
}

/**
 * One frame's annotation overlay as an SVG whose viewBox is the CSS viewport
 * (`vbW`×`vbH`) — the coordinate space layout-shift rects live in — stretched
 * over the displayed image with `preserveAspectRatio="none"`, so the boxes land
 * regardless of the screenshot JPEG's (downscaled) resolution. Draws the
 * layout-shift region boxes first, then the stacked top-left pills — the same
 * geometry and colours as the audit `FrameOverlaySvg`.
 */
function renderFrameOverlay(
  annotations: FrameOverlayAnnotation[] | undefined,
  vbW: number,
  vbH: number,
): string {
  if (!annotations || annotations.length === 0 || vbW <= 0 || vbH <= 0) return '';
  const fontSize = Math.max(10, Math.round(vbW * 0.045));
  const pillH = Math.round(fontSize * 1.3);
  const pillPad = Math.max(2, Math.round(fontSize * 0.4));
  const chipInset = Math.min(20, Math.max(4, Math.round(vbW * 0.04)));
  const chipGap = Math.max(2, Math.round(fontSize * 0.2));

  const boxes = annotations
    .flatMap(a => (a.kind === 'layout-shift' ? a.rects ?? [] : []))
    .map(r => `<rect x="${r[0] ?? 0}" y="${r[1] ?? 0}" width="${r[2] ?? 0}" height="${r[3] ?? 0}" fill="rgba(220,38,38,0.28)" stroke="#dc2626" stroke-width="2"/>`)
    .join('');

  const pills = annotations.map((a, i) => {
    const fill = FRAME_ANNOTATION_FILL[a.kind];
    const pillY = chipInset + i * (pillH + chipGap);
    const textW = a.label.length * fontSize * 0.6 + pillPad * 2;
    const pillW = Math.max(1, Math.min(vbW - chipInset * 2, textW));
    const baselineY = pillY + (pillH - fontSize) / 2 + fontSize * 0.8;
    // Wrap in a <g> with pointer-events re-enabled (the overlay itself is
    // pointer-events:none so it never blocks the frame) carrying a <title>, so
    // hovering the chip shows the full label natively even when it's clipped to
    // the frame width.
    return `<g pointer-events="auto"><title>${escapeHtml(a.label)}</title>`
      + `<rect x="${chipInset}" y="${pillY}" width="${pillW}" height="${pillH}" rx="2" ry="2" fill="${fill}"/>`
      + `<text x="${chipInset + pillPad}" y="${baselineY}" font-family="ui-monospace, monospace" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeHtml(a.label)}</text>`
      + `</g>`;
  }).join('');

  return `<svg class="frame-overlay" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none">${boxes}${pills}</svg>`;
}

function buildTimelineHtml(
  control: ProfileData,
  experiment: ProfileData,
  alignment: TimelineAlignment,
  matches: readonly FrameMatch[],
  mismatches: readonly FramePair[],
): string {
  // A line's end is usually a frame, but across a one-sided gap it sits between
  // two of them, so the index can be fractional and the time reads the same way.
  const frameTimeAt = (frames: readonly Screenshot[], index: number): number => {
    const low = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
    const high = Math.max(0, Math.min(frames.length - 1, Math.ceil(index)));
    return frames[low].timeMs + (frames[high].timeMs - frames[low].timeMs) * (index - low);
  };
  // Every line in the middle column: the frames showing the same state
  // (green) and, between them, the leftovers each side paired in order (red).
  const connections = [
    ...matches.map((m) => ({
      c: m.controlIndex, e: m.experimentIndex, d: Math.round(m.deltaMs), k: 'match',
    })),
    ...mismatches.map((p) => ({
      c: p.controlIndex,
      e: p.experimentIndex,
      d: Math.round(
        frameTimeAt(experiment.screenshots, p.experimentIndex)
        - frameTimeAt(control.screenshots, p.controlIndex),
      ),
      k: 'mismatch',
    })),
  ];
  const maxTimeMs = Math.max(control.maxTimeMs, experiment.maxTimeMs, 1);
  const pxPerMs = computePxPerMs(control, experiment);
  const totalHeight = Math.ceil(maxTimeMs * pxPerMs) + FRAME_HEIGHT + 50;
  const alignedMaxTimeMs = Math.max(
    alignedMs(alignment.control, control.maxTimeMs),
    alignedMs(alignment.experiment, experiment.maxTimeMs),
    1,
  );
  const alignedTotalHeight = Math.ceil(alignedMaxTimeMs * pxPerMs) + FRAME_HEIGHT + 50;
  const frameWidth = computeFrameWidth(control, experiment);

  // Every positioned element carries its raw-time `top` in the inline style
  // and, where the aligned view moves it, the aligned position in `data-atop`
  // (plus the aligned height in `data-ah` for time-proportional spans, which
  // stretch when they straddle a shifted annotation). The zoom script reads
  // whichever set the "align test annotations" checkbox selects.
  function alignedAttrs(
    side: 'control' | 'experiment',
    startMs: number,
    endMs: number,
    rawTop: number,
    rawH: number | null,
  ): string {
    const sideAlignment = alignment[side];
    const top = Math.round(alignedMs(sideAlignment, startMs) * pxPerMs);
    let attrs = top !== rawTop ? ` data-atop="${top}"` : '';
    if (rawH != null) {
      const span = alignedMs(sideAlignment, endMs) - alignedMs(sideAlignment, startMs);
      const h = Math.max(2, Math.round(span * pxPerMs));
      if (h !== rawH) attrs += ` data-ah="${h}"`;
    }
    return attrs;
  }

  function renderScreenshots(side: 'control' | 'experiment', profile: ProfileData): string {
    const annotations = buildFrameAnnotations(profile);
    // Layout-shift region_rects are in CSS-viewport pixels, so the overlay
    // viewBox must be the CSS viewport. The trace screenshot JPEGs are downscaled
    // (e.g. 230x498 for a 390x844 viewport), so using their pixel size would push
    // every box off-position. Fall back to the decoded JPEG size only when the
    // trace carried no viewport event.
    const natural = frameNaturalSize(profile);
    const viewBoxW = profile.viewport?.width ?? natural.width;
    const viewBoxH = profile.viewport?.height ?? natural.height;
    const progressMasks = progressMaskDataUris(profile.screenshots);
    return profile.screenshots.map((s, i) => {
      const top = Math.round(s.timeMs * pxPerMs);
      const overlay = renderFrameOverlay(annotations.get(i), viewBoxW, viewBoxH);
      const mask = progressMasks[i];
      const progress = mask ? `<span class="progress-overlay" style="background-image:url('${mask}')"></span>` : '';
      return `<div class="screenshot-entry" data-frame-idx="${i}" data-side="${side}"${alignedAttrs(side, s.timeMs, s.timeMs, top, null)} style="top:${top}px">
        <span class="ts-label">${formatMs(s.timeMs)}</span>
        <span class="frame-wrap"><img src="${s.dataUri}" />${progress}${overlay}</span>
      </div>`;
    }).join('\n');
  }

  // One line per connected pair, matched or not. The paths are empty here:
  // their endpoints are the vertical centres of two frame entries, whose
  // heights depend on the rendered image, so the browser measures them (see
  // drawArrows in the script below).
  function renderMatchArrows(): string {
    return `<svg class="match-arrows" id="match-arrows">`
      + `<rect class="match-arrows-surface" x="0" y="0" width="100%" height="100%"></rect>`
      + `<g id="match-arrow-paths"></g></svg>`;
  }

  // The stretch a side spent waiting for the other to reach the same
  // annotation. Positioned in aligned time, so it is only ever shown in the
  // aligned view.
  function renderWaitBoxes(side: 'control' | 'experiment'): string {
    return alignment[side].gaps.map(g => {
      const top = Math.round(g.startMs * pxPerMs);
      const height = Math.max(0, Math.round((g.endMs - g.startMs) * pxPerMs));
      return `<div class="wait-box aligned-only" data-h="${height}" style="top:${top}px;height:${height}px"><span>waiting for the other side · ${formatMs(g.endMs - g.startMs)}</span></div>`;
    }).join('\n');
  }

  // Every event — network requests and point markers alike — renders as a
  // tetris-packed coloured rectangle, with its label written vertically inside
  // and the full text in the hover tooltip. Each side has three strips: network
  // activity (the inner column, nearest the screenshots), the main-thread flame
  // (lanes = call-stack depth), and all other events (the outer column);
  // renderStrip draws one. Colour is by category
  // (network sub-typed by resource kind). Lane 0 is the lane nearest the central
  // diagram. Each strip is anchored to its diagram-facing edge — control strips
  // (left of the screenshots) anchor bars by `right`, experiment strips (right of
  // the screenshots) by `left` — so lane 0 always hugs the centre no matter how
  // wide the column is. That lets each paired column share one width and keep the
  // diagram symmetric/centred.
  // data-key/data-idx/data-side wire into the cross-side highlight + jump JS.
  function renderStrip(side: 'control' | 'experiment', kind: 'net' | 'main' | 'other', layout: StripLayout): string {
    const { rects, laneOf } = layout;
    const anchor = side === 'control' ? 'right' : 'left';
    const keyCounts = new Map<string, number>();
    return rects.map((r, i) => {
      const idx = keyCounts.get(r.key) ?? 0;
      keyCounts.set(r.key, idx + 1);
      const offset = laneOf[i] * NET_LANE_W;
      const top = Math.round(r.topMs * pxPerMs);
      // Only time-proportional spans carry data-h, so the zoom JS scales their
      // height; fixed-height markers keep their pixel height at every zoom.
      const dataH = r.timeProportional ? ` data-h="${r.heightPx}"` : '';
      const aligned = alignedAttrs(side, r.topMs, r.endMs, top, r.timeProportional ? r.heightPx : null);
      const counted = (r.kb != null ? ` data-kb="${r.kb.toFixed(2)}"` : '') +
        (r.cls != null ? ` data-cls="${r.cls}"` : '') +
        (r.taskMs != null ? ` data-task="${r.taskMs.toFixed(1)}"` : '');
      return `<div class="net-bar cat-${r.category}"${dataH}${aligned} data-kind="${kind}"${counted} data-key="${escapeHtml(r.key)}" data-idx="${idx}" data-side="${side}" title="${escapeHtml(r.title)}" style="top:${top}px;height:${r.heightPx}px;${anchor}:${offset}px;width:${NET_LANE_W - 1}px;background:${STRIP_CATEGORY_COLOR[r.category]};">${escapeHtml(r.label)}</div>`;
    }).join('\n');
  }

  // Annotation group bands tint each side's screenshot column per timeline phase
  // (the comparison-view counterpart of the audit timeline's colour-coded
  // sections). The accent border + chip sit on the screenshot-facing inner edge.
  // A band keeps its raw height in the aligned view: the wait for the other
  // side sits just before the band's own annotation, outside the band.
  function renderGroupBands(side: 'control' | 'experiment', profile: ProfileData): string {
    return buildAnnotationGroups(profile).map(g => {
      const color = TIMELINE_GROUP_PALETTE[g.colorIndex % TIMELINE_GROUP_PALETTE.length]!;
      const top = Math.round(g.startMs * pxPerMs);
      const height = Math.max(0, Math.round((g.endMs - g.startMs) * pxPerMs));
      const aligned = alignedAttrs(side, g.startMs, g.startMs, top, null);
      return `<div class="group-band" data-h="${height}"${aligned} style="top:${top}px;height:${height}px;background:${color.tint};--accent:${color.accent};">
        <span class="group-chip" style="background:${color.accent}" title="${escapeHtml(g.label)}">${escapeHtml(g.label)}</span>
      </div>`;
    }).join('\n');
  }

  // Strip layout (rectangles + weighted lane assignment) is computed once per
  // side — split into network, main-thread, and other-events strips — and reused
  // for both the column widths and the rectangles themselves.
  const controlStrip = computeStripLayout(control, pxPerMs);
  const experimentStrip = computeStripLayout(experiment, pxPerMs);
  // The network and other-events columns each share one width across both sides
  // (the wider side's), so the central diagram stays symmetric and centres in the
  // viewport regardless of how the two sides' lane counts differ. Each strip hugs
  // its diagram-facing edge (see renderStrip), so the shared width only pads the
  // outer side.
  const netColW = Math.max(controlStrip.net.laneCount, experimentStrip.net.laneCount) * NET_LANE_W;
  const mainColW = Math.max(controlStrip.mainThread.laneCount, experimentStrip.mainThread.laneCount) * NET_LANE_W;
  const otherColW = Math.max(controlStrip.other.laneCount, experimentStrip.other.laneCount) * NET_LANE_W;
  // 9-col grid: other | main-thread | network | screenshot | match | screenshot |
  // network | main-thread | other. Network sits innermost (nearest the
  // screenshots), then the main-thread occupancy track, then the event markers.
  const gridColumns = `${otherColW}px ${mainColW}px ${netColW}px ${frameWidth}px ${MATCH_COL_W}px ${frameWidth}px ${netColW}px ${mainColW}px ${otherColW}px`;
  // Total grid width. The legend is given this exact width and centred the same
  // way (margin: 0 auto), so its centre tracks the diff column / screenshots even
  // when the grid is wider than the viewport (where `margin:auto` collapses to 0
  // and the diagram is no longer at the page centre).
  const timelineWidthPx = otherColW * 2 + mainColW * 2 + netColW * 2 + frameWidth * 2 + MATCH_COL_W;

  // Legend chips so the category colours are self-explanatory.
  const legendHtml = STRIP_LEGEND.map(({ cat, label }) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${STRIP_CATEGORY_COLOR[cat]}"></span>${escapeHtml(label)}</span>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Timeline Comparison: Control vs Experiment</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff;
    color: #1a1d22;
    /* Bottom slack so the last rows can be scrolled up clear of the tally
       chips, which sit at the bottom of the window when the cursor is low. */
    padding: 20px 20px 60vh;
  }
  h1 { text-align: center; color: #111; margin-bottom: 8px; font-size: 20px; }
  /* Floats above the sticky header so it stays reachable anywhere down the
     (very tall) timeline. */
  .controls {
    position: fixed;
    top: 12px;
    right: 16px;
    z-index: 20;
    background: rgba(255, 255, 255, 0.97);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    padding: 6px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    display: flex;
    gap: 14px;
  }
  .controls label { cursor: pointer; color: #1a1d22; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
  .controls label:has(input:disabled) { cursor: default; color: #9ca3af; }
  /* Live tally of everything between the baseline and the mouse cursor: one
     line per side, pinned to the right screen edge and sitting just BELOW the
     cursor so it never covers it. Hidden until the cursor first enters the
     timeline. */
  .status-chip {
    position: fixed;
    top: 0;
    z-index: 20;
    display: none;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.97);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    padding: 3px 9px;
    font-family: ui-monospace, 'SF Mono', Monaco, monospace;
    font-size: 11px;
    color: #1a1d22;
    pointer-events: none;
  }
  body.status-live .status-chip { display: block; }
  /* Both on the right, experiment above control, so they stack clear of the
     cursor and each gets the full window width. */
  .status-chip { right: 8px; max-width: calc(100vw - 16px); overflow: hidden; text-overflow: ellipsis; }
  .status-chip .side { font-weight: 700; margin-right: 7px; }
  .status-chip.control .side { color: #2563eb; }
  .status-chip.experiment .side { color: #dc2626; }

  /* The click-set baseline. Everything the chips count starts here instead of
     at 0 ms; without one they count from the top of the timeline. */
  .baseline-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px dashed #111;
    z-index: 8;
    pointer-events: none;
    display: none;
  }
  body.has-baseline .baseline-line { display: block; }
  .baseline-label {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    /* The line itself ignores the mouse; its label takes the reset click. */
    pointer-events: auto;
    /* Left edge, not centred: the line spans the whole grid, which is far
       wider than the window, so a centred label sits off-screen. */
    left: 8px;
    transform: translateY(-100%);
    background: #111;
    color: #ffffff;
    font-family: ui-monospace, 'SF Mono', Monaco, monospace;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .baseline-clear {
    cursor: pointer;
    font-weight: 700;
    opacity: 0.75;
  }
  .baseline-clear:hover { opacity: 1; }

  .timeline-container {
    display: grid;
    grid-template-columns: ${gridColumns};
    gap: 0;
    width: fit-content;
    margin: 0 auto;
    position: relative;
  }
  .header-row {
    display: grid;
    grid-template-columns: ${gridColumns};
    gap: 0;
    width: fit-content;
    margin: 0 auto;
    position: sticky;
    top: 0;
    z-index: 10;
    background: #ffffff;
  }
  .col-header {
    text-align: center;
    font-weight: bold;
    padding: 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .col-header.net { color: #475569; font-size: 9px; letter-spacing: 0.5px; align-self: end; }
  .col-header.other-control { grid-column: 1; }
  .col-header.main-control { grid-column: 2; }
  .col-header.net-control { grid-column: 3; }
  .col-header.control { color: #2563eb; grid-column: 4; }
  .col-header.arrows { color: #6b7280; grid-column: 5; }
  .col-header.experiment { color: #dc2626; grid-column: 6; }
  .col-header.net-experiment { grid-column: 7; }
  .col-header.main-experiment { grid-column: 8; }
  .col-header.other-experiment { grid-column: 9; }

  .screenshot-col {
    position: relative;
    height: ${totalHeight}px;
  }

  .net-col {
    position: relative;
    height: ${totalHeight}px;
    overflow: hidden;
  }
  /* Alternating column shades so it's clear which strip a bar belongs to. Per
     side the three strips read other / main / net → shade A / B / A (and the
     matching headers carry the same tint). Kept faint so the coloured bars and
     their labels stay legible on top. */
  .net-col.col-other, .net-col.col-net,
  .col-header.other-control, .col-header.other-experiment,
  .col-header.net-control, .col-header.net-experiment { background: #f4f6f9; }
  .net-col.col-main,
  .col-header.main-control, .col-header.main-experiment { background: #e6ebf1; }
  /* Every strip rectangle. The label is written top-to-bottom inside the bar
     and truncated with an ellipsis where it overflows the bar's height; the
     full text lives in the native title tooltip on hover. */
  .net-bar {
    position: absolute;
    border-radius: 2px;
    opacity: 0.9;
    writing-mode: vertical-rl;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 9px;
    line-height: ${NET_LANE_W - 2}px;
    font-weight: 600;
    color: #ffffff;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
    padding: 2px 0;
    cursor: pointer;
  }
  .net-bar:hover { opacity: 1; }
  .net-bar.highlight { box-shadow: 0 0 0 2px #111; z-index: 6; opacity: 1; }

  /* Annotation group bands tint the screenshot column behind the frames; the
     accent border + chip sit on the inner edge (toward the diff column). */
  .group-band {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    pointer-events: none;
  }
  .screenshot-col.control .group-band { border-right: 3px solid var(--accent); }
  .screenshot-col.experiment .group-band { border-left: 3px solid var(--accent); }
  .group-chip {
    position: absolute;
    top: 2px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 700;
    color: #ffffff;
    padding: 1px 6px;
    border-radius: 3px;
    max-width: calc(100% - 8px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    z-index: 5;
  }
  .screenshot-col.control .group-chip { right: 4px; }
  .screenshot-col.experiment .group-chip { left: 4px; }

  /* Aligned view: the earlier side's wait for the other side, drawn in the
     frames column. Sits under the frames (z-index 0) because the frame just
     before the annotation may hang down into the gap; the label hugs the
     bottom edge, which the next frame never covers. */
  .wait-box {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 6px 6px;
    background: #e5e7eb;
    border: 1px dashed #9ca3af;
    border-radius: 3px;
    color: #6b7280;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    overflow: hidden;
    pointer-events: none;
  }
  .wait-box span { text-align: center; line-height: 1.25; }
  body:not(.aligned) .aligned-only { display: none; }
  body.aligned .raw-only { display: none; }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
    /* Width matches the grid and centres the same way, so the legend's centre
       lines up with the diff column / screenshots (not just the viewport). */
    width: ${timelineWidthPx}px;
    margin: 0 auto 16px;
    font-size: 11px;
    color: #475569;
  }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }

  /* Each frame spans the full column width and is centred horizontally, so a
     frame the max-height constraint shrinks narrower than the column still sits
     in the middle rather than against one edge. */
  .screenshot-entry {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 1;
    text-align: center;
  }
  /* Frames hidden under later overlapping frames bump to the front on hover. */
  .screenshot-entry:hover { z-index: 100; }
  .screenshot-entry:hover img { box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }
  .screenshot-entry img {
    max-width: 100%;
    max-height: ${FRAME_HEIGHT}px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    display: block;
    margin: 0 auto;
  }
  /* The lines joining each control frame to the experiment frame showing the
     same page state. The column sits under the frames (which lift to z-index
     100 on hover) so a hovered frame is never cut by a line. */
  .match-arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    z-index: 0;
  }
  .match-arrow { fill: none; stroke-width: 1; opacity: 0.75; }
  /* Green joins the frames showing the same state; red joins the leftovers
     between two such pairs, which no frame on the other side matches. */
  .match-arrow.match { stroke: #16a34a; }
  .match-arrow.mismatch { stroke: #dc2626; }
  .match-arrow-hit { fill: none; stroke: transparent; stroke-width: 12; cursor: pointer; }
  /* Catches the cursor in the gaps between lines, where the scrub line lives. */
  .match-arrows-surface { fill: transparent; pointer-events: all; }
  .scrub-line { fill: none; stroke: #64748b; stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.9; pointer-events: none; }
  .arrow-kind-label { pointer-events: none; }
  .match-arrow.active { stroke-width: 2.5; opacity: 1; }
  .arrow-kind-label { font: 700 9px system-ui, sans-serif; letter-spacing: 0.04em; paint-order: stroke; stroke: rgba(255, 255, 255, 0.9); stroke-width: 3; }
  .arrow-kind-label.match { fill: #15803d; }
  .arrow-kind-label.mismatch { fill: #b91c1c; }
  /* Hovering a connection lifts both of its frames above their neighbours,
     the same way hovering a frame itself does. */
  .screenshot-entry.matched { z-index: 100; }
  .screenshot-entry.matched img { outline: 2px solid #2563eb; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }
  .screenshot-col.experiment .screenshot-entry.matched img { outline-color: #dc2626; }

  /* The frame and its annotation overlay share a shrink-to-fit positioned
     wrapper, so the SVG (stretched edge-to-edge) lines its pixel-space viewBox
     up with the displayed image. line-height:0 drops the inline descender gap
     so the wrapper matches the image box exactly. */
  .frame-wrap {
    position: relative;
    display: inline-block;
    /* 5px gap so the annotation-stage group-band tint + accent edge show around
       the frame instead of being hidden under it. calc keeps the frame plus its
       margins inside the column width. */
    margin: 5px;
    max-width: calc(100% - 10px);
    line-height: 0;
  }
  /* Inset by the frame's 1px border so the mask covers the picture only. */
  .progress-overlay {
    position: absolute;
    inset: 1px;
    background-size: 100% 100%;
    pointer-events: none;
    display: none;
  }
  body.show-progress .progress-overlay { display: block; }
  .frame-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .screenshot-entry .ts-label {
    font-size: 10px;
    color: #6b7280;
    font-family: 'SF Mono', Monaco, monospace;
  }

  [data-key] { cursor: pointer; }
  .toast {
    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: rgba(255, 255, 255, 0.97); color: #1a1d22; padding: 12px 24px;
    border-radius: 10px; font-size: 13px; z-index: 100;
    backdrop-filter: blur(8px); border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    animation: toast-in 0.25s ease-out forwards;
  }
  .toast.dismissing {
    animation: toast-out 0.3s ease-in forwards;
  }
  .toast .toast-key { color: #dc2626; font-weight: 600; }
  .toast .toast-side { color: #2563eb; font-weight: 600; }
  .toast .toast-idx { color: #7c3aed; }
  @keyframes toast-in { to { transform: translateX(-50%) translateY(0); opacity: 1; } }
  @keyframes toast-out { to { transform: translateX(-50%) translateY(-10px); opacity: 0; } }


</style>
</head>
<body>
  <h1>Timeline Comparison</h1>
  <div style="text-align:center;color:#666;font-size:12px;margin-bottom:12px;line-height:1.8">
    Ctrl + Mouse Wheel to zoom<br>
    Hover a rectangle for its full label · Click one to jump to the matching event on the other side<br>
    Click anywhere else to measure from there instead of 0ms · its &times; or Esc resets
  </div>
  <div class="controls">
    <label title="${alignment.pairCount === 0
      ? 'no test annotation is shared by both sides'
      : 'shift the side that reached each test annotation earlier so both sides line up there'}">
      <input type="checkbox" id="align-annotations"${alignment.pairCount === 0 ? ' disabled' : ''}>align test annotations
    </label>
    <label title="paint the pixels that changed since the previous frame red">
      <input type="checkbox" id="highlight-progress">highlight progress
    </label>
  </div>
  ${(['control', 'experiment'] as const).map(side =>
    `<div class="status-chip ${side}" id="status-${side}"><span class="side">${side}</span><span class="metrics"></span></div>`
  ).join('\n  ')}
  <div class="legend">${legendHtml}</div>

  <div class="header-row">
    <div class="col-header net other-control">Events</div>
    <div class="col-header net main-control">Main thread</div>
    <div class="col-header net net-control">Network</div>
    <div class="col-header control">Control</div>
    <div class="col-header arrows">Match</div>
    <div class="col-header experiment">Experiment</div>
    <div class="col-header net net-experiment">Network</div>
    <div class="col-header net main-experiment">Main thread</div>
    <div class="col-header net other-experiment">Events</div>
  </div>

  <div class="timeline-container">
    <div class="baseline-line" id="baseline-line"><span class="baseline-label"><span id="baseline-text"></span><span class="baseline-clear" id="baseline-clear" title="reset the baseline to 0ms">&times;</span></span></div>
    <div class="net-col control col-other">
      ${renderStrip('control', 'other', controlStrip.other)}
    </div>
    <div class="net-col control col-main">
      ${renderStrip('control', 'main', controlStrip.mainThread)}
    </div>
    <div class="net-col control col-net">
      ${renderStrip('control', 'net', controlStrip.net)}
    </div>
    <div class="screenshot-col control">
      ${renderGroupBands('control', control)}
      ${renderWaitBoxes('control')}
      ${renderScreenshots('control', control)}
    </div>
    <div class="screenshot-col arrows">
      ${renderMatchArrows()}
    </div>
    <div class="screenshot-col experiment">
      ${renderGroupBands('experiment', experiment)}
      ${renderWaitBoxes('experiment')}
      ${renderScreenshots('experiment', experiment)}
    </div>
    <div class="net-col experiment col-net">
      ${renderStrip('experiment', 'net', experimentStrip.net)}
    </div>
    <div class="net-col experiment col-main">
      ${renderStrip('experiment', 'main', experimentStrip.mainThread)}
    </div>
    <div class="net-col experiment col-other">
      ${renderStrip('experiment', 'other', experimentStrip.other)}
    </div>
  </div>

  <script>
    (function() {
      const MAX_SCALE = 20;
      const RAW_HEIGHT = ${totalHeight};
      const ALIGNED_HEIGHT = ${alignedTotalHeight};
      var aligned = false;
      var BASE_HEIGHT = RAW_HEIGHT;
      var viewportH = window.innerHeight;
      var MIN_SCALE = Math.min(0.1, viewportH / BASE_HEIGHT);
      var scale = Math.max(MIN_SCALE, Math.min(1, (2 * viewportH) / BASE_HEIGHT));

      // Collect all positioned elements and their original top values. Net bars
      // and group bands also carry a time-proportional height (data-h) that must
      // scale with the timeline; screenshots keep their intrinsic pixel height.
      // data-atop / data-ah hold the aligned-view position and height where
      // they differ from the raw ones.
      const positioned = [];
      document.querySelectorAll('.screenshot-entry, .net-bar, .group-band, .wait-box').forEach(function(el) {
        var top = parseFloat(el.style.top);
        var h = el.dataset.h ? parseFloat(el.dataset.h) : null;
        positioned.push({
          el: el, top: top, h: h,
          atop: el.dataset.atop ? parseFloat(el.dataset.atop) : top,
          ah: el.dataset.ah ? parseFloat(el.dataset.ah) : h,
          // Above-cursor tally inputs (strip bars only): which strip the bar
          // belongs to, and the size / CLS score / task duration it carries.
          side: el.dataset.side,
          kind: el.dataset.kind,
          kb: el.dataset.kb ? parseFloat(el.dataset.kb) : 0,
          cls: el.dataset.cls ? parseFloat(el.dataset.cls) : 0,
          task: el.dataset.task ? parseFloat(el.dataset.task) : null,
        });
      });
      const columns = document.querySelectorAll('.screenshot-col, .net-col');

      function applyScale() {
        // Runs before the baseline element is looked up on the first call.
        if (baselineLine) positionBaseline();
        var h = Math.ceil(BASE_HEIGHT * scale) + 'px';
        columns.forEach(function(col) { col.style.height = h; });
        positioned.forEach(function(p) {
          var top = aligned ? p.atop : p.top;
          var height = aligned ? p.ah : p.h;
          p.el.style.top = (top * scale) + 'px';
          if (height != null) p.el.style.height = (height * scale) + 'px';
        });
        drawArrows();
      }

      applyScale();
      // The frames are data URIs, so their boxes may not be laid out at first
      // paint; re-measure once everything has loaded.
      window.addEventListener('load', function() { measureSideFrames(); drawArrows(); });

      var alignBox = document.getElementById('align-annotations');
      alignBox.addEventListener('change', function() {
        aligned = alignBox.checked;
        BASE_HEIGHT = aligned ? ALIGNED_HEIGHT : RAW_HEIGHT;
        document.body.classList.toggle('aligned', aligned);
        applyScale();
        if (lastCursorY != null) updateStatus(lastCursorY);
      });

      var progressBox = document.getElementById('highlight-progress');
      progressBox.addEventListener('change', function() {
        document.body.classList.toggle('show-progress', progressBox.checked);
      });

      // Lines joining the frames of the two runs: green where they show the
      // same page state, red between those pairs. A line's
      // endpoints are the vertical centres of two frame entries. A frame's
      // height is whatever the browser made of its image, so it is measured
      // rather than computed; it does not change with zoom (frames carry no
      // data-h), so measuring once is enough and only the tops move.
      var FRAME_CONNECTIONS = ${JSON.stringify(connections)};
      var FRAME_TIMES = ${JSON.stringify({
        control: control.screenshots.map((s) => Math.round(s.timeMs)),
        experiment: experiment.screenshots.map((s) => Math.round(s.timeMs)),
      })};
      var SVG_NS = 'http://www.w3.org/2000/svg';
      var arrowSvg = document.getElementById('match-arrows');
      var arrowGroup = document.getElementById('match-arrow-paths');
      var arrows = [];
      var hoveredArrow = null;

      // Every frame of a side, in time order, so the scrub can name the one
      // showing at a given height.
      var sideFrames = { control: [], experiment: [] };
      function measureSideFrames() {
        ['control', 'experiment'].forEach(function(side) {
          sideFrames[side] = [].map.call(
            document.querySelectorAll('.screenshot-col.' + side + ' .screenshot-entry'),
            function(el) {
              return { el: el, idx: Number(el.getAttribute('data-frame-idx')), half: el.offsetHeight / 2 };
            },
          );
        });
      }
      measureSideFrames();

      FRAME_CONNECTIONS.forEach(function(conn) {
        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'match-arrow ' + conn.k);
        var hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'match-arrow-hit');
        arrowGroup.appendChild(path);
        arrowGroup.appendChild(hit);
        arrows.push({ c: conn.c, e: conn.e, path: path, hit: hit, delta: conn.d, kind: conn.k });
      });

      // Sits above the hovered line, in the middle column's own pixel space.
      // Drawn between two connections while the cursor slides down the column.
      var scrubLine = document.createElementNS(SVG_NS, 'path');
      scrubLine.setAttribute('class', 'scrub-line');
      scrubLine.style.display = 'none';
      arrowSvg.appendChild(scrubLine);

      var arrowKindLabel = document.createElementNS(SVG_NS, 'text');
      arrowKindLabel.setAttribute('class', 'arrow-kind-label');
      arrowKindLabel.setAttribute('text-anchor', 'middle');
      arrowKindLabel.style.display = 'none';
      arrowSvg.appendChild(arrowKindLabel);

      function arrowY(el, half) {
        // The element's own style.top is already scaled by applyScale, so read
        // it back rather than tracking the scale twice.
        return parseFloat(el.style.top) + half;
      }

      // Centre of a frame, or the point between two of them when the index is
      // fractional — the free end of a line drawn across a one-sided gap.
      function frameIndexY(side, idx) {
        var list = sideFrames[side];
        if (list.length === 0) return 0;
        var low = Math.max(0, Math.min(list.length - 1, Math.floor(idx)));
        var high = Math.max(0, Math.min(list.length - 1, Math.ceil(idx)));
        var yLow = arrowY(list[low].el, list[low].half);
        if (high === low) return yLow;
        return yLow + (arrowY(list[high].el, list[high].half) - yLow) * (idx - low);
      }

      function drawArrows() {
        // applyScale runs once before the arrows are built.
        if (!arrows || arrows.length === 0) return;
        var width = arrowSvg.clientWidth || arrowSvg.getBoundingClientRect().width;
        var x1 = 2;
        var x2 = Math.max(x1 + 1, width - 2);
        arrows.forEach(function(arrow) {
          var y1 = frameIndexY('control', arrow.c);
          var y2 = frameIndexY('experiment', arrow.e);
          var d = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
          arrow.path.setAttribute('d', d);
          arrow.hit.setAttribute('d', d);
        });
        placeArrowKindLabel();
      }

      function placeArrowKindLabel() {
        if (!hoveredArrow) return;
        var width = arrowSvg.clientWidth || arrowSvg.getBoundingClientRect().width;
        var midY = (frameIndexY('control', hoveredArrow.c)
          + frameIndexY('experiment', hoveredArrow.e)) / 2;
        arrowKindLabel.setAttribute('x', String(width / 2));
        arrowKindLabel.setAttribute('y', String(midY - 5));
      }


      // Sticky: the lift and the label stay on the last line hovered, so the
      // pair can be compared after the cursor has left the line. The next
      // hover moves them.
      var liftedFrames = [];
      // The two frames the cursor is on. Each is slid so its centre sits on its
      // end of the line: the pair then travels with the cursor instead of
      // jumping from one frame's place to the next. Without heights the frames
      // stay where the timeline put them.
      function liftPair(left, right, leftY, rightY) {
        liftedFrames.forEach(function(el) {
          el.classList.remove('matched');
          el.style.transform = '';
        });
        liftedFrames = [];
        [[left, leftY], [right, rightY]].forEach(function(entry) {
          var frame = entry[0];
          if (!frame) return;
          frame.el.classList.add('matched');
          if (entry[1] != null) {
            frame.el.style.transform =
              'translateY(' + (entry[1] - arrowY(frame.el, frame.half)) + 'px)';
          }
          liftedFrames.push(frame.el);
        });
      }

      function setArrowHover(arrow) {
        hoveredArrow = arrow;
        arrows.forEach(function(other) {
          other.path.classList.toggle('active', other === arrow);
        });
        if (!arrow) {
          arrowKindLabel.style.display = 'none';
          return;
        }
        arrowKindLabel.setAttribute('class', 'arrow-kind-label ' + arrow.kind);
        arrowKindLabel.textContent = arrow.kind === 'match' ? 'MATCH' : 'MISMATCH';
        arrowKindLabel.style.display = '';
        placeArrowKindLabel();
      }

      // The hit strokes overlap wherever frames are dense, so the line the
      // cursor is actually closest to wins rather than whichever path is on top.
      function nearestArrow(clientX, clientY) {
        var box = arrowSvg.getBoundingClientRect();
        var px = clientX - box.left;
        var py = clientY - box.top;
        var width = arrowSvg.clientWidth || box.width;
        var x1 = 2;
        var x2 = Math.max(x1 + 1, width - 2);
        var best = null;
        var bestDistance = Infinity;
        arrows.forEach(function(arrow) {
          var y1 = frameIndexY('control', arrow.c);
          var y2 = frameIndexY('experiment', arrow.e);
          var dx = x2 - x1;
          var dy = y2 - y1;
          var t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
          t = Math.max(0, Math.min(1, t));
          var ex = px - (x1 + t * dx);
          var ey = py - (y1 + t * dy);
          var distance = Math.sqrt(ex * ex + ey * ey);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = arrow;
          }
        });
        return bestDistance <= 5 ? best : null;
      }


      // The frame nearest the line's end on that side, so the pair travels with
      // the cursor: it swaps at the midpoint between two frames rather than
      // staying on the one above for the whole stretch.
      function frameNearest(side, y) {
        var list = sideFrames[side];
        var found = list[0];
        var bestDistance = Infinity;
        for (var i = 0; i < list.length; i++) {
          var distance = Math.abs(arrowY(list[i].el, list[i].half) - y);
          if (distance > bestDistance) break;
          bestDistance = distance;
          found = list[i];
        }
        return found;
      }

      function arrowMidY(arrow) {
        return (frameIndexY('control', arrow.c) + frameIndexY('experiment', arrow.e)) / 2;
      }

      // Connections never cross, so their vertical order is fixed once.
      var arrowsByHeight = arrows.slice().sort(function(a, b) { return arrowMidY(a) - arrowMidY(b); });

      // Between two connections the timeline has no line of its own, yet both
      // runs are still showing a frame. Interpolating between the neighbours
      // gives that in-between moment a line: it slides with the cursor, and the
      // two frames it lands on light up, so dragging down the column plays the
      // pair like a video.
      function showScrub(clientY, arrow) {
        if (arrowsByHeight.length === 0) return;
        var box = arrowSvg.getBoundingClientRect();
        var cursorY = clientY - box.top;
        var next = 0;
        while (next < arrowsByHeight.length && arrowMidY(arrowsByHeight[next]) < cursorY) next++;
        var below = arrowsByHeight[Math.min(next, arrowsByHeight.length - 1)];
        var above = arrowsByHeight[Math.max(0, next - 1)];
        var spanTop = arrowMidY(above);
        var spanBottom = arrowMidY(below);
        var t = spanBottom > spanTop
          ? Math.max(0, Math.min(1, (cursorY - spanTop) / (spanBottom - spanTop)))
          : 0;
        var lerp = function(a, b) { return a + (b - a) * t; };
        var y1 = lerp(frameIndexY('control', above.c), frameIndexY('control', below.c));
        var y2 = lerp(frameIndexY('experiment', above.e), frameIndexY('experiment', below.e));
        var width = arrowSvg.clientWidth || box.width;
        var x2 = Math.max(3, width - 2);
        scrubLine.setAttribute('d', 'M2,' + y1 + ' L' + x2 + ',' + y2);
        scrubLine.style.display = '';
        var left = frameNearest('control', y1);
        var right = frameNearest('experiment', y2);
        liftPair(left, right, y1, y2);
        if (arrow) showArrowLabel(arrow, clientY);
        else showScrubLabel(left, right, clientY);
      }

      function hideScrub() {
        scrubLine.style.display = 'none';
        // Back to their own places in time; the outline stays until the next hover.
        liftedFrames.forEach(function(el) { el.style.transform = ''; });
      }

      arrowSvg.addEventListener('mousemove', function(e) {
        var arrow = nearestArrow(e.clientX, e.clientY);
        setArrowHover(arrow);
        showScrub(e.clientY, arrow);
      });

      arrowSvg.addEventListener('mouseleave', function() {
        hideScrub();
        arrowLabel.style.display = 'none';
      });

      // Hovering a frame drops the sticky pair: the lift is there to compare
      // the two frames a line joins, and looking at a frame starts over.
      document.addEventListener('mouseover', function(e) {
        var target = e.target instanceof Element ? e.target : null;
        if (!target || !target.closest('.screenshot-entry')) return;
        setArrowHover(null);
        liftPair(null, null);
        arrowLabel.style.display = 'none';
      });
      arrowGroup.addEventListener('mouseout', function(e) {
        // Only the cursor-following delta chip goes; the highlight is sticky.
        if (e.target.closest && e.target.closest('.match-arrow-hit')) {
          arrowLabel.style.display = 'none';
        }
      });

      var arrowLabel = document.createElement('div');
      arrowLabel.className = 'status-chip';
      arrowLabel.style.display = 'none';
      document.body.appendChild(arrowLabel);
      function showScrubLabel(left, right, clientY) {
        if (!left || !right) return;
        var lt = FRAME_TIMES.control[left.idx];
        var rt = FRAME_TIMES.experiment[right.idx];
        var sign = rt - lt > 0 ? '+' : '';
        arrowLabel.textContent = 'control ' + (lt / 1000).toFixed(2) + 's · experiment '
          + (rt / 1000).toFixed(2) + 's (' + sign + (rt - lt) + 'ms)';
        arrowLabel.style.display = 'block';
        arrowLabel.style.top = Math.min(clientY + 18, window.innerHeight - 26) + 'px';
      }

      function showArrowLabel(arrow, clientY) {
        var sign = arrow.delta > 0 ? '+' : '';
        var kind = arrow.kind === 'match' ? 'match' : 'no match';
        arrowLabel.textContent = kind + ' · experiment ' + sign + arrow.delta + 'ms';
        arrowLabel.style.display = 'block';
        arrowLabel.style.top = Math.min(clientY + 18, window.innerHeight - 26) + 'px';
      }

      // Tally of the span between the baseline and the cursor. Every strip bar
      // is a counted item: its kind (network / main-thread / events column)
      // plus the size, CLS score or task duration it carries. Positions come
      // from positioned (captured before the first applyScale, so they are
      // unscaled) and are compared in unscaled px, in whichever view
      // (raw / aligned) is active.
      var PX_PER_MS = ${pxPerMs};
      var CHIP_CURSOR_GAP_PX = 18;
      var CHIP_STACK_GAP_PX = 4;
      var counted = { control: [], experiment: [] };
      positioned.forEach(function(p) {
        if (p.kind) counted[p.side].push(p);
      });
      var statusChips = { control: document.getElementById('status-control'), experiment: document.getElementById('status-experiment') };
      var statusMetrics = {
        control: statusChips.control.querySelector('.metrics'),
        experiment: statusChips.experiment.querySelector('.metrics'),
      };
      var baselineLine = document.getElementById('baseline-line');
      var baselineText = document.getElementById('baseline-text');
      var baselineY = 0;
      var lastCursorY = null;
      var lastClientY = 0;

      function tally(items, fromMs, toMs) {
        var t = { files: 0, kb: 0, events: 0, tasks: 0, taskms: 0, cls: 0 };
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var startMs = (aligned ? it.atop : it.top) / PX_PER_MS;
          if (it.task != null) {
            // A task straddling either edge counts for the part inside the span.
            var overlap = Math.min(startMs + it.task, toMs) - Math.max(startMs, fromMs);
            if (overlap > 0) { t.tasks++; t.taskms += overlap; }
            continue;
          }
          if (startMs < fromMs || startMs > toMs) continue;
          if (it.kind === 'net') { t.files++; t.kb += it.kb; }
          else if (it.kind === 'other') { t.events++; t.cls += it.cls; }
        }
        return t;
      }

      function updateStatus(yUnscaled, clientY) {
        lastCursorY = yUnscaled;
        if (clientY != null) lastClientY = clientY;
        document.body.classList.add('status-live');
        // Below the cursor, so the chips never sit under the pointer itself,
        // experiment stacked above control.
        var chipH = statusChips.experiment.offsetHeight || 22;
        var stackH = chipH * 2 + CHIP_STACK_GAP_PX;
        var chipTop = Math.min(lastClientY + CHIP_CURSOR_GAP_PX, window.innerHeight - stackH - 8);
        statusChips.experiment.style.top = chipTop + 'px';
        statusChips.control.style.top = (chipTop + chipH + CHIP_STACK_GAP_PX) + 'px';
        var fromMs = Math.min(baselineY, yUnscaled) / PX_PER_MS;
        var toMs = Math.max(baselineY, yUnscaled) / PX_PER_MS;
        var span = baselineY > 0
          ? Math.round(fromMs) + '-' + Math.round(toMs) + 'ms'
          : Math.round(toMs) + 'ms';
        ['control', 'experiment'].forEach(function(side) {
          var t = tally(counted[side], fromMs, toMs);
          statusMetrics[side].textContent = span +
            ', ' + t.files + ' files' +
            ', ' + Math.round(t.kb) + ' KB' +
            ', ' + t.events + ' events' +
            ', ' + t.tasks + ' tasks' +
            ', ' + Math.round(t.taskms) + ' task-ms' +
            ', CLS ' + t.cls.toFixed(4);
        });
      }

      function setBaseline(yUnscaled) {
        baselineY = Math.max(0, yUnscaled);
        document.body.classList.toggle('has-baseline', baselineY > 0);
        baselineText.textContent = Math.round(baselineY / PX_PER_MS) + 'ms baseline';
        positionBaseline();
        if (lastCursorY != null) updateStatus(lastCursorY);
      }

      function positionBaseline() {
        baselineLine.style.top = (baselineY * scale) + 'px';
      }

      var container = document.querySelector('.timeline-container');
      container.addEventListener('mousemove', function(e) {
        var y = e.clientY - container.getBoundingClientRect().top;
        updateStatus(Math.max(0, y / scale), e.clientY);
      });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') setBaseline(0);
      });
      document.getElementById('baseline-clear').addEventListener('click', function(e) {
        // Without this the document handler would read the click as "measure
        // from here" and immediately set a new baseline on the same row.
        e.stopPropagation();
        setBaseline(0);
      });

      document.addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();

        // Point in the timeline (px from container top) currently under the cursor
        var containerTop = container.getBoundingClientRect().top + window.scrollY;
        var cursorDocY = e.clientY + window.scrollY;
        var cursorInTimeline = cursorDocY - containerTop;

        // The "time position" this cursor point represents (scale-independent)
        var timePos = cursorInTimeline / scale;

        var delta = e.deltaY > 0 ? 0.8 : 1.25;
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));
        applyScale();

        // After scaling, that same timePos is now at a new pixel offset. Zoom is
        // vertical-only, so keep the current horizontal scroll (passing 0 here
        // would snap the view back to the left edge on every zoom step).
        var newCursorInTimeline = timePos * scale;
        var newScrollY = newCursorInTimeline + containerTop - e.clientY;
        window.scrollTo(window.scrollX, newScrollY);
      }, { passive: false });

      // Hover + click highlight
      var pinnedKey = null;

      function setHighlight(key) {
        document.querySelectorAll('.highlight').forEach(function(el) { el.classList.remove('highlight'); });
        if (key) {
          document.querySelectorAll('[data-key]').forEach(function(el) {
            if (el.getAttribute('data-key') === key) el.classList.add('highlight');
          });
        }
      }

      document.addEventListener('mouseover', function(e) {
        var span = e.target.closest('[data-key]');
        if (!span) return;
        var key = span.getAttribute('data-key');
        if (key !== pinnedKey) pinnedKey = null;
        setHighlight(key);
      });
      document.addEventListener('mouseout', function(e) {
        var span = e.target.closest('[data-key]');
        if (!span || pinnedKey) return;
        setHighlight(null);
      });

      // Click: jump to the matching event on the other side
      document.addEventListener('click', function(e) {
        var span = e.target instanceof Element ? e.target.closest('[data-key]') : null;
        if (!span) {
          // Anywhere in the timeline that is not an event bar: measure from here.
          var box = container.getBoundingClientRect();
          if (e.clientY < box.top || e.clientY > box.bottom) return;
          setBaseline((e.clientY - box.top) / scale);
          return;
        }
        var key = span.getAttribute('data-key');
        var idx = span.getAttribute('data-idx');
        var side = span.getAttribute('data-side');
        var otherSide = side === 'control' ? 'experiment' : 'control';
        pinnedKey = key;
        setHighlight(key);
        var target = document.querySelector('[data-key="' + CSS.escape(key) + '"][data-idx="' + idx + '"][data-side="' + otherSide + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          var toast = document.createElement('div');
          toast.className = 'toast';
          toast.innerHTML = 'No <span class="toast-key">' + key.replace(/</g,'&lt;') + '</span> with index <span class="toast-idx">' + idx + '</span> in <span class="toast-side">' + otherSide + '</span>';
          document.body.appendChild(toast);
          var dismissToast = function() {
            toast.classList.add('dismissing');
            toast.addEventListener('animationend', function() { toast.remove(); });
            window.removeEventListener('scroll', dismissToast);
          };
          window.addEventListener('scroll', dismissToast, { once: true });
        }
      });
    })();
  </script>
  <script>
    // Ping the parent compare-report so it knows the timeline rendered.
    // Chrome treats every file:// URL as a unique origin, which makes
    // contentDocument unreadable from the parent iframe even when the
    // file loads successfully — postMessage works cross-origin and is
    // the only reliable signal under that sandbox.
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage('shaka-timeline-loaded', '*'); } catch (e) {}
    }
  </script>
</body>
</html>`;
}


export interface GenerateTimelineComparisonOptions {
  controlProfilePath: string;
  experimentProfilePath: string;
  outputPath: string;
}

export function generateTimelineComparison(options: GenerateTimelineComparisonOptions): void {
  const control = parseProfile(options.controlProfilePath);
  const experiment = parseProfile(options.experimentProfilePath);
  const alignment = alignAnnotations(annotationPoints(control), annotationPoints(experiment));
  // Pair the frames showing the same page state. Raw trace times, not aligned
  // ones: aligning only moves frames on screen, it does not change which
  // picture is which.
  const { matches } = matchFrames(signFrames(control.screenshots), signFrames(experiment.screenshots));
  const mismatches = pairUnmatchedFrames(
    matches, control.screenshots.length, experiment.screenshots.length,
  );
  const html = buildTimelineHtml(control, experiment, alignment, matches, mismatches);
  writeFileSync(options.outputPath, html);
}

/* ────────────────────────────────────────────────────────────────
   SVG timeline preview
   ──────────────────────────────────────────────────────────────── */

interface TripletFrame {
  timeMs: number;
  controlUri: string;
  experimentUri: string;
  diffUri: string;
  imgW: number;
  imgH: number;
}

/**
 * Walk control + experiment screenshots in time order. For each incoming
 * frame, compare it pixel-by-pixel to the previous frame of the SAME side
 * — if it's visually identical we don't emit anything (the triplet would
 * duplicate the one we already emitted). Only when a side actually changes
 * do we advance that side's "latest" pointer and, if both sides now have a
 * frame, emit a new triplet (latest control, latest experiment, diff).
 *
 * Per-side dedup (vs. dedup on the diff image) makes sure every triplet
 * is justified by an actual visual update on at least one side — e.g. a
 * paint event on experiment produces a new triplet even if the diff vs
 * control happens to match a previously-emitted diff by coincidence.
 */
function computeTripletFrames(control: ProfileData, experiment: ProfileData): TripletFrame[] {
  type Entry = { timeMs: number; side: 'control' | 'experiment'; screenshot: Screenshot };
  const entries: Entry[] = [
    ...control.screenshots.map(s => ({ timeMs: s.timeMs, side: 'control' as const, screenshot: s })),
    ...experiment.screenshots.map(s => ({ timeMs: s.timeMs, side: 'experiment' as const, screenshot: s })),
  ];
  entries.sort((a, b) => a.timeMs - b.timeMs);

  type Decoded = { data: Uint8Array; w: number; h: number };
  let latestControl: { screenshot: Screenshot; decoded: Decoded } | null = null;
  let latestExperiment: { screenshot: Screenshot; decoded: Decoded } | null = null;
  const out: TripletFrame[] = [];

  for (const entry of entries) {
    const raw = decodeJpeg(entry.screenshot.snapshot);
    const curr: Decoded = { data: raw.data, w: raw.width, h: raw.height };

    // Compare against previous frame of the SAME side. Identical or near-
    // identical frames (common — the tracer emits many screenshots per
    // second, and even when the page hasn't repainted the JPEG encoder
    // produces slightly different bytes) don't justify a new triplet.
    // A strict `count === 0` check fails here because per-pixel JPEG noise
    // registers as a handful of "changed" pixels; use a fractional floor
    // so we only treat meaningfully-changed frames as new.
    const prev = entry.side === 'control' ? latestControl?.decoded : latestExperiment?.decoded;
    if (prev && prev.w === curr.w && prev.h === curr.h) {
      const diffCount = pixelmatch(prev.data, curr.data, null, curr.w, curr.h, { threshold: 0.3 });
      const noiseFloor = Math.max(1, Math.floor(curr.w * curr.h * 0.001));
      if (diffCount <= noiseFloor) continue;
    }

    if (entry.side === 'control') {
      latestControl = { screenshot: entry.screenshot, decoded: curr };
    } else {
      latestExperiment = { screenshot: entry.screenshot, decoded: curr };
    }

    if (!latestControl || !latestExperiment) continue; // need both sides to form a triplet

    const a = latestControl.decoded;
    const b = latestExperiment.decoded;
    if (a.w !== b.w || a.h !== b.h) continue;

    const diffPixels = new Uint8Array(a.w * a.h * 4);
    pixelmatch(a.data, b.data, diffPixels, a.w, a.h, { threshold: 0.3 });

    out.push({
      timeMs: entry.timeMs,
      controlUri: latestControl.screenshot.dataUri,
      experimentUri: latestExperiment.screenshot.dataUri,
      diffUri: encodePngDataUri(diffPixels, a.w, a.h),
      imgW: a.w,
      imgH: a.h,
    });
  }

  return out;
}

/** Pick `count` items spaced evenly across the full range, preserving
 *  first and last. If `items.length <= count`, returns items unchanged. */
function dropEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 1) return items.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (items.length - 1)) / (count - 1));
    out.push(items[idx]);
  }
  return out;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface BuildTimelinePreviewOptions {
  /** Maximum triplets to render; if more, they're dropped evenly. */
  maxFrames?: number;
  /** Total SVG width in CSS pixels. Images inside scale to fit. */
  width?: number;
}

function buildTimelinePreviewSvg(triplets: TripletFrame[], opts: BuildTimelinePreviewOptions = {}): string {
  const maxFrames = opts.maxFrames ?? 10;
  const totalW = opts.width ?? 800;

  const frames = dropEvenly(triplets, maxFrames);
  if (frames.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="40" viewBox="0 0 ${totalW} 40"><rect width="${totalW}" height="40" fill="#eef0f4"/><text x="${totalW / 2}" y="25" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#5a6470">no timeline frames</text></svg>`;
  }

  const LABEL_W = 18; // narrow left gutter — row labels are rotated 90°
  const TS_H = 14;
  const n = frames.length;
  const gridW = totalW - LABEL_W;
  const colW = Math.max(30, Math.floor(gridW / n));

  // All frames share the same source resolution (enforced in computeTripletFrames).
  const aspect = frames[0].imgH / frames[0].imgW;
  const imgH = Math.max(20, Math.round(colW * aspect));
  const cellH = imgH;
  const totalH = cellH * 3 + TS_H;

  const ROWS: Array<{ key: 'controlUri' | 'diffUri' | 'experimentUri'; label: string }> = [
    { key: 'controlUri', label: 'CONTROL' },
    { key: 'diffUri', label: 'DIFF' },
    { key: 'experimentUri', label: 'EXPERIMENT' },
  ];

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="timeline preview"><rect width="${totalW}" height="${totalH}" fill="#ffffff"/>`);

  // Row labels in the narrow left gutter, rotated -90° so they read bottom-
  // to-top and fit in ~18px of width regardless of label length.
  for (let r = 0; r < 3; r++) {
    const midY = r * cellH + cellH / 2;
    const labelX = LABEL_W / 2;
    parts.push(`<text x="${labelX}" y="${midY}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${labelX} ${midY})" font-family="ui-monospace,monospace" font-size="10" font-weight="700" letter-spacing="0.14em" fill="#1a1d22">${ROWS[r].label}</text>`);
  }

  // Frame grid — each column is a triplet stacked vertically; no gaps between
  // cells, but a 1px border around every cell so the frames read as a grid.
  const gridX0 = LABEL_W;
  const BORDER = '#d1d5db';
  for (let i = 0; i < n; i++) {
    const t = frames[i];
    const x = gridX0 + i * colW;
    for (let r = 0; r < 3; r++) {
      const y = r * cellH;
      parts.push(`<image x="${x}" y="${y}" href="${t[ROWS[r].key]}" width="${colW}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>`);
      parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${colW - 1}" height="${imgH - 1}" fill="none" stroke="${BORDER}" stroke-width="1"/>`);
    }
    const tsY = 3 * cellH + TS_H - 2;
    parts.push(`<text x="${x + colW / 2}" y="${tsY}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#5a6470">${escapeXml(formatMs(t.timeMs))}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

export interface GenerateTimelinePreviewOptions {
  controlProfilePath: string;
  experimentProfilePath: string;
  outputPath: string;
  maxFrames?: number;
  width?: number;
}

export function generateTimelinePreviewSvg(options: GenerateTimelinePreviewOptions): void {
  const control = parseProfile(options.controlProfilePath);
  const experiment = parseProfile(options.experimentProfilePath);
  const triplets = computeTripletFrames(control, experiment);
  const svg = buildTimelinePreviewSvg(triplets, {
    maxFrames: options.maxFrames,
    width: options.width,
  });
  writeFileSync(options.outputPath, svg);
}

/* ────────────────────────────────────────────────────────────────
   Single-profile all-frame SVG
   ──────────────────────────────────────────────────────────────── */

export interface ProfileFrame {
  timeMs: number;
  snapshot: Buffer; // raw JPEG bytes
  imgW: number;
  imgH: number;
  copiedForAnnotation?: boolean;
}

export interface ArrowSpec {
  /** Y coordinate of the tip — middle of the cluster's left border. */
  y: number;
  /** X coordinate of the tip — leftmost X of the cluster. */
  targetX: number;
}

interface DiffAnalysis {
  /** At most one brush spec — pointing at the *largest* cluster of
   *  significantly-changed pixels. Empty when there's no cluster above
   *  the noise floor, or when `isBigChange` is true (a brush would be
   *  redundant — the change is obvious). */
  arrows: ArrowSpec[];
  /** True if total changed-pixel fraction crosses the "the user can see
   *  this without help" threshold (>0.04). The frame gets no brush because
   *  the change is already obvious. */
  isBigChange: boolean;
  /** True if there's at least one cluster of hot cells substantial
   *  enough to call a real localized change. Used only for brush hints here;
   *  frame filtering already happened before screencast/trace sync. */
  hasSignificantCluster: boolean;
}

/**
 * Single pass over the pixelmatch diff buffer that:
 *   - Classifies whether the change is "obvious" (>4 % of frame area).
 *   - Counts hot 16-px cells (cells with ≥`minPxPerCell` differing red
 *     pixels), which filters out scattered JPEG noise — a true noisy
 *     pixel rarely co-occurs with others in the same cell, while a real
 *     localized change concentrates dozens of differing pixels per cell.
 *   - Union-finds connected hot cells into clusters and returns ONLY the
 *     largest cluster's brush spec. The user just needs a single pointer
 *     at the most-changed region; a fan of brushes for every micro-
 *     cluster was misleading and crowded.
 *
 * Used for brush rendering on frames that already survived the pre-sync
 * visual dedupe. A frame with neither a significant cluster nor a big
 * change gets no brush, but it is not filtered here.
 */
function analyzeDiffBuffer(
  out: Uint8Array,
  prev: Uint8Array,
  cur: Uint8Array,
  w: number,
  h: number,
): DiffAnalysis {
  const cellSize = 16;
  const cellsX = Math.ceil(w / cellSize);
  const cellsY = Math.ceil(h / cellSize);
  const hot = new Uint8Array(cellsX * cellsY);
  // Raised from 1 → 5: a single noisy pixel per cell shouldn't light up
  // a cluster. Real localized changes (text, button fills, icons)
  // concentrate many differing pixels into the same cell.
  const minPxPerCell = 5;
  // The interaction-overlay (cursor, click chip, key chips) paints
  // saturated red (rgba(255,40,40,0.95)) which composites to roughly
  // r>200, g<100, b<100 on any reasonable background. Those red↔non-red
  // transitions between consecutive kept frames are obvious to the eye
  // and shouldn't steal the brush from subtler delta nearby.
  const isOverlayRed = (data: Uint8Array, idx: number): boolean => {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    return r > 200 && g < 100 && b < 100;
  };
  // Pixelmatch marks "true" diff pixels red (#ff0000) and anti-aliased
  // edge diffs yellow (#ffff00). Both count as "changed" for the
  // skip-brushes-when-large heuristic — text edges, button outlines, etc.
  // tend to read as AA but are still meaningful change. Only red pixels
  // feed the per-cell clustering so brushes still point at sharp delta.
  let totalChanged = 0;
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4;
    const cy = (y / cellSize) | 0;
    for (let x = 0; x < w; x++) {
      const idx = rowStart + x * 4;
      const r = out[idx], g = out[idx + 1], b = out[idx + 2];
      if (r !== 255 || b !== 0) continue;
      if (g !== 0 && g !== 255) continue;
      // Skip overlay-only transitions: pixel was red in one frame and
      // not in the other. The audit's red cursor/click/key chips are
      // obvious to the eye; the brush should aim at subtler change.
      //
      // EXCEPT in the bottom-right chip column (last 30 % × 30 % of
      // the frame, where interaction-overlay anchors its chips). Red
      // transitions IN that corner are exactly what the validator's
      // OCR pass looks for, and dedup must keep at least one frame
      // per click that has the red chip — otherwise the blue
      // pw-interaction chip lands on a kept frame that the OCR can
      // never match. Filtering red elsewhere keeps the brush honest;
      // filtering red here would strip the very signal we annotate.
      const inChipCorner = x >= w * 0.7 && y >= h * 0.7;
      if (!inChipCorner && isOverlayRed(prev, idx) !== isOverlayRed(cur, idx)) continue;
      totalChanged++;
      if (g === 0) {
        const cx = (x / cellSize) | 0;
        hot[cy * cellsX + cx]++;
      }
    }
  }
  const totalChangeFraction = totalChanged / (w * h);
  const isBigChange = totalChangeFraction > 0.04;
  if (isBigChange) {
    return { arrows: [], isBigChange: true, hasSignificantCluster: false };
  }
  // Binarize the cell grid (above threshold = part of a cluster).
  const flag = new Uint8Array(cellsX * cellsY);
  for (let i = 0; i < hot.length; i++) flag[i] = hot[i] >= minPxPerCell ? 1 : 0;

  // Union-find over hot cells (4-connectivity).
  const parent = new Int32Array(cellsX * cellsY);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const i = cy * cellsX + cx;
      if (!flag[i]) continue;
      if (cx + 1 < cellsX && flag[i + 1]) union(i, i + 1);
      if (cy + 1 < cellsY && flag[i + cellsX]) union(i, i + cellsX);
    }
  }
  // Aggregate per-root: bbox + cell count.
  type Acc = { minX: number; maxX: number; minY: number; maxY: number; cells: number };
  const clusters = new Map<number, Acc>();
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const i = cy * cellsX + cx;
      if (!flag[i]) continue;
      const root = find(i);
      const px = cx * cellSize;
      const py = cy * cellSize;
      const acc = clusters.get(root);
      if (!acc) {
        clusters.set(root, { minX: px, maxX: px + cellSize, minY: py, maxY: py + cellSize, cells: 1 });
      } else {
        if (px < acc.minX) acc.minX = px;
        if (px + cellSize > acc.maxX) acc.maxX = px + cellSize;
        if (py < acc.minY) acc.minY = py;
        if (py + cellSize > acc.maxY) acc.maxY = py + cellSize;
        acc.cells++;
      }
    }
  }
  // Pick the largest cluster (most hot cells) — one brush per frame,
  // pointing at the biggest concentration of change. A scattered field
  // of micro-clusters (sub-pixel reflow noise) won't yield a brush
  // because no single cluster wins on cells AND the noise floor below
  // ensures we wouldn't have kept the frame anyway.
  const frameArea = w * h;
  const maxAreaFraction = 0.15;
  let best: Acc | null = null;
  for (const acc of clusters.values()) {
    const bboxArea = (acc.maxX - acc.minX) * (acc.maxY - acc.minY);
    if (bboxArea / frameArea > maxAreaFraction) continue;
    if (!best || acc.cells > best.cells) best = acc;
  }
  if (!best) {
    return { arrows: [], isBigChange: false, hasSignificantCluster: false };
  }
  return {
    arrows: [{
      y: Math.round((best.minY + best.maxY) / 2),
      targetX: Math.min(w - 1, best.maxX),
    }],
    isBigChange: false,
    hasSignificantCluster: true,
  };
}

/**
 * Convert already-deduped screenshots into report frames and optional brush
 * hints without dropping anything. The expensive frame-count reduction now
 * happens before screencast↔trace sync; after annotations are copied in, every
 * frame is preserved so trace events cannot disappear in a second filter.
 */
export function profileFramesWithAnnotations(
  profile: ProfileData,
  rawBuckets: FrameAnnotation[][],
): {
  frames: ProfileFrame[];
  arrows: ArrowSpec[][];
  keptBuckets: FrameAnnotation[][];
} {
  const frames: ProfileFrame[] = [];
  const keptBuckets: FrameAnnotation[][] = [];
  const keptArrows: ArrowSpec[][] = [];
  let prevDecoded: { data: Uint8Array; width: number; height: number } | null = null;

  for (let i = 0; i < profile.screenshots.length; i++) {
    const screenshot = profile.screenshots[i];
    const decoded = decodeJpeg(screenshot.snapshot);
    const labels = rawBuckets[i];

    frames.push({
      timeMs: screenshot.timeMs,
      snapshot: screenshot.snapshot,
      imgW: decoded.width,
      imgH: decoded.height,
      copiedForAnnotation: screenshot.copiedForAnnotation,
    });
    keptBuckets.push(labels);

    if (!prevDecoded || prevDecoded.width !== decoded.width || prevDecoded.height !== decoded.height) {
      keptArrows.push([]);
      prevDecoded = decoded;
      continue;
    }

    const w = decoded.width;
    const h = decoded.height;
    const diffBuf = new Uint8Array(w * h * 4);
    pixelmatch(prevDecoded.data, decoded.data, diffBuf, w, h, { threshold: 0.1 });
    const analysis = analyzeDiffBuffer(diffBuf, prevDecoded.data, decoded.data, w, h);
    keptArrows.push(analysis.arrows);
    prevDecoded = decoded;
  }

  return {
    frames,
    arrows: keptArrows,
    keptBuckets,
  };
}

export interface FrameAnnotation {
  kind: 'lcp' | 'layout-shift' | 'interaction' | 'pw-interaction' | 'test-annotation';
  label: string;
  rects?: number[][];
  // Single rect from a Playwright bounding-box record (x,y,w,h in CSS px).
  pwRect?: { x: number; y: number; width: number; height: number };
}

/**
 * Prefix tests use on `performance.mark(...)` calls to flag a mark as a
 * shaka-perf timeline annotation. The trace surfaces every user-timing
 * event, so without a sentinel we'd render labels for the page's own
 * `performance.mark` calls too (React internals, Vue plugins, etc.).
 * The prefix is stripped from the chip label before render.
 */
export const SHAKA_PERF_ANNOTATION_PREFIX = 'shaka-perf-annotation: ';

/** Prefix of every `performance.mark` shaka-perf itself emits (test
 *  annotations, sync flashes). They drive the timeline and never render as bars. */
export const SHAKA_PERF_MARK_PREFIX = 'shaka-perf-';

export function isInternalMark(label: string): boolean {
  return label.startsWith(SHAKA_PERF_MARK_PREFIX);
}

function findFrameIndex(frames: ProfileFrame[], timeMs: number): number {
  let idx = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].timeMs <= timeMs) idx = i;
    else break;
  }
  return idx;
}

const ANNOTATION_FRAME_EPSILON_MS = 0.5;

function timeMatchesFrame(a: number, b: number): boolean {
  return Math.abs(a - b) <= ANNOTATION_FRAME_EPSILON_MS;
}

// Single source of truth for "does this timeline event become a frame
// annotation?". Used both by `copyPreviousFramesForAnnotations` (to decide
// which event timestamps deserve a copied screencast frame) and by
// `bucketEventsToFrames` (to decide which events get pushed into a bucket).
// Keeping these two sites in sync mattered when 'test-annotation' was
// added — diverging the rule would have silently lost or duplicated chips.
function isRoutableAnnotationEvent(
  event: TimelineEvent,
  hasPwRecords: boolean,
): boolean {
  if (event.category === 'interaction') return !hasPwRecords;
  if (isTestAnnotationEvent(event)) return true;
  return (event.category === 'paint' && event.isLcpFinal === true) ||
    event.category === 'layout-shift';
}

function isTestAnnotationEvent(event: TimelineEvent): boolean {
  return event.category === 'user-timing' &&
    event.label.startsWith(SHAKA_PERF_ANNOTATION_PREFIX);
}

export interface CopiedAnnotationFramesResult {
  screenshots: Screenshot[];
  copiedFrameCount: number;
}

/**
 * After screencast-frame visual dedupe, trace events can land between two
 * kept visual frames. Preserve their exact timeline positions by inserting a
 * synthetic screenshot at the event time, reusing the nearest previous visual
 * frame's pixels and letting `bucketEventsToFrames` attach the annotation.
 */
export function copyPreviousFramesForAnnotations(
  screenshots: readonly Screenshot[],
  events: readonly TimelineEvent[],
  playwrightInteractions: readonly RecordedInteraction[] | undefined,
): CopiedAnnotationFramesResult {
  if (screenshots.length === 0) {
    return { screenshots: [], copiedFrameCount: 0 };
  }
  const hasPwRecords = !!playwrightInteractions && playwrightInteractions.length > 0;
  const annotationTimes = Array.from(new Set(
    events
      .filter((event) => isRoutableAnnotationEvent(event, hasPwRecords))
      .map((event) => event.timeMs),
  )).sort((a, b) => a - b);
  if (annotationTimes.length === 0) {
    return { screenshots: [...screenshots], copiedFrameCount: 0 };
  }

  const out: Screenshot[] = [...screenshots].sort((a, b) => a.timeMs - b.timeMs);
  let copiedFrameCount = 0;
  for (const timeMs of annotationTimes) {
    if (out.some((shot) => timeMatchesFrame(shot.timeMs, timeMs))) continue;
    let sourceIdx = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].timeMs <= timeMs) sourceIdx = i;
      else break;
    }
    if (sourceIdx < 0) sourceIdx = 0;
    const source = out[sourceIdx];
    const insertIdx = out.findIndex((shot) => shot.timeMs > timeMs);
    const copied: Screenshot = {
      ...source,
      timeMs,
      copiedForAnnotation: true,
    };
    if (insertIdx < 0) out.push(copied);
    else out.splice(insertIdx, 0, copied);
    copiedFrameCount++;
  }
  return { screenshots: out, copiedFrameCount };
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

interface InteractionMatch {
  /** Trace EventTiming startTime — the moment the input event actually
   *  reached the renderer, navStart-relative. The recorder's `it.timeMs`
   *  is just when `locator.click()` was called from Node; the trace
   *  timestamp is the renderer's own clock, which is what the screencast
   *  is synced to via the flash markers. */
  timeMs: number;
  /** Interaction duration in ms (INP) from the matched EventTiming. */
  durationMs: number;
}

function createInteractionMatcher(
  eventInteractions: readonly { timeMs: number; durationMs: number }[],
): (timeMs: number) => InteractionMatch | undefined {
  // Greedy 1:1 pairing — each EventTiming can satisfy at most one PW press
  // so 'admin' (5 PW records) doesn't all latch onto the same loudest INP.
  const used = new Set<number>();
  // Recorder-to-dispatch gap (Playwright actionability + CDP round-trip)
  // can run a few hundred ms for elements that only become actionable
  // partway through the trace, so a tight 250 ms window would drop the
  // match and use the recorder's stamp. 1 s is the slack we
  // need without over-pairing across nearby distinct interactions.
  const matchWindowMs = 1000;
  return (timeMs: number) => {
    let best = -1;
    let bestDelta = matchWindowMs;
    for (let i = 0; i < eventInteractions.length; i++) {
      if (used.has(i)) continue;
      const delta = Math.abs(eventInteractions[i].timeMs - timeMs);
      if (delta > bestDelta) continue;
      bestDelta = delta;
      best = i;
    }
    if (best < 0) return undefined;
    used.add(best);
    return {
      timeMs: eventInteractions[best].timeMs,
      durationMs: eventInteractions[best].durationMs,
    };
  };
}

function pwInteractionLabel(
  it: RecordedInteraction,
  matched: InteractionMatch | undefined,
): string {
  const inpTail = matched ? ` ${Math.round(matched.durationMs)}ms` : '';
  switch (it.kind) {
    case 'press':
      return `key press ${it.key ?? ''}${inpTail}`.replace(/\s+/g, ' ').trim();
    case 'click':
    case 'dblclick':
    case 'tap':
      return `${it.kind}${inpTail}`;
    case 'fill':
    case 'type':
      return `${it.kind} "${truncate(it.text ?? '', 12)}"${inpTail}`;
    default:
      return `${it.kind}${inpTail}`;
  }
}

export function bucketEventsToFrames(
  frames: ProfileFrame[],
  events: TimelineEvent[],
  playwrightInteractions: RecordedInteraction[] | undefined,
): FrameAnnotation[][] {
  const buckets: FrameAnnotation[][] = frames.map(() => []);
  if (frames.length === 0) return buckets;
  const hasPwRecords = !!playwrightInteractions && playwrightInteractions.length > 0;
  for (const event of events) {
    // `isRoutableAnnotationEvent` filters interaction events when Playwright
    // records are present — the pw-interaction path picks them up later
    // with the target element's bounding box, so EventTiming-derived
    // interaction pills would just double-render.
    if (!isRoutableAnnotationEvent(event, hasPwRecords)) continue;
    const idx = findFrameIndex(frames, event.timeMs);
    if (isTestAnnotationEvent(event)) {
      // Strip the sentinel prefix; what's left is the human-facing label
      // the test author passed to `performance.mark`.
      buckets[idx].push({
        kind: 'test-annotation',
        label: event.label.slice(SHAKA_PERF_ANNOTATION_PREFIX.length),
      });
    } else if (event.category === 'paint' && event.isLcpFinal) {
      buckets[idx].push({ kind: 'lcp', label: 'LCP' });
    } else if (event.category === 'layout-shift') {
      // Render the shift on the NEXT frame so the highlighted area lines up
      // with where the newly rendered element actually shows up.
      const landsOnCopiedAnnotationFrame = frames[idx].copiedForAnnotation === true &&
        timeMatchesFrame(frames[idx].timeMs, event.timeMs);
      const targetIdx = landsOnCopiedAnnotationFrame
        ? idx
        : Math.min(idx + 1, frames.length - 1);
      const label = event.score != null
        ? `Layout Shift ${event.score.toFixed(3)}`
        : 'Layout Shift';
      buckets[targetIdx].push({
        kind: 'layout-shift',
        label,
        rects: event.rects,
      });
    } else if (event.category === 'interaction') {
      const ms = event.durationMs != null ? Math.round(event.durationMs) : 0;
      const type = event.interactionType ?? 'event';
      const isKeyboard = /key|input/i.test(type);
      const label = isKeyboard ? `key press ${ms}ms` : `${type} ${ms}ms`;
      buckets[idx].push({ kind: 'interaction', label });
    }
  }

  return buckets;
}

export interface PlacedInteraction {
  interaction: RecordedInteraction;
  label: string;
  /** Trace time of the raw synced screencast frame that carries the chip. */
  frameTimeMs: number;
}

// Per-pixel pixelmatch threshold under which two decoded screencast frames
// count as the same picture. The CFR encode's repeated frames decode with
// zero differing pixels at this threshold; any real repaint differs.
const REPEAT_FRAME_PIXELMATCH_THRESHOLD = 0.1;

function isRepeatOfPrevious(frames: readonly Screenshot[], i: number): boolean {
  if (i === 0) return false;
  const a = decodeJpeg(frames[i - 1].snapshot);
  const b = decodeJpeg(frames[i].snapshot);
  if (a.width !== b.width || a.height !== b.height) return false;
  return pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: REPEAT_FRAME_PIXELMATCH_THRESHOLD }) === 0;
}

/**
 * Decide which screencast frame shows each Playwright interaction. The
 * on-page overlay draws its red chip in the interaction's own next paint, and
 * the trace EventTiming measures exactly that: `start + duration` is the
 * presentation time of that paint. The screencast is encoded at a constant
 * 60fps, so it repeats the last captured picture until Chrome sends the next
 * one, and that capture trails the paint by 0-2 frames. The chip frame is
 * therefore the first frame at or after the paint that is a new picture, not
 * a repeat of the one before it. The INP label comes from the same
 * EventTiming. An interaction with no EventTiming (a `fill`, which fires no
 * input event the overlay draws) is placed from its dispatch time the same way.
 */
export function placeInteractions(
  playwrightInteractions: readonly RecordedInteraction[],
  events: readonly TimelineEvent[],
  rawSynced: readonly Screenshot[],
): PlacedInteraction[] {
  const matchTiming = createInteractionMatcher(
    events
      .filter((e): e is TimelineEvent & { durationMs: number } =>
        e.category === 'interaction' && typeof e.durationMs === 'number')
      .map((e) => ({ timeMs: e.timeMs, durationMs: e.durationMs })),
  );
  const firstNewFrameAtOrAfter = (timeMs: number): number => {
    let i = rawSynced.findIndex((f) => f.timeMs >= timeMs);
    if (i < 0) return rawSynced[rawSynced.length - 1]?.timeMs ?? timeMs;
    while (i + 1 < rawSynced.length && isRepeatOfPrevious(rawSynced, i)) i++;
    return rawSynced[i].timeMs;
  };
  return [...playwrightInteractions]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((interaction) => {
      const timing = matchTiming(interaction.timeMs);
      const paintMs = timing ? timing.timeMs + timing.durationMs : interaction.timeMs;
      return { interaction, label: pwInteractionLabel(interaction, timing), frameTimeMs: firstNewFrameAtOrAfter(paintMs) };
    });
}

/** Add the raw synced frames at `timesMs` to the kept set when dedupe dropped them. */
export function keepFramesAt(
  screenshots: readonly Screenshot[],
  rawSynced: readonly Screenshot[],
  timesMs: readonly number[],
): Screenshot[] {
  const out = [...screenshots].sort((a, b) => a.timeMs - b.timeMs);
  for (const timeMs of timesMs) {
    const raw = rawSynced.find((f) => f.timeMs === timeMs);
    if (!raw || out.some((f) => f.timeMs === timeMs)) continue;
    const insertIdx = out.findIndex((f) => f.timeMs > timeMs);
    if (insertIdx < 0) out.push(raw);
    else out.splice(insertIdx, 0, raw);
  }
  return out;
}

/** Put each placed interaction's chip on its frame (kept by `keepFramesAt`). */
export function bucketPlacedInteractions(
  frames: readonly ProfileFrame[],
  buckets: FrameAnnotation[][],
  placed: readonly PlacedInteraction[],
): void {
  for (const { interaction, label, frameTimeMs } of placed) {
    let idx = frames.findIndex((f) => f.timeMs === frameTimeMs);
    if (idx < 0) idx = frames.findIndex((f) => f.timeMs >= frameTimeMs);
    if (idx < 0) idx = frames.length - 1;
    if (idx < 0) return;
    buckets[idx].push({ kind: 'pw-interaction', label, pwRect: interaction.rect });
  }
}

export function frameImageFilename(timeMs: number): string {
  // Two-digit precision keeps consecutive frames unique without messy names.
  return `timeline_frame_${timeMs.toFixed(2)}ms.webp`;
}

export function deriveInteractionsPath(profilePath: string): string {
  return profilePath.endsWith('_performance_profile.json')
    ? profilePath.replace(/_performance_profile\.json$/, '_interactions.json')
    : profilePath + '.interactions.json';
}

export function deriveScreencastVideoPath(profilePath: string): string {
  return path.join(path.dirname(profilePath), SCREENCAST_FILENAME);
}

export function deriveScreencastStartPath(profilePath: string): string {
  return path.join(path.dirname(profilePath), SCREENCAST_START_FILENAME);
}

export function loadPlaywrightInteractions(path: string): RecordedInteraction[] | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`shaka-perf: ${path} is not a JSON array — ignoring Playwright interactions for this audit`);
      return undefined;
    }
    return parsed as RecordedInteraction[];
  } catch (err) {
    console.warn(`shaka-perf: failed to parse Playwright interactions from ${path}: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Extract every frame from the screencast video via ffmpeg and return them
 * as `Screenshot` objects. The video is CFR (constant 60 fps with duplicates
 * during idle stretches — see encodeScreencastVideo); extracting "every frame"
 * gives a uniform timestamp grid, and the visual-change pass in
 * `syncVideoToTraceViaFlashMarkers` collapses duplicated
 * stretches before trace timestamp interpolation.
 *
 * The video's frame-zero is the first captured screencast frame, NOT the
 * trace's navigationStart. The sibling `screencast_start.json` file holds
 * the offset so frame timestamps stay aligned with the rest of the trace.
 */
export async function loadScreenshotsFromVideo(
  videoPath: string,
  startPath: string,
): Promise<Screenshot[] | undefined> {
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  const fs = require('node:fs') as typeof import('node:fs');
  const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
  const os = require('node:os') as typeof import('node:os');
  const pathMod = require('node:path') as typeof import('node:path');
  if (!existsSync(videoPath)) return undefined;
  let firstFrameTimeMs = 0;
  if (existsSync(startPath)) {
    try {
      const meta = JSON.parse(readFileSync(startPath, 'utf-8')) as { firstFrameTimeMs?: number };
      if (typeof meta.firstFrameTimeMs === 'number') firstFrameTimeMs = meta.firstFrameTimeMs;
    } catch (err) {
      console.warn(
        `shaka-perf: failed to parse ${startPath} (${(err as Error).message}); video frame timestamps will be offset from the trace clock by the unknown first-frame time`,
      );
    }
  }
  const tmpDir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'shaka-screencast-extract-'));
  try {
    // Extract all decoded frames as JPEGs. `-vsync passthrough` preserves
    // input PTS so we can compute per-frame timestamps from sequence number.
    const ff = childProcess.spawn('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-vsync', 'passthrough',
      '-qscale:v', '2',
      '-loglevel', 'error',
      pathMod.join(tmpDir, 'frame_%06d.jpg'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    pipeAndFilterStderr(ff.stderr!);
    const ffResult = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
      ff.on('error', (error) => resolve({ code: null, error }));
      ff.on('exit', (code) => resolve({ code }));
    });
    if (ffResult.error) {
      if ((ffResult.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('shaka-perf: ffmpeg not found on PATH — install ffmpeg to enable screencast frame extraction (e.g. `brew install ffmpeg`)');
      }
      throw new Error(`shaka-perf: failed to spawn ffmpeg: ${ffResult.error.message}`);
    }
    if (ffResult.code !== 0) {
      console.warn(
        `shaka-perf: ffmpeg exited with code ${ffResult.code} extracting frames from ${videoPath} — screencast panel will be empty (see ffmpeg stderr above)`,
      );
      return undefined;
    }
    // Probe the encoded fps (we set 60/1 in encodeScreencastVideo; reading
    // back keeps this resilient if that ever changes).
    const probe = childProcess.spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    if (probe.error) {
      if ((probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'shaka-perf: ffprobe not found on PATH — it ships with ffmpeg and is needed to read the ' +
          'screencast frame rate (e.g. `brew install ffmpeg` / `apt install ffmpeg`)',
        );
      }
      throw new Error(`shaka-perf: failed to spawn ffprobe: ${probe.error.message}`);
    }
    const fpsRaw = (probe.stdout ?? '').toString().trim(); // e.g. "60/1"
    const [num, den] = fpsRaw.split('/').map(Number);
    const fps = (Number.isFinite(num) && Number.isFinite(den) && den > 0) ? num / den : 60;
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.jpg')).sort();
    return files.map((name, i) => {
      const buf = fs.readFileSync(pathMod.join(tmpDir, name));
      return {
        timeMs: firstFrameTimeMs + (i / fps) * 1000,
        dataUri: `data:image/jpeg;base64,${buf.toString('base64')}`,
        snapshot: buf,
      };
    });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Index of the first screencast frame whose pixels stop being a uniform
 * blank/white surface — i.e. Chrome painted something contentful for the
 * first time. Used to anchor the screencast against the trace's
 * `firstContentfulPaint` event for clock sync.
 *
 * We sample every Nth pixel rather than walking the whole image because
 * 500×wide × 4 bytes per pixel makes a per-pixel scan a few MB per
 * frame, and we may inspect dozens of frames before finding the first
 * paint. Sampling on a 16-pixel grid (~1/256 of pixels) is enough to
 * detect text strokes / button fills with thousands of "off-white"
 * pixels while staying fast.
 *
 * Returns -1 if every frame looked blank.
 */
/**
 * One change frame in a stream of screenshots — a moment where the page
 * visibly transitioned from the prior screenshot. Carries the decoded
 * pixels at the COMPARISON resolution (always trace-screenshot dims, so
 * trace and video changes can be pixelmatched directly).
 */
export interface ChangeFrame {
  /** Index into the original Screenshot array. */
  shotIdx: number;
  /** Source timestamp. For trace shots this is authoritative (trace
   *  clock); for video shots this is the raw video frame time we'll
   *  be remapping. */
  sourceTimeMs: number;
  /** RGBA pixel buffer at (compareW, compareH). */
  decoded: Uint8Array;
}

// Per-pixel YIQ colour-distance threshold (pixelmatch): a pixel counts as
// "changed" once its colour differs by more than this. Lowered from 0.35 to
// 0.175 (2× more sensitive) so subtle colour/brightness shifts in an animation
// register as differing pixels instead of being smoothed away — fewer frames
// then look identical to the dedupe.
const CHANGE_DETECTION_PIXELMATCH_THRESHOLD = 0.175;
// 0.5 % of pixels must differ (vs the last kept frame) for a frame to count as a
// real change. Lowered from 2 % to keep small/slow UI animations whose per-step
// delta is tiny but visually meaningful, at the cost of a few more near-duplicate
// frames surviving the dedupe.
export const CHANGE_DETECTION_MIN_CHANGE_FRACTION = 0.005;

/**
 * Walk a screenshot stream in order and emit one ChangeFrame per
 * "the page visibly changed since the last kept frame" — used identically
 * for trace screenshots and downscaled video frames so the two streams are
 * pixelmatch-comparable at the same resolution. Returns a frame per
 * meaningful transition; pure-noise neighbours collapse.
 *
 * `decodeAt(i)` is responsible for producing RGBA pixels at (compareW,
 * compareH) — for trace shots that's just decodeJpeg; for video shots
 * sharp downscales JPEG → trace dims first. Keeping the decode out of
 * this function lets us reuse the same change-detection logic for both.
 */
export async function detectChangeFrames(
  shots: Screenshot[],
  compareW: number,
  compareH: number,
  decodeAt: (idx: number) => Promise<Uint8Array>,
  /** Min fraction of differing pixels (per pixelmatch threshold 0.35) for a
   *  frame to count as a real change vs the prior kept frame. Low enough
   *  (0.5%) to catch small/slow UI updates (cursor, focus ring, chip, an
   *  animation's per-step delta) while still ignoring most JPEG/scale noise. */
  minChangeFraction: number,
): Promise<ChangeFrame[]> {
  // Walk newest → oldest so that within a run of near-duplicate frames the
  // FRESHER one survives (older near-dups collapse into it) and the final
  // settled frame is always kept — otherwise a tiny sub-threshold change at the
  // tail is dropped, leaving a slightly-stale frame as the last thing on the
  // timeline. Reversed back to chronological order before returning.
  const changes: ChangeFrame[] = [];
  let prevDecoded: Uint8Array | null = null;
  for (let i = shots.length - 1; i >= 0; i--) {
    const decoded = await decodeAt(i);
    if (prevDecoded === null) {
      // Last shot: no newer frame to compare against — always kept, so the
      // settled end state is never dropped. Bad anchor matches are filtered
      // downstream by the similarity threshold.
      changes.push({ shotIdx: i, sourceTimeMs: shots[i].timeMs, decoded });
      prevDecoded = decoded;
      continue;
    }
    const diffCount = pixelmatch(prevDecoded, decoded, null, compareW, compareH, {
      threshold: CHANGE_DETECTION_PIXELMATCH_THRESHOLD,
    });
    if (diffCount / (compareW * compareH) > minChangeFraction) {
      changes.push({ shotIdx: i, sourceTimeMs: shots[i].timeMs, decoded });
      prevDecoded = decoded;
    }
  }
  changes.reverse();
  return changes;
}

/**
 * Sharp-downscale a single video JPEG to trace dims and return the raw
 * RGBA buffer ready for pixelmatch. `fit: 'fill'` is safe because video
 * frames and trace screenshots share the same viewport aspect (both are
 * aspect-fitted upstream from the same Chrome window). Adding alpha
 * matches the 4-channel layout pixelmatch expects from decodeJpeg.
 */
export async function scaleJpegToCompareDims(
  jpegBuf: Buffer,
  compareW: number,
  compareH: number,
): Promise<Uint8Array> {
  const raw = await sharp(jpegBuf)
    .resize(compareW, compareH, { fit: 'fill' })
    .raw()
    .ensureAlpha()
    .toBuffer();
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

export interface ScreencastSyncStats {
  frameCapDropped: number;
  inputFrameCount: number;
  keptFrameCount: number;
  removedFrameCount: number;
}

export interface DedupedScreencastSyncResult {
  screenshots: Screenshot[];
  rawSyncedScreenshots: Screenshot[];
  stats: ScreencastSyncStats;
}
