import * as fs from 'fs';
import * as path from 'path';
import type { CategoryResult, PerfArtifact, PerfMetric, Status } from '../report/types';
import type { PerfConfig } from '../config';

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
}

interface BenchCompareJsonResults {
  benchmarkTableData?: BenchJsonMetric[];
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
  const regressionThreshold = perfConfig.regressionThreshold ?? 0;

  const reportJsonPath = path.join(perTestDir, 'report.json');
  if (fs.existsSync(reportJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8')) as BenchCompareJsonResults;
      const allEntries = [
        ...(raw.benchmarkTableData ?? []),
        ...(raw.vitalsTableData ?? []),
        ...(raw.diagnosticsTableData ?? []),
      ];
      for (const entry of allEntries) {
        // bench's estimatorDelta is a unit-suffixed string ("14ms", "0KB",
        // "0 count"). We only surface ms metrics in the unified report to
        // keep PerfSlot's ms formatting honest.
        if (!/ms\b/.test(entry.estimatorDelta)) continue;

        const hlDiffMs = parseFloat(entry.estimatorDelta);
        const controlMs = entry.controlSevenFigureSummary?.['50'] ?? 0;
        const experimentMs = entry.experimentSevenFigureSummary?.['50'] ?? 0;
        metrics.push({
          label: entry.phaseName,
          controlMs,
          experimentMs,
          hlDiffMs: Number.isFinite(hlDiffMs) ? hlDiffMs : 0,
          pValue: entry.pValue,
          significant: entry.isSignificant,
        });

        if (entry.isSignificant && Number.isFinite(hlDiffMs)) {
          if (hlDiffMs > regressionThreshold) {
            regressedMetrics.push(entry.phaseName);
            status = 'regression';
          } else if (hlDiffMs < -regressionThreshold) {
            improvedMetrics.push(entry.phaseName);
            if (status === 'no_difference') status = 'improvement';
          }
        }
      }
    } catch {
      // report.json unreadable — leave metrics empty, status no_difference
    }
  }

  const files = safeReaddir(perTestDir);
  const controlHost = urlHostSegment(controlURL);
  const experimentHost = urlHostSegment(experimentURL);

  const rel = (name: string | null): string | null => {
    if (!name) return null;
    return path.relative(reportRoot, path.join(perTestDir, name)) || name;
  };

  const controlLh = files.find(
    (f) => f.startsWith(controlHost) && f.endsWith('_lighthouse_report.html'),
  ) ?? null;
  const experimentLh = files.find(
    (f) => f.startsWith(experimentHost) && f.endsWith('_lighthouse_report.html'),
  ) ?? null;
  const timeline = files.find((f) => f === 'timeline_comparison.html') ?? null;
  const diffFiles = files.filter((f) => f.endsWith('.diff.html'));

  const perf: PerfArtifact = {
    metrics,
    regressedMetrics,
    improvedMetrics,
    controlLighthouseHref: rel(controlLh),
    experimentLighthouseHref: rel(experimentLh),
    timelineHref: rel(timeline),
    diffHrefs: diffFiles
      .map((f) => ({ label: prettyDiffLabel(f), href: rel(f) ?? f }))
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
