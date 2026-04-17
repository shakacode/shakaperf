/**
 * Snapshot tests for the noise-resilience measurement campaign.
 *
 * For each (group, run) pair in testData/, regenerates a per-run
 * `test-results-<N>.txt` next to its `ab-measurements-<N>.json` containing:
 *   - setup + statistical-method expectations for the group
 *   - perf-analyze (Wilcoxon Signed-Rank + Hodges-Lehmann) output for that run
 *   - paired (control, experiment) hydration-start values from that run
 *   - per-URL distribution heatmap (reuses the bucket-bar pattern from
 *     summarize-performance-profile.ts) so the noise blow-up is visible at a glance
 *
 * Run with `UPDATE_TESTDATA=1` to (re)write the committed test-results files.
 */

import * as fs from 'fs';
import * as path from 'path';

import parseAbMeasurements from '../cli/compare/parse-ab-measurements';
import { GenerateStats } from '../cli/compare/generate-stats';
import { CompareResults } from '../cli/compare/compare-results';

const TEST_DATA_DIR = path.join(__dirname, '..', 'testData');
const METRIC = 'hydration-start';
const N_SAMPLES_PER_RUN = 8;

type Sampling =
  | 'sequentialSampling_singleProcess'
  | 'sequentialSampling_multiProcess'
  | 'simultaneousSampling_singleProcess'
  | 'simultaneousSampling_multiProcess';

interface Group {
  name: string;
  kind: 'noDifference' | 'regression';
  noise: 'low' | 'high';
  sampling: Sampling;
  controlURL: string;
  experimentURL: string;
}

const SAMPLINGS: ReadonlySet<string> = new Set([
  'sequentialSampling_singleProcess',
  'sequentialSampling_multiProcess',
  'simultaneousSampling_singleProcess',
  'simultaneousSampling_multiProcess',
]);

function discoverGroups(root: string): Group[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name): Group | null => {
      const m = name.match(/^(noDifference|regression)_(Low|High)Noise_((?:sequential|simultaneous)Sampling_(?:single|multi)Process)$/);
      if (!m) return null;
      const kind = m[1] as 'noDifference' | 'regression';
      const noise = m[2] === 'High' ? 'high' : 'low';
      const sampling = m[3] as Sampling;
      if (!SAMPLINGS.has(sampling)) return null;
      const controlURL = 'http://localhost:3030/';
      const experimentURL =
        kind === 'regression' ? 'http://localhost:3030/?hydration_delay=10' : 'http://localhost:3030/';
      return { name, kind, noise, sampling, controlURL, experimentURL };
    })
    .filter((g): g is Group => g !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const GROUPS: Group[] = discoverGroups(TEST_DATA_DIR);

function listMeasurementFiles(groupDir: string): { idx: number; file: string }[] {
  return fs
    .readdirSync(groupDir)
    .map((f) => {
      const m = f.match(/^ab-measurements-(\d+)\.json$/);
      return m ? { idx: parseInt(m[1], 10), file: path.join(groupDir, f) } : null;
    })
    .filter((x): x is { idx: number; file: string } => x !== null)
    .sort((a, b) => a.idx - b.idx);
}

function extractMetric(file: string): { control: number[]; experiment: number[] } {
  const { controlData, experimentData } = parseAbMeasurements(file);
  const pull = (samples: typeof controlData.samples): number[] =>
    samples.map((s) => {
      const phase = s.phases.find((p) => p.phase === METRIC);
      // raw "duration" is in microseconds for ms-unit phases — convert to ms
      return phase ? phase.duration / 1000 : NaN;
    });
  return { control: pull(controlData.samples), experiment: pull(experimentData.samples) };
}

function analyze(file: string): CompareResults {
  const { controlData, experimentData } = parseAbMeasurements(file);
  const stats = new GenerateStats(
    controlData,
    experimentData,
    {
      servers: [{ name: 'Control' }, { name: 'Experiment' }],
      plotTitle: 'TracerBench',
      browserVersion: controlData.meta.browserVersion ?? 'unknown',
    },
    undefined,
  );
  return new CompareResults(stats, N_SAMPLES_PER_RUN, 50, 'estimator');
}

/**
 * ASCII distribution heatmap. Bucketing pattern matches the timeline-heatmap
 * code in src/bench/core/summarize-performance-profile.ts: count points per
 * fixed-width bucket, draw a `█`-bar scaled to the maximum bucket.
 */
function heatmap(values: number[], min: number, max: number, bucketCount = 20, barWidth = 30): string {
  const range = max - min;
  if (range <= 0 || values.length === 0) return '  (no data)\n';
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor(((v - min) / range) * bucketCount), bucketCount - 1);
    buckets[Math.max(0, idx)]++;
  }
  const maxBucket = Math.max(...buckets);
  const out: string[] = [];
  const bucketSize = range / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * bucketSize;
    const barLen = maxBucket > 0 ? Math.round((buckets[i] / maxBucket) * barWidth) : 0;
    const bar = '\u2588'.repeat(barLen);
    out.push(
      `  ${lo.toFixed(0).padStart(6)}ms  ${bar.padEnd(barWidth)}  ${String(buckets[i]).padStart(4)}`,
    );
  }
  return out.join('\n') + '\n';
}

