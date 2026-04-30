import * as fs from 'fs';
import * as path from 'path';
import type { TestType } from 'shaka-shared';
import type {
  CategoryResult,
  PerfArtifact,
  PerfDirection,
  PerfMetric,
  PerfMetricGroup,
  Status,
} from '../report';
import type { AbTestsConfig, PerfConfig, Viewport } from '../config';
import type { CategoryDef, HarvestContext } from '../category-def';
import { compressHtmlImages } from './compress-inlined';

// Metrics where a bigger value is a better result (e.g. Lighthouse score).
// Everything else (ms timings, CLS, bytes, counts) treats bigger = worse.
const HIGHER_IS_BETTER = new Set(['lh score', 'lighthouse score']);
const PERF_TEST_TYPE = 'perf' as unknown as TestType;

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

/**
 * Shape of the per-test `report.json` written by the bench engine. Since we
 * folded engine-error.txt + engine-output.log into this file, the harvester
 * reads everything (metrics AND failure state) from a single source. Both
 * engine fields are optional — a clean run leaves them unset; a partial run
 * may have engineOutput only; a pre-measurement failure sets both.
 */
interface BenchCompareJsonResults {
  vitalsTableData?: BenchJsonMetric[];
  diagnosticsTableData?: BenchJsonMetric[];
  engineError?: string;
  engineOutput?: string;
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
 * collect the results into a single perf `CategoryResult.artifacts` array —
 * the same shape visreg uses for its per-viewport pairs.
 */
export async function harvestPerf(opts: HarvestPerfOptions): Promise<PerfArtifact> {
  const { perTestDir, controlURL, experimentURL, perfConfig, reportRoot, slug, viewportLabel } = opts;

  const metrics: PerfMetric[] = [];
  const regressedMetrics: string[] = [];
  const improvedMetrics: string[] = [];
  let status: Status = 'no_difference';
  void perfConfig;

  const reportJsonPath = path.join(perTestDir, 'report.json');
  let engineError: string | null = null;
  let engineOutput: string | null = null;
  if (fs.existsSync(reportJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8')) as BenchCompareJsonResults;
      engineError = raw.engineError ?? null;
      engineOutput = raw.engineOutput ?? null;
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

  // Inline most artifact HTMLs as data URIs so the report stays self-contained
  // when emailed or uploaded somewhere without its sibling directories. The
  // exception is `timeline_comparison.html` — it can be multi-MB (dozens of
  // base64 screenshots + diff PNGs) and, with N tests × M viewports, the
  // inlined report balloons to tens of MB. Timeline is referenced by relative
  // path instead and rendered in an iframe at dialog-open time; when the
  // viewer doesn't have the perf results directory alongside the report, the
  // dialog falls back to a "timeline only available locally" message.
  const inlineHtml = async (name: string | null): Promise<string | null> => {
    if (!name) return null;
    const fullPath = path.join(perTestDir, name);
    let content: Buffer = fs.readFileSync(fullPath) as Buffer;
    if (name.endsWith('_lighthouse_report.html')) {
      content = await compressHtmlImages(content, { imageQuality: 60 });
    } else if (name === 'timeline_comparison.html') {
      content = await compressHtmlImages(content, { imageQuality: 50 });
    }
    return `data:text/html;base64,${content.toString('base64')}`;
  };

  const relativeHref = (name: string | null): string | null => {
    if (!name) return null;
    const abs = path.join(perTestDir, name);
    return path.relative(reportRoot, abs).split(path.sep).join('/');
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

  // A per-test report.json carrying engineError means the bench wrote a
  // failure shell: no metrics, but the error short-message + full transcript
  // are captured inline. Surface them as the PerfArtifact's user-facing
  // `error` / `errorLog` so the report UI shows the same banner it would
  // have shown when we kept engine-error.txt / engine-output.log on disk.
  const errorPrefix = engineError ? `perf measurement failed: ${engineError}` : undefined;

  const [
    controlLighthouseHref,
    experimentLighthouseHref,
    benchReportHref,
    diffHrefEntries,
  ] = await Promise.all([
    inlineHtml(controlLh),
    inlineHtml(experimentLh),
    inlineHtml(benchReport),
    Promise.all(
      diffFiles.map(async (f) => ({ label: prettyDiffLabel(f), href: await inlineHtml(f) })),
    ),
  ]);

  return {
    viewportLabel,
    metrics,
    regressedMetrics,
    improvedMetrics,
    ...(errorPrefix ? { error: errorPrefix } : {}),
    ...(engineOutput ? { errorLog: engineOutput } : {}),
    controlLighthouseHref,
    experimentLighthouseHref,
    timelineHref: relativeHref(timeline),
    timelinePreviewSvg,
    benchReportHref,
    diffHrefs: diffHrefEntries
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

function emptyPerfArtifact(viewportLabel: string): PerfArtifact {
  return {
    viewportLabel,
    metrics: [],
    regressedMetrics: [],
    improvedMetrics: [],
    controlLighthouseHref: null,
    experimentLighthouseHref: null,
    timelineHref: null,
    timelinePreviewSvg: null,
    benchReportHref: null,
    diffHrefs: [],
  };
}

function perfRootFor(resultsRoot: string, viewport: Viewport): string {
  return path.join(resultsRoot, `perf-${viewport.label}`);
}

async function harvestPerfCategory(ctx: HarvestContext): Promise<CategoryResult | null> {
  const { slug, viewports, resultsRoot, controlURL, experimentURL, config, perfEngineFailedByLabel } = ctx;
  const artifacts: PerfArtifact[] = [];
  let anyHarvested = false;

  for (const viewport of viewports) {
    const perTestDir = path.join(perfRootFor(resultsRoot, viewport), slug);
    const reportJsonExists = fs.existsSync(path.join(perTestDir, 'report.json'));
    const viewportLabel = viewport.label;
    // report.json is now present on both success and failure — the bench
    // test loop folds `engineError` / `engineOutput` into a minimal
    // report.json when the measurement throws, so the harvester is the
    // single place per-viewport status is decided (metrics-or-error).
    if (reportJsonExists) {
      anyHarvested = true;
      try {
        artifacts.push(
          await harvestPerf({
            perTestDir,
            controlURL,
            experimentURL,
            perfConfig: config.perf,
            reportRoot: resultsRoot,
            slug,
            viewportLabel,
          }),
        );
      } catch (err) {
        const message = (err as Error).message || String(err);
        artifacts.push({
          ...emptyPerfArtifact(viewportLabel),
          error: `perf report unreadable: ${message}`,
        });
      }
    } else if (perfEngineFailedByLabel.has(viewportLabel)) {
      anyHarvested = true;
      artifacts.push({
        ...emptyPerfArtifact(viewportLabel),
        error: `perf engine aborted before measuring this test at ${viewportLabel} — see the error banner above`,
      });
    }
    // else: silently skip this viewport in the per-viewport artifacts
    // list. The test-level "did not produce artifacts" signal is
    // emitted once at the category level when NO viewport yielded data.
  }

  if (!anyHarvested) return null;

  // Per-viewport statuses fold into the category status with error first
  // (any viewport errored → the whole category reads as error, so it stays
  // in sync with `test.status`), then regression, then improvement, else
  // no_difference. Full pass per level — we can't break on regression
  // because a later viewport might carry an error that should outrank it.
  let status: Status = 'no_difference';
  if (artifacts.some((p) => p.error)) status = 'error';
  else if (artifacts.some((p) => p.regressedMetrics.length > 0)) status = 'regression';
  else if (artifacts.some((p) => p.improvedMetrics.length > 0)) status = 'improvement';

  return { testType: 'perf', status, artifacts };
}

export const perfCategoryDef: CategoryDef = {
  testType: PERF_TEST_TYPE,
  viewports: (config: AbTestsConfig) => config.perf.viewports,
  harvest: harvestPerfCategory,
};
