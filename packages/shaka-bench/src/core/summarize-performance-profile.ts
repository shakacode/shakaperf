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
    ['firstContentfulPaint', 'firstPaint', 'largestContentfulPaint::Candidate'].includes(e.name)
  );

  if (navStart != null && timelineEvents.length > 0) {
    line();
    line('Navigation timeline (ms from navigationStart):');
    const sorted = timelineEvents
      .map(e => ({ name: e.name, ms: (e.ts - navStart) / 1000 }))
      .sort((a, b) => a.ms - b.ms || a.name.localeCompare(b.name));
    for (const e of sorted) {
      line(`  ${e.ms.toFixed(1).padStart(10)}  ${e.name}`);
    }
  }

  // --- Layout shifts ---
  const layoutShifts = events.filter(e => e.name === 'LayoutShift');
  line();
  line(`Layout shifts: ${layoutShifts.length}`);
  for (let i = 0; i < layoutShifts.length; i++) {
    const d = layoutShifts[i].args?.data;
    if (d) {
      line(`  #${i + 1}  score=${d.score?.toFixed(4)}  cumulative=${d.cumulative_score?.toFixed(4)}  had_recent_input=${d.had_recent_input}`);
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

  // --- Timeline heatmap (10 buckets) ---
  const timedEvents = events.filter(e => e.ts > 0);
  if (timedEvents.length > 0) {
    const minTs = Math.min(...timedEvents.map(e => e.ts));
    const maxTs = Math.max(...timedEvents.map(e => e.ts));
    const range = maxTs - minTs;

    if (range > 0) {
      const bucketCount = 10;
      const buckets = new Array(bucketCount).fill(0);

      for (const e of timedEvents) {
        const idx = Math.min(Math.floor(((e.ts - minTs) / range) * bucketCount), bucketCount - 1);
        buckets[idx]++;
      }

      const maxBucket = Math.max(...buckets);
      const barWidth = 40;

      line();
      line('Timeline heatmap (10 buckets):');
      for (let i = 0; i < bucketCount; i++) {
        const pct = ((buckets[i] / timedEvents.length) * 100).toFixed(1);
        const barLen = Math.round((buckets[i] / maxBucket) * barWidth);
        const bar = '\u2588'.repeat(barLen);
        const label = `${(i * 10).toString().padStart(3)}-${((i + 1) * 10).toString().padStart(3)}%`;
        line(`  ${label}  ${bar.padEnd(barWidth)}  ${String(buckets[i]).padStart(5)} events (${pct.padStart(5)}%)`);
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
