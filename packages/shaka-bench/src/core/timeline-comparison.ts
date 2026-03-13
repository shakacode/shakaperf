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
        timeMs: (e.ts - navStart) / 1000,
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
    const timeMs = (e.ts - navStart) / 1000;

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
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 20px;
  }
  h1 { text-align: center; color: #fff; margin-bottom: 8px; font-size: 20px; }
  .controls { text-align: center; margin-bottom: 16px; }
  .controls label { cursor: pointer; color: #aaa; font-size: 13px; margin: 0 12px; }
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
    background: #1a1a2e;
  }
  .col-header {
    text-align: center;
    font-weight: bold;
    padding: 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .col-header.control { color: #60a5fa; grid-column: 2; }
  .col-header.diff { color: #fb923c; grid-column: 3; }
  .col-header.experiment { color: #f87171; grid-column: 4; }

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
  .diff-entry img { border-color: #fb923c44; }
  .screenshot-entry img {
    max-width: 100%;
    max-height: ${FRAME_HEIGHT}px;
    border: 1px solid #333;
    border-radius: 3px;
    display: block;
  }
  .screenshot-col.control .screenshot-entry img { margin-left: auto; }
  .screenshot-entry .ts-label {
    font-size: 10px;
    color: #888;
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
    color: #888;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 10px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .event-marker .paint { color: #4ade80; font-weight: bold; }
  .event-marker .user-timing { color: #a78bfa; }
  .event-marker .layout-shift { color: #fb923c; }
  .event-marker .network-start { color: #6b7280; font-size: 10px; }
  .event-marker .network-end { color: #4b5563; font-size: 10px; }
  [data-key] { cursor: pointer; }
  [data-key].highlight { background: rgba(255, 255, 255, 0.15); border-radius: 2px; }
  .toast {
    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: rgba(30, 30, 50, 0.95); color: #f0f0f0; padding: 12px 24px;
    border-radius: 10px; font-size: 13px; z-index: 100;
    backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: toast-in 0.25s ease-out forwards;
  }
  .toast.dismissing {
    animation: toast-out 0.3s ease-in forwards;
  }
  .toast .toast-key { color: #f87171; font-weight: 600; }
  .toast .toast-side { color: #60a5fa; font-weight: 600; }
  .toast .toast-idx { color: #a78bfa; }
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
      let scale = 1;
      const MIN_SCALE = 0.1;
      const MAX_SCALE = 20;
      const BASE_HEIGHT = ${totalHeight};

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

        var delta = e.deltaY > 0 ? 0.9 : 1.1;
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
