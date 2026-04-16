/**
 * Snapshot tests for the noise-resilience measurement campaign.
 *
 * For each (group, run) pair in testData/, regenerates a per-run
 * `conclusion-<N>.txt` next to its `ab-measurements-<N>.json` containing:
 *   - setup + statistical-method expectations for the group
 *   - perf-analyze (Wilcoxon Signed-Rank + Hodges-Lehmann) output for that run
 *   - paired (control, experiment) hydration-start values from that run
 *   - per-URL distribution heatmap (reuses the bucket-bar pattern from
 *     summarize-performance-profile.ts) so the noise blow-up is visible at a glance
 *
 * Run with `UPDATE_TESTDATA=1` to (re)write the committed conclusion files.
 */

import * as fs from 'fs';
import * as path from 'path';

import parseAbMeasurements from '../cli/compare/parse-ab-measurements';
import { GenerateStats } from '../cli/compare/generate-stats';
import { CompareResults } from '../cli/compare/compare-results';

const TEST_DATA_DIR = path.join(__dirname, '..', 'testData');
const METRIC = 'hydration-start';
const N_SAMPLES_PER_RUN = 8;

type Sampling = 'seq1' | 'seqP' | 'sim1' | 'simP';

interface Group {
  name: string;
  kind: 'noDifference' | 'regression';
  noise: 'low' | 'high';
  sampling: Sampling;
  controlURL: string;
  experimentURL: string;
}

const SAMPLINGS: ReadonlySet<Sampling> = new Set(['seq1', 'seqP', 'sim1', 'simP']);

function describeSampling(s: Sampling): string {
  const order = s.startsWith('seq') ? 'sequential (control campaign, then experiment campaign)' : 'simultaneous (control and experiment interleaved)';
  const parallelism = s.endsWith('1') ? 'parallelism = 1' : 'parallelism > 1';
  return `${order}, ${parallelism}`;
}

function discoverGroups(root: string): Group[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name): Group | null => {
      const m = name.match(/^(noDifference|regression)_(Low|High)Noise_(seq1|seqP|sim1|simP)$/);
      if (!m) return null;
      const kind = m[1] as 'noDifference' | 'regression';
      const noise = m[2] === 'High' ? 'high' : 'low';
      const sampling = m[3] as Sampling;
      if (!SAMPLINGS.has(sampling)) return null;
      const controlURL = 'http://localhost:3030/';
      const experimentURL =
        kind === 'regression' ? 'http://localhost:3030/?hydration_delay=50' : 'http://localhost:3030/';
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

function expectationsBlock(g: Group): string {
  const noiseLine =
    g.noise === 'high'
      ? 'Random CPU noise generator running in parallel (1-10s waves, 1-N cores @ 10-100% load).'
      : 'No additional CPU noise — only ambient system load.';
  const expectation =
    g.kind === 'regression'
      ? 'regression on hydration-start (~+50 ms, the injected hydration_delay)'
      : 'no difference on hydration-start';
  return `Setup:
  control    = ${g.controlURL}
  experiment = ${g.experimentURL}
  noise      = ${g.noise}
  ${noiseLine}
  sampling   = ${g.sampling} (${describeSampling(g.sampling)})

Expectation: ${expectation}
Statistical method: paired Wilcoxon Signed-Rank + Hodges-Lehmann (95% CI).
`;
}

function buildConclusion(g: Group, runIdx: number, file: string): string {
  const cr = analyze(file);
  const report = cr.getPlainTextSummary().trimEnd();
  const { control, experiment } = extractMetric(file);

  const min = Math.min(...control, ...experiment);
  const max = Math.max(...control, ...experiment);

  const tableHeader = `${g.controlURL.padEnd(48)}${g.experimentURL}`;
  const tableRows = control
    .map((c, i) => `${c.toFixed(1).padEnd(48)}${experiment[i].toFixed(1)}`)
    .join('\n');

  return [
    `=== ${g.name} run ${runIdx} ===`,
    '',
    expectationsBlock(g),
    `--- perf-analyze (${path.basename(file)}) ---`,
    report,
    '',
    `--- ${METRIC} paired values (${control.length} pairs) ---`,
    tableHeader,
    tableRows,
    '',
    `--- ${METRIC} distribution heatmap ---`,
    `control (${g.controlURL}):`,
    heatmap(control, min, max),
    `experiment (${g.experimentURL}):`,
    heatmap(experiment, min, max),
  ].join('\n');
}

describe('noise-resilience snapshot', () => {
  for (const group of GROUPS) {
    describe(group.name, () => {
      const groupDir = path.join(TEST_DATA_DIR, group.name);
      const runs = listMeasurementFiles(groupDir);
      for (const { idx, file } of runs) {
        test(`conclusion-${idx}.txt is up to date`, () => {
          const conclusion = buildConclusion(group, idx, file);
          const conclusionPath = path.join(groupDir, `conclusion-${idx}.txt`);

          if (process.env.UPDATE_TESTDATA === '1' || !fs.existsSync(conclusionPath)) {
            fs.writeFileSync(conclusionPath, conclusion);
          }

          const expected = fs.readFileSync(conclusionPath, 'utf-8');
          expect(conclusion).toBe(expected);
        });
      }
    });
  }
});
