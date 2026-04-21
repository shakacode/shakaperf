import * as fs from 'fs';
import * as path from 'path';
import type {
  CategoryResult,
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
}

/**
 * Reads bench's per-test `<slug>/report.json` (shape: ICompareJSONResults)
 * plus sibling artifact files, and emits a CategoryResult with metrics +
 * relative artifact hrefs (relative to `reportRoot` which is where
 * `compare-results/report.html` will live).
 */
export function harvestPerf(opts: HarvestPerfOptions): CategoryResult {
  const { perTestDir, controlURL, experimentURL, perfConfig, reportRoot, slug } = opts;

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
    } catch {
      // report.json unreadable — leave metrics empty, status no_difference
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
  // Legacy bench Handlebars report: `artifact-<n>.html`. Pick the highest-numbered
  // one so re-runs into the same results folder surface the freshest render.
  const benchReport = files
    .filter((f) => /^artifact-\d+\.html$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0], 10);
      const nb = parseInt(b.match(/\d+/)![0], 10);
      return nb - na;
    })[0] ?? null;
  const diffFiles = files.filter((f) => f.endsWith('.diff.html'));

  const perf: PerfArtifact = {
    metrics,
    regressedMetrics,
    improvedMetrics,
    controlLighthouseHref: inlineHtml(controlLh),
    experimentLighthouseHref: inlineHtml(experimentLh),
    timelineHref: inlineHtml(timeline),
    benchReportHref: inlineHtml(benchReport),
    diffHrefs: diffFiles
      .map((f) => ({ label: prettyDiffLabel(f), href: inlineHtml(f) }))
      .filter((d): d is { label: string; href: string } => d.href != null),
  };

  // Ensure the slug survives even if perTestDir never existed (e.g. perf was
  // skipped for this test because the engine errored). We still emit an empty
  // category so the card shows "no perf metrics".
  void slug;

  return { category: 'perf', status, perf };
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
  // bench names diff files either as "network_activity" /
  // "performance_profile.summary" (no prefix) or
  // "<slug>__network_activity" / "<slug>__performance_profile.summary".
  // Strip any "<slug>__" prefix before matching.
  const stripped = base.replace(/^[^_]+__/, '');
  if (stripped === 'network_activity') return 'network diff';
  if (stripped === 'performance_profile.summary') return 'profile diff';
  return `${stripped.replace(/_/g, ' ')} diff`;
}
