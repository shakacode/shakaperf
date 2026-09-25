/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface TraceEvent {
  cat: string;
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: Record<string, any>;
}

interface TraceData {
  traceEvents: TraceEvent[];
}

// Path plus the GraphQL operation name; the origin and query string are
// noise between runs, and content hashes in file names differ per build.
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const operation = u.searchParams.get('operationName');
    const path = u.pathname.replace(/\.[0-9a-f]{8,}(?=\.)/g, '.*');
    return operation ? `${path}?operationName=${operation}` : path;
  } catch {
    return url;
  }
}

// Every heading carries the side it describes, so a diff of the two files
// never collapses two sections onto each other: a heading is always a change,
// which keeps each hunk anchored to the section it came from.
function generateSummary(data: TraceData, side: string): string {
  const events = data.traceEvents;
  const lines: string[] = [];

  function line(text = '') { lines.push(text); }

  // --- Total events ---
  line(`Performance Profile Summary (${side})`);
  line('============================');
  line();
  line(`Total events (${side}): ${events.length}`);

  // --- Thread names (from metadata, sorted, no PIDs) ---
  line();
  line(`Thread names (${side}):`);
  const threadNames = [...new Set(
    events
      .filter(e => e.cat === '__metadata' && e.name === 'thread_name' && e.args?.name)
      .map(e => e.args!.name as string)
  )].sort();
  for (const name of threadNames) line(`  ${name}`);

  // --- Categories (sorted by name) ---
  line();
  line(`Categories (${side}):`);
  const cats: Record<string, number> = {};
  for (const e of events) { cats[e.cat] = (cats[e.cat] || 0) + 1; }
  for (const [cat, count] of Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${cat}: ${count}`);
  }

  // --- Event names (sorted by name) ---
  line();
  line(`Event names (${side}):`);
  const names: Record<string, number> = {};
  for (const e of events) { names[e.name] = (names[e.name] || 0) + 1; }
  for (const [name, count] of Object.entries(names).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${name}: ${count}`);
  }

  // --- Phase types (sorted) ---
  line();
  line(`Phase types (${side}):`);
  const phases: Record<string, number> = {};
  for (const e of events) { phases[e.ph] = (phases[e.ph] || 0) + 1; }
  for (const [ph, count] of Object.entries(phases).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${ph}: ${count}`);
  }

  // --- Navigation timeline (fixed 250ms buckets from navigationStart) ---
  // One line per bucket, then one line per entry, entries sorted by name and
  // exact timestamps left out: two runs then differ only where something
  // moved to another bucket, appeared or disappeared.
  const bucketMs = 250;
  const navStart = events.find(e => e.name === 'navigationStart')?.ts;
  const timelineEvents = events.filter(e =>
    e.cat?.includes('blink.user_timing') ||
    ['firstContentfulPaint', 'firstPaint', 'largestContentfulPaint::Candidate'].includes(e.name) ||
    e.name === 'LayoutShift'
  );

  if (navStart != null) {
    const entries = new Map<number, string[]>();
    const addEntry = (ts: number, label: string) => {
      const bucket = Math.floor((ts - navStart) / (bucketMs * 1000));
      entries.set(bucket, [...(entries.get(bucket) ?? []), label]);
    };

    for (const e of timelineEvents) {
      const d = e.name === 'LayoutShift' ? e.args?.data : null;
      const suffix = d ? `  score=${d.score?.toFixed(4)}  cumulative=${d.cumulative_score?.toFixed(4)}` : '';
      addEntry(e.ts, `${e.name}${suffix}`);
    }

    // Network: one entry per request in the bucket it was sent, with the
    // transferred size and the send-to-finish duration.
    const requests = new Map<string, { ts: number; label: string; finishTs?: number; bytes?: number }>();
    for (const e of events) {
      const d = e.args?.data;
      if (!d?.requestId) continue;
      if (e.name === 'ResourceSendRequest' && d.url) {
        requests.set(d.requestId, { ts: e.ts, label: `${d.requestMethod ?? 'GET'} ${shortUrl(d.url)}` });
      } else if (e.name === 'ResourceFinish') {
        const request = requests.get(d.requestId);
        if (request) {
          request.finishTs = e.ts;
          request.bytes = d.encodedDataLength;
        }
      }
    }
    for (const request of requests.values()) {
      const size = request.bytes == null ? '?KB' : request.bytes === 0 ? 'cached' : `${(request.bytes / 1024).toFixed(1)}KB`;
      const duration = request.finishTs != null ? `${Math.round((request.finishTs - request.ts) / 10000) * 10}ms` : 'unfinished';
      addEntry(request.ts, `${request.label}  ${size}  ${duration}`);
    }

    if (entries.size > 0) {
      line();
      line(`Navigation timeline (${side}, ${bucketMs}ms buckets from navigationStart):`);
      // Each run of busy buckets is bracketed by its own boundaries, and quiet
      // stretches are left out: a group then reads as "between these two
      // times, this happened", and a diff points at one bounded group.
      let previous: number | null = null;
      for (const bucket of [...entries.keys()].sort((a, b) => a - b)) {
        if (previous !== bucket - 1) line(`  ${bucket * bucketMs}ms`);
        for (const label of entries.get(bucket)!.sort((a, b) => a.localeCompare(b))) line(`    ${label}`);
        line(`  ${(bucket + 1) * bucketMs}ms`);
        previous = bucket;
      }
    }
  }

  // --- Long tasks (>50ms) ---
  const longTasks = events
    .filter(e => e.ph === 'X' && e.dur && e.dur > 50000)
    .sort((a, b) => b.dur! - a.dur!);
  line();
  line(`Long tasks >50ms (${side}): ${longTasks.length}`);
  for (const t of longTasks.slice(0, 20)) {
    const relMs = navStart != null ? ((t.ts - navStart) / 1000).toFixed(1) : '?';
    line(`  ${(t.dur! / 1000).toFixed(1).padStart(8)}ms  at ${relMs.padStart(10)}ms  ${t.name}`);
  }

  // --- Timeline heatmap (fixed 250ms buckets) ---
  const timedEvents = events.filter(e => e.ts > 0);
  if (timedEvents.length > 0) {
    // Manual reduce instead of `Math.min(...arr)` / `Math.max(...arr)`:
    // V8's `Math.min` is variadic, and spreading a 100k+ event array onto
    // the call stack overflows it.
    let minTs = Infinity;
    for (const e of timedEvents) {
      if (e.ts < minTs) minTs = e.ts;
    }

    // Buckets are a fixed span anchored at navigationStart, not a slice of
    // whatever the trace happened to span: two runs then produce the same row
    // for the same moment, so their summaries diff line against line. A run
    // that starts before navigation gets negative labels.
    const zeroTs = navStart ?? minTs;
    const bucketOf = (ts: number) => Math.floor((ts - zeroTs) / (bucketMs * 1000));

    const counts = new Map<number, number>();
    const notables = new Map<number, Set<string>>();
    const noteIn = (bucket: number, note: string) => {
      const set = notables.get(bucket) ?? new Set<string>();
      set.add(note);
      notables.set(bucket, set);
    };

    // Reuse the navigation timeline events for notable markers
    const timelineEventSet = new Set(timelineEvents);

    // Build requestId -> URL map for network finish events
    const requestUrls = new Map<string, string>();
    for (const e of events) {
      if (e.name === 'ResourceSendRequest' && e.args?.data?.requestId && e.args.data.url) {
        requestUrls.set(e.args.data.requestId, e.args.data.url);
      }
    }

    // Per-bucket columns next to the event count, for the renderer main
    // thread(s) only: tasks over 1ms, tasks over 50ms, and script time
    // (FunctionCall + EvaluateScript + v8.compile). A task or script span is
    // charged to the bucket it starts in.
    const mainThreads = new Set(
      events
        .filter(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
        .map(e => `${e.pid}:${e.tid}`)
    );
    const onMainThread = (e: TraceEvent) => mainThreads.has(`${e.pid}:${e.tid}`);
    const tasksOver1 = new Map<number, number>();
    const tasksOver50 = new Map<number, number>();
    const jsMs = new Map<number, number>();
    const bump = (map: Map<number, number>, bucket: number, by: number) => map.set(bucket, (map.get(bucket) ?? 0) + by);
    const scriptEvents = new Set(['FunctionCall', 'EvaluateScript', 'v8.compile']);

    for (const e of timedEvents) {
      const bucket = bucketOf(e.ts);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);

      if (e.ph === 'X' && e.dur && onMainThread(e)) {
        if (e.name === 'RunTask' && e.dur > 1000) bump(tasksOver1, bucket, 1);
        if (e.name === 'RunTask' && e.dur > 50000) bump(tasksOver50, bucket, 1);
        if (scriptEvents.has(e.name)) bump(jsMs, bucket, e.dur / 1000);
      }

      if (timelineEventSet.has(e)) {
        noteIn(bucket, e.name);
      } else if (e.name === 'ResourceSendRequest' && e.args?.data?.url) {
        noteIn(bucket, `START:${e.args.data.url}`);
      } else if (e.name === 'ResourceFinish' && e.args?.data?.requestId) {
        const url = requestUrls.get(e.args.data.requestId) ?? e.args.data.requestId;
        noteIn(bucket, `END:${url}`);
      } else if (e.ph === 'X' && e.dur && e.dur > 50000) {
        noteIn(bucket, `LongTask:${e.name}(${(e.dur / 1000).toFixed(0)}ms)`);
      }
    }

    const filled = [...new Set([...counts.keys(), ...notables.keys()])].sort((a, b) => a - b);
    if (filled.length > 0) {
      // Each column scales its bar against its own maximum.
      const column = (values: Map<number, number>, barWidth: number, digits: number, format: (v: number) => string = String) => {
        let max = 0;
        for (const v of values.values()) if (v > max) max = v;
        return (bucket: number) => {
          const v = values.get(bucket) ?? 0;
          const bar = '\u2588'.repeat(max > 0 ? Math.round((v / max) * barWidth) : 0);
          return `${bar.padEnd(barWidth)} ${format(v).padStart(digits)}`;
        };
      };
      const columns = [
        column(counts, 30, 5),
        column(tasksOver1, 12, 4),
        column(tasksOver50, 12, 3),
        column(jsMs, 12, 6, v => v.toFixed(0)),
      ];

      line();
      line(`Timeline heatmap (${side}, ${bucketMs}ms buckets from navigationStart):`);
      line(`  ${'ms'.padStart(9)}  ${'events'.padEnd(36)}  ${'tasks>1ms'.padEnd(17)}  ${'tasks>50ms'.padEnd(16)}  ${'js ms'.padEnd(19)}  notable`);
      for (const bucket of filled) {
        const label = `${String(bucket * bucketMs).padStart(7)}ms`;
        const note = notables.get(bucket);
        const notes = note && note.size > 0 ? `  [${[...note].join(', ')}]` : '';
        line(`  ${label}  ${columns.map(render => render(bucket)).join('  ')}${notes}`);
      }
    }
  }

  line(); // trailing newline
  return lines.join('\n');
}

/** `side` names the run the profile came from - 'control' or 'experiment'. */
export function summarizePerformanceProfile(inputPath: string, outputPath: string, side: string): void {
  const data: TraceData = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const summary = generateSummary(data, side);
  writeFileSync(outputPath, summary);
}
