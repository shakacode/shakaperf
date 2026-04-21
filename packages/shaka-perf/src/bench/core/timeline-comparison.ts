/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jpeg = require('jpeg-js') as { decode(buf: Buffer, opts?: { useTArray: boolean }): { width: number; height: number; data: Uint8Array } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pixelmatch = require('pixelmatch') as (img1: Uint8Array, img2: Uint8Array, output: Uint8Array | null, width: number, height: number, options?: { threshold?: number }) => number;

interface TraceEvent {
  cat: string;
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: Record<string, any>;
}

interface TraceData {
  traceEvents: TraceEvent[];
}

interface Screenshot {
  timeMs: number;
  dataUri: string;
  snapshot: Buffer; // raw JPEG bytes for pixel operations
}

interface DiffFrame {
  timeMs: number;
  dataUri: string;
}

interface TimelineEvent {
  timeMs: number;
  label: string;
  category: 'paint' | 'user-timing' | 'layout-shift' | 'network-start' | 'network-end';
  detail?: string;
}

interface ProfileData {
  screenshots: Screenshot[];
  events: TimelineEvent[];
  maxTimeMs: number;
  baseOrigin: string;
}

const PAINT_EVENTS = new Set([
  'firstPaint', 'firstContentfulPaint', 'largestContentfulPaint::Candidate',
]);

function parseProfile(filePath: string): ProfileData {
  const data: TraceData = JSON.parse(readFileSync(filePath, 'utf-8'));
  const events = data.traceEvents;

  const navStart = events.find(e => e.name === 'navigationStart')?.ts ?? 0;

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
  for (const e of events) {
    const timeMs = Math.max(0, (e.ts - navStart) / 1000);

    if (PAINT_EVENTS.has(e.name)) {
      timelineEvents.push({ timeMs, label: e.name, category: 'paint' });
    } else if (e.cat?.includes('blink.user_timing')) {
      timelineEvents.push({ timeMs, label: e.name, category: 'user-timing' });
    } else if (e.name === 'LayoutShift') {
      const score = e.args?.data?.score;
      timelineEvents.push({
        timeMs,
        label: 'LayoutShift',
        category: 'layout-shift',
        detail: score != null ? `score=${score.toFixed(4)}` : undefined,
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
  timelineEvents.sort((a, b) => a.timeMs - b.timeMs);

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

  return { screenshots, events: timelineEvents, maxTimeMs, baseOrigin };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMs(ms: number): string {
  return ms.toFixed(1) + 'ms';
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

  if (deltas.length === 0) return 3; // fallback

  const globalMinDelta = Math.min(...deltas);
  return Math.max(FRAME_SLOT / globalMinDelta, 0.5);
}

function decodeJpeg(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  const raw = jpeg.decode(buf, { useTArray: true });
  return { width: raw.width, height: raw.height, data: raw.data };
}

function encodePngDataUri(pixels: Uint8Array, width: number, height: number): string {
  const png = new PNG({ width, height });
  png.data = Buffer.from(pixels);
  const buf = PNG.sync.write(png);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function computeDiffFrames(control: ProfileData, experiment: ProfileData): DiffFrame[] {
  type Entry = { timeMs: number; side: 'control' | 'experiment'; screenshot: Screenshot };
  const entries: Entry[] = [
    ...control.screenshots.map(s => ({ timeMs: s.timeMs, side: 'control' as const, screenshot: s })),
    ...experiment.screenshots.map(s => ({ timeMs: s.timeMs, side: 'experiment' as const, screenshot: s })),
  ];
  entries.sort((a, b) => a.timeMs - b.timeMs);

  let latestControl: Screenshot | null = null;
  let latestExperiment: Screenshot | null = null;
  let previousDiffPixels: Uint8Array | null = null;
  let prevWidth = 0;
  let prevHeight = 0;
  const diffs: DiffFrame[] = [];

  for (const entry of entries) {
    if (entry.side === 'control') latestControl = entry.screenshot;
    else latestExperiment = entry.screenshot;

    if (!latestControl || !latestExperiment) continue;

    const imgA = decodeJpeg(latestControl.snapshot);
    const imgB = decodeJpeg(latestExperiment.snapshot);

    if (imgA.width !== imgB.width || imgA.height !== imgB.height) continue;

    const { width, height } = imgA;
    const diffPixels = new Uint8Array(width * height * 4);
    pixelmatch(imgA.data, imgB.data, diffPixels, width, height, { threshold: 0.3 });

    // Compare to previous diff for denoising
    if (previousDiffPixels && prevWidth === width && prevHeight === height) {
      const metaDiffCount = pixelmatch(previousDiffPixels, diffPixels, null, width, height, { threshold: 0.3 });
      if (metaDiffCount === 0) continue;
    }

    previousDiffPixels = diffPixels;
    prevWidth = width;
    prevHeight = height;
    diffs.push({
      timeMs: entry.timeMs,
      dataUri: encodePngDataUri(diffPixels, width, height),
    });
  }

  return diffs;
}

function computeFrameWidth(control: ProfileData, experiment: ProfileData): number {
  const first = control.screenshots[0] ?? experiment.screenshots[0];
  if (!first) return 120;
  const img = decodeJpeg(first.snapshot);
  return Math.round(img.width * FRAME_HEIGHT / img.height);
}

function buildTimelineHtml(control: ProfileData, experiment: ProfileData, diffFrames: DiffFrame[]): string {
  const maxTimeMs = Math.max(control.maxTimeMs, experiment.maxTimeMs, 1);
  const pxPerMs = computePxPerMs(control, experiment);
  const totalHeight = Math.ceil(maxTimeMs * pxPerMs) + FRAME_HEIGHT + 50;
  const frameWidth = computeFrameWidth(control, experiment);

  function renderScreenshots(profile: ProfileData): string {
    return profile.screenshots.map(s => {
      const top = Math.round(s.timeMs * pxPerMs);
      return `<div class="screenshot-entry" style="top:${top}px">
        <span class="ts-label">${formatMs(s.timeMs)}</span>
        <img src="${s.dataUri}" />
      </div>`;
    }).join('\n');
  }

  function renderDiffFrames(): string {
    return diffFrames.map(d => {
      const top = Math.round(d.timeMs * pxPerMs);
      return `<div class="screenshot-entry diff-entry" style="top:${top}px">
        <span class="ts-label">${formatMs(d.timeMs)}</span>
        <img src="${d.dataUri}" />
      </div>`;
    }).join('\n');
  }

  function eventKey(e: TimelineEvent, baseOrigin: string): string {
    const prefix = e.category === 'network-start' ? 'START ' : e.category === 'network-end' ? 'END ' : '';
    const label = baseOrigin && e.label.startsWith(baseOrigin) ? e.label.slice(baseOrigin.length) : e.label;
    return prefix + label;
  }

  function formatEventLabel(e: TimelineEvent, baseOrigin: string, side: string, idx: number): string {
    const key = eventKey(e, baseOrigin);
    const detail = e.detail ? ` (${escapeHtml(e.detail)})` : '';
    return `<span class="${e.category}" data-key="${escapeHtml(key)}" data-idx="${idx}" data-side="${side}">${escapeHtml(key)}${detail}</span>`;
  }

  function renderEvents(profile: ProfileData, side: 'control' | 'experiment'): string {
    const labelCounts = new Map<string, number>();

    // Group all events that share the same millisecond (rounded)
    const grouped = new Map<number, TimelineEvent[]>();
    for (const e of profile.events) {
      const key = Math.round(e.timeMs);
      const existing = grouped.get(key);
      if (existing) {
        existing.push(e);
      } else {
        grouped.set(key, [e]);
      }
    }

    const lines: string[] = [];
    for (const [ms, events] of grouped) {
      const top = Math.round(ms * pxPerMs);
      const labels = events.map(e => {
        const key = eventKey(e, profile.baseOrigin);
        const idx = labelCounts.get(key) ?? 0;
        labelCounts.set(key, idx + 1);
        return formatEventLabel(e, profile.baseOrigin, side, idx);
      }).join(', ');
      if (side === 'control') {
        lines.push(`<div class="event-marker" style="top:${top}px"><span class="labels">${labels}</span> <span class="time">${ms}ms</span></div>`);
      } else {
        lines.push(`<div class="event-marker" style="top:${top}px"><span class="time">${ms}ms</span> <span class="labels">${labels}</span></div>`);
      }
    }
    return lines.join('\n');
  }

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
    padding: 20px;
  }
  h1 { text-align: center; color: #111; margin-bottom: 8px; font-size: 20px; }
  .controls { text-align: center; margin-bottom: 16px; }
  .controls label { cursor: pointer; color: #5a6470; font-size: 13px; margin: 0 12px; }
  .controls input[type="checkbox"] { margin-right: 4px; }

  .timeline-container {
    display: grid;
    grid-template-columns: minmax(0,1fr) ${frameWidth}px ${frameWidth}px ${frameWidth}px minmax(0,1fr);
    gap: 0;
    margin: 0 auto;
    position: relative;
  }
  .header-row {
    display: grid;
    grid-template-columns: minmax(0,1fr) ${frameWidth}px ${frameWidth}px ${frameWidth}px minmax(0,1fr);
    gap: 0;
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
  .col-header.control { color: #2563eb; grid-column: 2; }
  .col-header.diff { color: #c2410c; grid-column: 3; }
  .col-header.experiment { color: #dc2626; grid-column: 4; }

  .screenshot-col {
    position: relative;
    height: ${totalHeight}px;
  }

  .events-col {
    position: relative;
    height: ${totalHeight}px;
    overflow: hidden;
  }
  .events-col.control .event-marker { right: 0; left: 0; text-align: right; }
  .events-col.experiment .event-marker { left: 0; right: 0; text-align: left; }

  .screenshot-entry {
    position: absolute;
    right: 0;
  }
  .screenshot-col.experiment .screenshot-entry,
  .screenshot-col.diff .screenshot-entry {
    right: auto;
    left: 0;
  }
  // .screenshot-col.diff .screenshot-entry { left: 50%; transform: translateX(-50%); }
  .diff-entry img { border-color: #c2410c66; }
  .screenshot-entry img {
    max-width: 100%;
    max-height: ${FRAME_HEIGHT}px;
    border: 1px solid #d1d5db;
    border-radius: 3px;
    display: block;
  }
  .screenshot-col.control .screenshot-entry img { margin-left: auto; }
  .screenshot-entry .ts-label {
    font-size: 10px;
    color: #6b7280;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .event-marker {
    position: absolute;
    font-size: 11px;
    line-height: 1.3;
    display: flex;
    gap: 4px;
  }
  .event-marker .labels {
    overflow-wrap: anywhere;
    min-width: 0;
    flex: 1;
  }
  .events-col.control .event-marker .labels { text-align: right; }
  .events-col.experiment .event-marker .labels { text-align: left; }
  .event-marker .time {
    color: #6b7280;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 10px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .event-marker .paint { color: #16a34a; font-weight: bold; }
  .event-marker .user-timing { color: #7c3aed; }
  .event-marker .layout-shift { color: #c2410c; }
  .event-marker .network-start { color: #6b7280; font-size: 10px; }
  .event-marker .network-end { color: #9ca3af; font-size: 10px; }
  [data-key] { cursor: pointer; }
  [data-key].highlight { background: rgba(0, 0, 0, 0.08); border-radius: 2px; }
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
    Hover to highlight matching events<br>
    Click to jump to the other side
  </div>

  <div class="header-row">
    <div class="col-header control">Control</div>
    <div class="col-header diff">Diff</div>
    <div class="col-header experiment">Experiment</div>
  </div>

  <div class="timeline-container">
    <div class="events-col control">
      ${renderEvents(control, 'control')}
    </div>
    <div class="screenshot-col control">
      ${renderScreenshots(control)}
    </div>
    <div class="screenshot-col diff">
      ${renderDiffFrames()}
    </div>
    <div class="screenshot-col experiment">
      ${renderScreenshots(experiment)}
    </div>
    <div class="events-col experiment">
      ${renderEvents(experiment, 'experiment')}
    </div>
  </div>

  <script>
    (function() {
      const MAX_SCALE = 20;
      const BASE_HEIGHT = ${totalHeight};
      var viewportH = window.innerHeight;
      var MIN_SCALE = Math.min(0.1, viewportH / BASE_HEIGHT);
      var scale = Math.max(MIN_SCALE, Math.min(1, (2 * viewportH) / BASE_HEIGHT));

      // Collect all positioned elements and their original top values
      const positioned = [];
      document.querySelectorAll('.screenshot-entry, .event-marker').forEach(function(el) {
        positioned.push({ el: el, top: parseFloat(el.style.top) });
      });
      const columns = document.querySelectorAll('.screenshot-col, .events-col');

      function applyScale() {
        var h = Math.ceil(BASE_HEIGHT * scale) + 'px';
        columns.forEach(function(col) { col.style.height = h; });
        positioned.forEach(function(p) { p.el.style.top = (p.top * scale) + 'px'; });
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

        // After scaling, that same timePos is now at a new pixel offset
        var newCursorInTimeline = timePos * scale;
        var newScrollY = newCursorInTimeline + containerTop - e.clientY;
        window.scrollTo(0, newScrollY);
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
        var span = e.target.closest('[data-key]');
        if (!span) return;
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
  const diffFrames = computeDiffFrames(control, experiment);
  const html = buildTimelineHtml(control, experiment, diffFrames);
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
