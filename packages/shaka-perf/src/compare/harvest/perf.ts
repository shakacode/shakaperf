import * as fs from 'fs';
import * as path from 'path';
import type {
  PerfArtifact,
  PerfDirection,
  PerfMetric,
  PerfMetricGroup,
  Status,
} from '../report';
import type { PerfConfig } from '../config';

// Metrics where a bigger value is a better result (e.g. Lighthouse score).
// Everything else (ms timings, CLS, bytes, counts) treats bigger = worse.
const HIGHER_IS_BETTER = new Set(['lh score', 'lighthouse score']);

function classifyGroup(heading: string | undefined): PerfMetricGroup {
  return heading && heading.toLowerCase().includes('diagnostic') ? 'diagnostics' : 'vitals';
}

function parseEstimatorDelta(str: string): { value: number; unit: string } {
  const m = str.match(/^(-?[\d.]+)(.*)$/);
  if (!m) return { value: 0, unit: '' };
  const value = parseFloat(m[1]);
  return { value: Number.isFinite(value) ? value : 0, unit: m[2] };
}

function formatWithUnit(value: number, unit: string): string {
  if (unit === 'ms' && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (unit === 'ms') return `${Math.round(value)}ms`;
  return `${value}${unit}`;
}

function formatDeltaWithUnit(value: number, unit: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatWithUnit(value, unit)}`;
}

function formatPercentDelta(percentMedian: number | undefined): string {
  if (percentMedian == null || !Number.isFinite(percentMedian)) return '—';
  const rounded = Math.abs(percentMedian) >= 10
    ? Math.round(percentMedian)
    : Math.round(percentMedian * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function classifyDirection(
  phaseName: string,
  deltaValue: number,
  isSignificant: boolean,
): PerfDirection {
  if (!isSignificant || deltaValue === 0) return 'none';
  const higherBetter = HIGHER_IS_BETTER.has(phaseName.toLowerCase());
  if (higherBetter) return deltaValue > 0 ? 'improvement' : 'regression';
  return deltaValue > 0 ? 'regression' : 'improvement';
}

export function slugifyForBench(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';
}

const ENGINE_ERROR_FILE = 'engine-error.txt';
const ENGINE_LOG_FILE = 'engine-output.log';
const MAX_LOG_BYTES = 512 * 1024;

/**
 * Returns the first line of `<perTestDir>/engine-error.txt` (written by bench's
 * per-test try/catch when a measurement fails) so it can be surfaced as the
 * perf card's `error` in place of real metrics. Returns null if the file is
 * absent — the common case.
 */
export function readPerfEngineError(perTestDir: string): string | null {
  const errPath = path.join(perTestDir, ENGINE_ERROR_FILE);
  try {
    const raw = fs.readFileSync(errPath, 'utf8').trim();
    if (!raw) return null;
    const firstLine = raw.split(/\r?\n/, 1)[0];
    return firstLine || null;
  } catch {
    return null;
  }
}

/**
 * Returns the captured engine stdout/stderr transcript for a failed test so it
 * can be embedded in the self-contained HTML report and opened via the error
 * banner's "view logs" action. Also includes the full stack from
 * `engine-error.txt` at the top — the log alone is the interleaved worker
 * output, while the stack pinpoints where the throw came from.
 * Truncates from the head if the combined payload is larger than
 * `MAX_LOG_BYTES` so a multi-MB transcript doesn't balloon the report.
 */
export function readPerfEngineLog(perTestDir: string): string | null {
  const stack = safeReadFile(path.join(perTestDir, ENGINE_ERROR_FILE));
  const log = safeReadFile(path.join(perTestDir, ENGINE_LOG_FILE));
  if (stack == null && log == null) return null;
  const parts: string[] = [];
  if (stack) parts.push('── error ──', stack.trim(), '');
  if (log) parts.push('── engine output ──', log.trim());
  const combined = parts.join('\n');
  if (combined.length <= MAX_LOG_BYTES) return combined;
  const head = '[… truncated; see the on-disk engine-output.log for the full transcript …]\n';
  return head + combined.slice(combined.length - MAX_LOG_BYTES);
}

function safeReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

interface BenchSevenFigureSummary {
  '10'?: number;
  '25'?: number;
  '50'?: number;
  '75'?: number;
  '90'?: number;
  min?: number;
  max?: number;
}

interface BenchJsonMetric {
  heading?: string;
  phaseName: string;
  isSignificant: boolean;
  estimatorDelta: string;
  pValue: number;
  controlSevenFigureSummary?: BenchSevenFigureSummary;
  experimentSevenFigureSummary?: BenchSevenFigureSummary;
  asPercent?: { percentMedian?: number };
}

interface BenchCompareJsonResults {
  vitalsTableData?: BenchJsonMetric[];
  diagnosticsTableData?: BenchJsonMetric[];
}

export interface HarvestPerfOptions {
  perTestDir: string;
  controlURL: string;
  experimentURL: string;
  perfConfig: PerfConfig;
  reportRoot: string;
  slug: string;
  viewportLabel: string;
}

/**
 * Reads bench's per-test `<slug>/report.json` (shape: ICompareJSONResults)
 * plus sibling artifact files, and emits one PerfArtifact tagged with
 * `viewportLabel`. Callers that measured N viewports call this N times and
 * collect the results into a single `CategoryResult.perfs` array — the same
 * shape visreg uses for its per-viewport pairs.
 */
export function harvestPerf(opts: HarvestPerfOptions): PerfArtifact {
  const { perTestDir, controlURL, experimentURL, perfConfig, reportRoot, slug, viewportLabel } = opts;

  const metrics: PerfMetric[] = [];
  const regressedMetrics: string[] = [];
  const improvedMetrics: string[] = [];
  let status: Status = 'no_difference';
  void perfConfig;

  const reportJsonPath = path.join(perTestDir, 'report.json');
  if (fs.existsSync(reportJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8')) as BenchCompareJsonResults;
      const allEntries = [
        ...(raw.vitalsTableData ?? []),
        ...(raw.diagnosticsTableData ?? []),
      ];
      for (const entry of allEntries) {
        const { value: deltaValue, unit } = parseEstimatorDelta(entry.estimatorDelta);
        const controlValue = entry.controlSevenFigureSummary?.['50'] ?? 0;
        const experimentValue = entry.experimentSevenFigureSummary?.['50'] ?? 0;
        const direction = classifyDirection(entry.phaseName, deltaValue, entry.isSignificant);

        metrics.push({
          label: entry.phaseName,
          group: classifyGroup(entry.heading),
          controlDisplay: formatWithUnit(controlValue, unit),
          experimentDisplay: formatWithUnit(experimentValue, unit),
          deltaDisplay: formatDeltaWithUnit(deltaValue, unit),
          percentDisplay: formatPercentDelta(entry.asPercent?.percentMedian),
          pValue: entry.pValue,
          direction,
        });

        if (direction === 'regression') {
          regressedMetrics.push(entry.phaseName);
          status = 'regression';
        } else if (direction === 'improvement') {
          improvedMetrics.push(entry.phaseName);
          if (status === 'no_difference') status = 'improvement';
        }
      }
    } catch (err) {
      throw new Error(
        `perf report.json unreadable at ${reportJsonPath}: ${(err as Error).message}`,
      );
    }
  }

  const files = safeReaddir(perTestDir);
  const controlHost = urlHostSegment(controlURL);
  const experimentHost = urlHostSegment(experimentURL);

  // Inline artifact HTMLs as data URIs so the final report is a fully
  // self-contained file — no sibling directories required, no broken links
  // when clients open the report from a different path than where compare
  // ran. `reportRoot` is still used to size the relative-path fallback if
  // we later want to toggle back to external refs.
  void reportRoot;
  const inlineHtml = (name: string | null): string | null => {
    if (!name) return null;
    try {
      const content = fs.readFileSync(path.join(perTestDir, name));
      return `data:text/html;base64,${content.toString('base64')}`;
    } catch {
      return null;
    }
  };

  const controlLh = files.find(
    (f) => f.startsWith(controlHost) && f.endsWith('_lighthouse_report.html'),
  ) ?? null;
  const experimentLh = files.find(
    (f) => f.startsWith(experimentHost) && f.endsWith('_lighthouse_report.html'),
  ) ?? null;
  const timeline = files.find((f) => f === 'timeline_comparison.html') ?? null;
  const timelinePreview = files.find((f) => f === 'timeline_preview.svg') ?? null;
  // Legacy bench Handlebars report: `artifact-<n>.html`. Pick the highest-numbered
  // one so re-runs into the same results folder surface the freshest render.
  const benchReport = files
    .filter((f) => /^artifact-\d+\.html$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0], 10);
      const nb = parseInt(b.match(/\d+/)![0], 10);
      return nb - na;
    })[0] ?? null;
  // bench emits one `<artifact>.diff.html` per txt pair (network_activity,
  // performance_profile.summary, …) so each gets its own button in the report.
  const diffFiles = files.filter((f) => f.endsWith('.diff.html')).sort();

  // Only inline the preview SVG when the test actually moved off
  // `no_difference` — a flat row doesn't need the glanceable triplet grid,
  // and the file can be multi-hundred-KB (10 embedded JPEGs + a PNG diff),
  // so skipping it saves ~1 MB × (no-diff tests count) in the report.
  const shouldIncludePreview = status !== 'no_difference';
  const timelinePreviewSvg = shouldIncludePreview && timelinePreview
    ? (() => {
        try {
          return fs.readFileSync(path.join(perTestDir, timelinePreview), 'utf8');
        } catch {
          return null;
        }
      })()
    : null;

  // Ensure the slug is referenced even if perTestDir never existed (e.g.
  // the viewport's bench run errored before writing report.json).
  void slug;

  return {
    viewportLabel,
    metrics,
    regressedMetrics,
    improvedMetrics,
    controlLighthouseHref: inlineHtml(controlLh),
    experimentLighthouseHref: inlineHtml(experimentLh),
    timelineHref: inlineHtml(timeline),
    timelinePreviewSvg,
    benchReportHref: inlineHtml(benchReport),
    diffHrefs: diffFiles
      .map((f) => ({ label: prettyDiffLabel(f), href: inlineHtml(f) }))
      .filter((d): d is { label: string; href: string } => d.href != null),
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function urlHostSegment(url: string): string {
  try {
    return new URL(url).host.replace(':', '_');
  } catch {
    return '';
  }
}

function prettyDiffLabel(filename: string): string {
  const base = filename.replace(/\.diff\.html$/, '');
  if (base === 'network_activity') return 'network diff';
  if (base === 'performance_profile.summary') return 'profile diff';
  return `${base.replace(/_/g, ' ')} diff`;
}
