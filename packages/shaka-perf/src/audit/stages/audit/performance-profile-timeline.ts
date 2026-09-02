/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * One audited page's trace as a vertical timeline.
 *
 * This is compare's `timeline-comparison.ts` with the control half removed:
 * same grid, same strips, same colours, same zoom — an audit measures one
 * side, so the control columns and the diff column are gone and what remains
 * is the experiment half. Kept as a copy rather than a shared renderer so the
 * comparison view stays free to change without dragging the audit with it.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync, writeFileSync } from 'node:fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jpeg = require('jpeg-js') as { decode(buf: Buffer, opts?: { useTArray: boolean }): { width: number; height: number; data: Uint8Array } };

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
    // e.g. `[12.345s] [6.78 KB] /graphql?operationName="popmenuConfig"` — the URL
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

  // Renderer main-thread flame: every `devtools.timeline` complete event on the
  // process/thread that emitted navigationStart (CrRendererMain) — Task,
  // Evaluate Script, Function Call, Layout, Paint, GC, … These properly nest by
  // time containment, so a stack gives each one its depth (the flame lane).
  // Sub-MIN_MAIN_TASK_MS events are dropped as noise; because a child can't last
  // longer than its parent, that filter never strands a descendant above a
  // dropped ancestor, so depths stay gap-free. UserTiming marks/measures live in
  // the events column already, so they're excluded here.
  const mainThreadEvents: MainThreadEvent[] = [];
  if (navStartEvent) {
    const raw = events.filter(e =>
      e.ph === 'X' && e.dur != null && e.dur / 1000 >= MIN_MAIN_TASK_MS &&
      e.pid === navStartEvent.pid && e.tid === navStartEvent.tid &&
      (e.cat ?? '').includes('devtools.timeline') &&
      !e.name.startsWith('UserTiming'));
    // Start asc, then end desc so a parent is processed before the children it
    // contains (and thus sits on the stack when they compute their depth).
    raw.sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
    const ancestorEnds: number[] = [];
    for (const e of raw) {
      const end = e.ts + e.dur!;
      while (ancestorEnds.length && ancestorEnds[ancestorEnds.length - 1] <= e.ts) ancestorEnds.pop();
      mainThreadEvents.push({
        name: e.name,
        startMs: Math.max(0, (e.ts - navStart) / 1000),
        durMs: e.dur! / 1000,
        depth: ancestorEnds.length,
        detail: mainThreadDetail(e),
      });
      ancestorEnds.push(end);
    }
  }

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

function computePxPerMs(profile: ProfileData): number {
  const deltas = [minTimeDelta(profile.screenshots)].filter(d => isFinite(d) && d > 0);

  if (deltas.length === 0) return 3; // neutral default

  const globalMinDelta = Math.min(...deltas);
  return Math.max(FRAME_SLOT / globalMinDelta, 0.5);
}




function decodeJpeg(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  return jpeg.decode(buf, { useTArray: true });
}

/**
 * The frames column is exactly one frame wide, in the screenshot's own pixels.
 * Trace screenshots are downscaled thumbnails (a 1280x800 desktop arrives as
 * 250x156), so sizing the column to the JPEG rather than to a target height
 * renders each frame 1:1 instead of upscaling it.
 */
function computeFrameWidth(profile: ProfileData): number {
  return frameNaturalSize(profile).width || 120;
}

// Per-rectangle lane width in the tetris-packed strip. Narrow so a busy page
// (dozens of concurrent requests/events) still fits beside the screenshots, but
// wide enough for the vertical label text rendered inside each rectangle.
const NET_LANE_W = 14;

// Test annotations reach the trace as user timings with this prefix.
const SHAKA_PERF_ANNOTATION_PREFIX = 'shaka-perf-annotation: ';

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
// Main-thread events shorter than this are dropped — sub-ms events are visual
// noise (thousands per load) and convey no useful activity in the flame.
const MIN_MAIN_TASK_MS = 1;

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

