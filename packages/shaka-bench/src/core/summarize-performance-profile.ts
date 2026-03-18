import { readFileSync, writeFileSync } from 'node:fs';

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

function generateSummary(data: TraceData): string {
  const events = data.traceEvents;
  const lines: string[] = [];

  function line(text = '') { lines.push(text); }

  // --- Total events ---
  line('Performance Profile Summary');
  line('============================');
  line();
  line(`Total events: ${events.length}`);

  // --- Thread names (from metadata, sorted, no PIDs) ---
  line();
  line('Thread names:');
  const threadNames = [...new Set(
    events
      .filter(e => e.cat === '__metadata' && e.name === 'thread_name' && e.args?.name)
      .map(e => e.args!.name as string)
  )].sort();
  for (const name of threadNames) line(`  ${name}`);

  // --- Categories (sorted by name) ---
  line();
  line('Categories:');
  const cats: Record<string, number> = {};
  for (const e of events) { cats[e.cat] = (cats[e.cat] || 0) + 1; }
  for (const [cat, count] of Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${cat}: ${count}`);
  }

  // --- Event names (sorted by name) ---
  line();
  line('Event names:');
  const names: Record<string, number> = {};
  for (const e of events) { names[e.name] = (names[e.name] || 0) + 1; }
  for (const [name, count] of Object.entries(names).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${name}: ${count}`);
  }

  // --- Phase types (sorted) ---
  line();
  line('Phase types:');
  const phases: Record<string, number> = {};
  for (const e of events) { phases[e.ph] = (phases[e.ph] || 0) + 1; }
  for (const [ph, count] of Object.entries(phases).sort((a, b) => a[0].localeCompare(b[0]))) {
    line(`  ${ph}: ${count}`);
  }

  // --- Navigation timeline (relative ms from navigationStart) ---
  const navStart = events.find(e => e.name === 'navigationStart')?.ts;
  const timelineEvents = events.filter(e =>
    e.cat?.includes('blink.user_timing') ||
    ['firstContentfulPaint', 'firstPaint', 'largestContentfulPaint::Candidate'].includes(e.name) ||
    e.name === 'LayoutShift'
  );

  if (navStart != null && timelineEvents.length > 0) {
    line();
    line('Navigation timeline (ms from navigationStart):');
    const sorted = timelineEvents
      .map(e => {
        const ms = (e.ts - navStart) / 1000;
        const d = e.name === 'LayoutShift' ? e.args?.data : null;
        const suffix = d ? `  score=${d.score?.toFixed(4)}  cumulative=${d.cumulative_score?.toFixed(4)}` : '';
        return { name: e.name, ms, suffix };
      })
      .sort((a, b) => a.ms - b.ms || a.name.localeCompare(b.name));
    for (const e of sorted) {
      line(`  ${(e.ms.toFixed(1) + 'ms').padStart(12)}  ${e.name}${e.suffix}`);
    }
  }

  // --- Long tasks (>50ms) ---
  const longTasks = events
    .filter(e => e.ph === 'X' && e.dur && e.dur > 50000)
    .sort((a, b) => b.dur! - a.dur!);
  line();
  line(`Long tasks (>50ms): ${longTasks.length}`);
  for (const t of longTasks.slice(0, 20)) {
    const relMs = navStart != null ? ((t.ts - navStart) / 1000).toFixed(1) : '?';
    line(`  ${(t.dur! / 1000).toFixed(1).padStart(8)}ms  at ${relMs.padStart(10)}ms  ${t.name}`);
  }

  // --- Timeline heatmap (50 buckets) ---
  const timedEvents = events.filter(e => e.ts > 0);
  if (timedEvents.length > 0) {
    const minTs = Math.min(...timedEvents.map(e => e.ts));
    const maxTs = Math.max(...timedEvents.map(e => e.ts));
    const range = maxTs - minTs;

    if (range > 0) {
      const bucketCount = 500;
      const buckets = new Array(bucketCount).fill(0);
      const bucketNotables: Set<string>[] = Array.from({ length: bucketCount }, () => new Set());

      // Reuse the navigation timeline events for notable markers
      const timelineEventSet = new Set(timelineEvents);

      // Build requestId -> URL map for network finish events
      const requestUrls = new Map<string, string>();
      for (const e of events) {
        if (e.name === 'ResourceSendRequest' && e.args?.data?.requestId && e.args.data.url) {
          requestUrls.set(e.args.data.requestId, e.args.data.url);
        }
      }

      for (const e of timedEvents) {
        const idx = Math.min(Math.floor(((e.ts - minTs) / range) * bucketCount), bucketCount - 1);
        buckets[idx]++;

        if (timelineEventSet.has(e)) {
          bucketNotables[idx].add(e.name);
        } else if (e.name === 'ResourceSendRequest' && e.args?.data?.url) {
          bucketNotables[idx].add(`START:${e.args.data.url}`);
        } else if (e.name === 'ResourceFinish' && e.args?.data?.requestId) {
          const url = requestUrls.get(e.args.data.requestId) ?? e.args.data.requestId;
          bucketNotables[idx].add(`END:${url}`);
        } else if (e.ph === 'X' && e.dur && e.dur > 50000) {
          bucketNotables[idx].add(`LongTask:${e.name}(${(e.dur / 1000).toFixed(0)}ms)`);
        }
      }

      const maxBucket = Math.max(...buckets);
      const barWidth = 30;

      const rangeMs = range / 1000; // microseconds to milliseconds

      line();
      line('Timeline heatmap (500 buckets):');
      for (let i = 0; i < bucketCount; i++) {
        if (buckets[i] === 0 && bucketNotables[i].size === 0) continue;
        const barLen = Math.round((buckets[i] / maxBucket) * barWidth);
        const bar = '\u2588'.repeat(barLen);
        const startMs = ((i / bucketCount) * rangeMs).toFixed(0);
        const label = `${startMs.padStart(7)}ms`;
        const notables = bucketNotables[i].size > 0
          ? `  [${[...bucketNotables[i]].join(', ')}]`
          : '';
        line(`  ${label}  ${bar.padEnd(barWidth)}  ${String(buckets[i]).padStart(5)}${notables}`);
      }
    }
  }

  line(); // trailing newline
  return lines.join('\n');
}

export function summarizePerformanceProfile(inputPath: string, outputPath: string): void {
  const data: TraceData = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const summary = generateSummary(data);
  writeFileSync(outputPath, summary);
}