function buildConclusion(g: Group, runIdx: number, file: string): string {
  const cr = analyze(file);
  const report = cr.getPlainTextSummary().trimEnd();
  const { control, experiment } = extractMetric(file);

  const min = Math.min(...control, ...experiment);
  const max = Math.max(...control, ...experiment);

  const tableHeader = `control${' '.repeat(41)}experiment`;
  const tableRows = control
    .map((c, i) => `${c.toFixed(1).padEnd(48)}${experiment[i].toFixed(1)}`)
    .join('\n');

  return [
    `=== ${g.name} run ${runIdx} ===`,
    report,
    '',
    `--- paired values (${control.length} pairs) ---`,
    tableHeader,
    tableRows,
    '',
    '--- heatmap ---',
    'control:',
    heatmap(control, min, max),
    'experiment:',
    heatmap(experiment, min, max),
  ].join('\n');
}

function generateSummary(): string {
  interface GroupTally {
    name: string;
    runs: number;
    detected: number;
    pValues: number[];
    totalDurationSec: number | null;
  }

  const tallies: GroupTally[] = [];

  for (const group of GROUPS) {
    const groupDir = path.join(TEST_DATA_DIR, group.name);
    const resultFiles = fs
      .readdirSync(groupDir)
      .filter((f) => /^test-results-\d+\.txt$/.test(f))
      .sort();

    const tally: GroupTally = { name: group.name, runs: 0, detected: 0, pValues: [], totalDurationSec: null };

    // Read per-run durations if available
    const durationsPath = path.join(groupDir, 'durations.json');
    let durations: Record<string, number> = {};
    if (fs.existsSync(durationsPath)) {
      durations = JSON.parse(fs.readFileSync(durationsPath, 'utf-8'));
      tally.totalDurationSec = Object.values(durations).reduce((a, b) => a + b, 0);
    }

    for (const file of resultFiles) {
      const content = fs.readFileSync(path.join(groupDir, file), 'utf-8');
      // Find the perf-analyze hydration-start line (indented, not in headers)
      const match = content.match(/^ {2}hydration-start .+$/m);
      if (!match) continue;
      tally.runs++;
      const line = match[0];
      const regMatch = line.match(/estimated regression .+p=([0-9.e-]+)/);
      if (regMatch) {
        tally.detected++;
        tally.pValues.push(parseFloat(regMatch[1]));
      }
    }
    tallies.push(tally);
  }

  function formatPValue(pValues: number[]): string {
    if (pValues.length === 0) return 'N/A';
    return (pValues.reduce((a, b) => a + b, 0) / pValues.length)
      .toExponential(2)
      .replace(/e([+-])(\d)$/, 'e$10$2');
  }

  function formatDuration(sec: number | null): string {
    if (sec === null) return 'N/A';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m${s}s` : `${s}s`;
  }

  // Column definitions
  const headers = ['Group', 'Regressions', 'p-value', 'Duration'];

  const rows = tallies.map((t) => [
    t.name,
    `${t.detected}/${t.runs}`,
    formatPValue(t.pValues),
    formatDuration(t.totalDurationSec),
  ]);

  // Compute column widths
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const pad = (s: string, w: number, right: boolean) => (right ? s.padStart(w) : s.padEnd(w));
  const isRight = [false, true, true, true];

  const headerLine = '| ' + headers.map((h, i) => pad(h, widths[i], isRight[i])).join(' | ') + ' |';
  const sepLine =
    '| ' +
    widths.map((w, i) => (isRight[i] ? '-'.repeat(w - 1) + ':' : '-'.repeat(w))).join(' | ') +
    ' |';
  const dataLines = rows.map(
    (r) => '| ' + r.map((c, i) => pad(c, widths[i], isRight[i])).join(' | ') + ' |',
  );

  return ['# Noise-Resilience Summary', '', headerLine, sepLine, ...dataLines, ''].join('\n');
}

describe('noise-resilience snapshot', () => {
  for (const group of GROUPS) {
    describe(group.name, () => {
      const groupDir = path.join(TEST_DATA_DIR, group.name);
      const runs = listMeasurementFiles(groupDir);
      for (const { idx, file } of runs) {
        test(`test-results-${idx}.txt is up to date`, () => {
          const result = buildConclusion(group, idx, file);
          const resultPath = path.join(groupDir, `test-results-${idx}.txt`);

          if (process.env.UPDATE_TESTDATA === '1' || !fs.existsSync(resultPath)) {
            fs.writeFileSync(resultPath, result);
          }

          const expected = fs.readFileSync(resultPath, 'utf-8');
          expect(result).toBe(expected);
        });
      }
    });
  }

  test('SUMMARY.md is up to date', () => {
    const summary = generateSummary();
    const summaryPath = path.join(TEST_DATA_DIR, 'SUMMARY.md');

    if (process.env.UPDATE_TESTDATA === '1') {
      fs.writeFileSync(summaryPath, summary);
    }

    const expected = fs.readFileSync(summaryPath, 'utf-8');
    expect(summary).toBe(expected);
  });
});