interface NetworkRequest {
  url: string;
  startMs: number;
  endMs: number;
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
        requests.push({ url: e.label, startMs: arr.shift()!, endMs: e.timeMs });
      }
    }
  }
  for (const [url, starts] of openStarts) {
    for (const startMs of starts) {
      requests.push({ url, startMs, endMs: profile.maxTimeMs });
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
  heightPx: number;       // base pixel height of the rectangle
  timeProportional: boolean; // true → height scales with zoom (network spans)
  weight: number;         // lane-packing priority; heavier hugs the diagram
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
      heightPx: Math.max(2, Math.round((r.endMs - r.startMs) * pxPerMs)),
      timeProportional: true,
      weight: STRIP_CATEGORY_WEIGHT[category],
    });
  }

  for (const e of profile.events) {
    if (e.category === 'network-start' || e.category === 'network-end') continue;
    if (e.category === 'user-timing' && e.label.startsWith(SHAKA_PERF_ANNOTATION_PREFIX)) continue;
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
      heightPx: hasSpan ? Math.max(2, Math.round(e.durationMs! * pxPerMs)) : MARKER_PX,
      timeProportional: hasSpan,
      weight: STRIP_CATEGORY_WEIGHT[category] ?? 30,
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
      heightPx: Math.max(2, Math.round(e.durMs * pxPerMs)),
      timeProportional: true,
      weight: 0,
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

export function buildProfileTimelineHtml(profile: ProfileData, title: string): string {
  const maxTimeMs = Math.max(profile.maxTimeMs, 1);
  const pxPerMs = computePxPerMs(profile);
  const totalHeight = Math.ceil(maxTimeMs * pxPerMs) + FRAME_HEIGHT + 50;
  const frameWidth = computeFrameWidth(profile);

  function renderScreenshots(profile: ProfileData): string {
    const annotations = buildFrameAnnotations(profile);
    // Layout-shift region_rects are in CSS-viewport pixels, so the overlay
    // viewBox must be the CSS viewport. The trace screenshot JPEGs are downscaled
    // (e.g. 230x498 for a 390x844 viewport), so using their pixel size would push
    // every box off-position. Fall back to the decoded JPEG size only when the
    // trace carried no viewport event.
    const natural = frameNaturalSize(profile);
    const viewBoxW = profile.viewport?.width ?? natural.width;
    const viewBoxH = profile.viewport?.height ?? natural.height;
    return profile.screenshots.map((s, i) => {
      const top = Math.round(s.timeMs * pxPerMs);
      const overlay = renderFrameOverlay(annotations.get(i), viewBoxW, viewBoxH);
      return `<div class="screenshot-entry" style="top:${top}px">
        <span class="ts-label">${formatMs(s.timeMs)}</span>
        <span class="frame-wrap"><img src="${s.dataUri}" />${overlay}</span>
      </div>`;
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
  function renderStrip(layout: StripLayout): string {
    const { rects, laneOf } = layout;
    const keyCounts = new Map<string, number>();
    return rects.map((r, i) => {
      const idx = keyCounts.get(r.key) ?? 0;
      keyCounts.set(r.key, idx + 1);
      const offset = laneOf[i] * NET_LANE_W;
      const top = Math.round(r.topMs * pxPerMs);
      // Only time-proportional spans carry data-h, so the zoom JS scales their
      // height; fixed-height markers keep their pixel height at every zoom.
      const dataH = r.timeProportional ? ` data-h="${r.heightPx}"` : '';
      return `<div class="net-bar cat-${r.category}"${dataH} data-key="${escapeHtml(r.key)}" data-idx="${idx}" title="${escapeHtml(r.title)}" style="top:${top}px;height:${r.heightPx}px;left:${offset}px;width:${NET_LANE_W - 1}px;background:${STRIP_CATEGORY_COLOR[r.category]};">${escapeHtml(r.label)}</div>`;
    }).join('\n');
  }

  // Annotation group bands tint each side's screenshot column per timeline phase
  // (the comparison-view counterpart of the audit timeline's colour-coded
  // sections). The accent border + chip sit on the screenshot-facing inner edge.
  function renderGroupBands(profile: ProfileData): string {
    return buildAnnotationGroups(profile).map(g => {
      const color = TIMELINE_GROUP_PALETTE[g.colorIndex % TIMELINE_GROUP_PALETTE.length]!;
      const top = Math.round(g.startMs * pxPerMs);
      const height = Math.max(0, Math.round((g.endMs - g.startMs) * pxPerMs));
      return `<div class="group-band" data-h="${height}" style="top:${top}px;height:${height}px;background:${color.tint};--accent:${color.accent};">
        <span class="group-chip" style="background:${color.accent}" title="${escapeHtml(g.label)}">${escapeHtml(g.label)}</span>
      </div>`;
    }).join('\n');
  }

  // Strip layout (rectangles + weighted lane assignment) is computed once per
  // side — split into network, main-thread, and other-events strips — and reused
  // for both the column widths and the rectangles themselves.
  const strip = computeStripLayout(profile, pxPerMs);
  const netColW = strip.net.laneCount * NET_LANE_W;
  const mainColW = strip.mainThread.laneCount * NET_LANE_W;
  const otherColW = strip.other.laneCount * NET_LANE_W;
  // 4-col grid: screenshot | network | main-thread | other. Network sits
  // innermost (nearest the frames), then the main-thread occupancy track, then
  // the event markers — the same inside-out order as the comparison view's
  // experiment half.
  const gridColumns = `${frameWidth}px ${netColW}px ${mainColW}px ${otherColW}px`;
  // Total grid width, given to the legend so it centres on the diagram even
  // when the grid is wider than the viewport.
  const timelineWidthPx = frameWidth + netColW + mainColW + otherColW;

  // Legend chips so the category colours are self-explanatory.
  const legendHtml = STRIP_LEGEND.map(({ cat, label }) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${STRIP_CATEGORY_COLOR[cat]}"></span>${escapeHtml(label)}</span>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff;
    color: #1a1d22;
    padding: 20px;
  }
  h1 { text-align: center; color: #111; margin-bottom: 8px; font-size: 20px; }
  .controls { text-align: center; margin-bottom: 16px; }
  .controls label { cursor: pointer; color: #5a6470; font-size: 13px; margin: 0 12px; }
  .controls input[type="checkbox"] { margin-right: 4px; }

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
  .col-header.frames { color: #2563eb; grid-column: 1; }
  .col-header.net-strip { grid-column: 2; }
  .col-header.main-strip { grid-column: 3; }
  .col-header.other-strip { grid-column: 4; }

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
  .col-header.other-strip, .col-header.net-strip { background: #f4f6f9; }
  .net-col.col-main, .col-header.main-strip { background: #e6ebf1; }
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
  .screenshot-col .group-band { border-right: 3px solid var(--accent); }
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
  .screenshot-col .group-chip { right: 4px; }

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


</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div style="text-align:center;color:#666;font-size:12px;margin-bottom:12px;line-height:1.8">
    Ctrl + Mouse Wheel to zoom<br>
    Hover a rectangle for its full label
  </div>
  <div class="legend">${legendHtml}</div>

  <div class="header-row">
    <div class="col-header frames">Frames</div>
    <div class="col-header net net-strip">Network</div>
    <div class="col-header net main-strip">Main thread</div>
    <div class="col-header net other-strip">Events</div>
  </div>

  <div class="timeline-container">
    <div class="screenshot-col">
      ${renderGroupBands(profile)}
      ${renderScreenshots(profile)}
    </div>
    <div class="net-col col-net">
      ${renderStrip(strip.net)}
    </div>
    <div class="net-col col-main">
      ${renderStrip(strip.mainThread)}
    </div>
    <div class="net-col col-other">
      ${renderStrip(strip.other)}
    </div>
  </div>

  <script>
    (function() {
      const MAX_SCALE = 20;
      const BASE_HEIGHT = ${totalHeight};
      var viewportH = window.innerHeight;
      var MIN_SCALE = Math.min(0.1, viewportH / BASE_HEIGHT);
      var scale = Math.max(MIN_SCALE, Math.min(1, (2 * viewportH) / BASE_HEIGHT));

      // Collect all positioned elements and their original top values. Net bars
      // and group bands also carry a time-proportional height (data-h) that must
      // scale with the timeline; screenshots keep their intrinsic pixel height.
      const positioned = [];
      document.querySelectorAll('.screenshot-entry, .net-bar, .group-band').forEach(function(el) {
        positioned.push({ el: el, top: parseFloat(el.style.top), h: el.dataset.h ? parseFloat(el.dataset.h) : null });
      });
      const columns = document.querySelectorAll('.screenshot-col, .net-col');

      function applyScale() {
        var h = Math.ceil(BASE_HEIGHT * scale) + 'px';
        columns.forEach(function(col) { col.style.height = h; });
        positioned.forEach(function(p) {
          p.el.style.top = (p.top * scale) + 'px';
          if (p.h != null) p.el.style.height = (p.h * scale) + 'px';
        });
      }

      applyScale();

      var container = document.querySelector('.timeline-container');

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

      // Hover highlight: every rectangle sharing a key lights up together.
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

    })();
  </script>
  <script>
    // Ping the parent report so it knows the timeline rendered.
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


export interface GeneratePerformanceProfileTimelineOptions {
  profilePath: string;
  outputPath: string;
  title: string;
}

export function generatePerformanceProfileTimeline(
  options: GeneratePerformanceProfileTimelineOptions,
): void {
  const profile = parseProfile(options.profilePath);
  writeFileSync(options.outputPath, buildProfileTimelineHtml(profile, options.title));
}
