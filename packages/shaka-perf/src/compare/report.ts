import * as fs from 'fs';
import * as path from 'path';

export type Status =
  | 'error'
  | 'regression'
  | 'visual_change'
  | 'improvement'
  | 'no_difference'
  /**
   * Category was skipped for this test because the intersection of
   * `options.viewports` (test narrow) and the category's own `viewports`
   * is empty — e.g. a test tagged `viewports: ['desktop']` against
   * `perf.viewports: ['phone']` produces no perf work. Rendered as a
   * small "skipped by viewport filter" banner; does not propagate to the
   * test-level status (a skipped perf category doesn't override a visreg
   * change).
   */
  | 'skipped';

export type Category = 'visreg' | 'perf';

export interface VisregArtifact {
  viewportLabel: string;
  selector: string;
  controlImage: string;
  experimentImage: string;
  diffImage: string | null;
  misMatchPercentage: number;
  diffPixels: number;
  threshold: number;
  /**
   * Bounding box of the first visual difference in the pixelmatch diff PNG,
   * in source-image pixels. Used by the report to crop control/experiment/diff
   * thumbnails to the same segment so the regression is visible at a glance.
   *
   * `controlImgH` / `experimentImgH` / `diffImgH` capture each source image's
   * natural height — pixelmatch's diff PNG is padded to `max(control, experiment)`,
   * so they can differ, and the CSS cropper needs the real per-image height
   * to position each image over the correct region.
   */
  diffBbox: {
    x: number;
    y: number;
    w: number;
    h: number;
    imgW: number;
    controlImgH: number;
    experimentImgH: number;
    diffImgH: number;
  } | null;
}

export type PerfDirection = 'regression' | 'improvement' | 'none';
export type PerfMetricGroup = 'vitals' | 'diagnostics';

export interface PerfMetric {
  label: string;
  group: PerfMetricGroup;
  controlDisplay: string;
  experimentDisplay: string;
  deltaDisplay: string;
  percentDisplay: string;
  pValue: number;
  direction: PerfDirection;
}

export interface PerfArtifact {
  /**
   * Identifier of the viewport this measurement was taken at (matching the
   * viewport's `label`, e.g. "desktop" / "phone"). Mirrors
   * `VisregArtifact.viewportLabel` so per-viewport perf rows render the
   * same way visreg rows do.
   */
  viewportLabel: string;
  /**
   * Per-viewport measurement failure, e.g. "perf engine aborted before
   * measuring this test". Set when this specific viewport's Lighthouse
   * pass failed while other viewports on the same test may have succeeded.
   */
  error?: string;
  /**
   * Captured stdout/stderr transcript for the failed per-viewport run,
   * embedded so the report stays self-contained. Opened via the error
   * banner's "view logs" action.
   */
  errorLog?: string | null;
  metrics: PerfMetric[];
  regressedMetrics: string[];
  improvedMetrics: string[];
  controlLighthouseHref: string | null;
  experimentLighthouseHref: string | null;
  timelineHref: string | null;
  /**
   * Inline SVG string for the timeline preview (3×N triplet grid). Only
   * populated on viewports whose perf status actually moved off
   * `no_difference` — `no_difference` rows fall back to the plain
   * "timeline" button in the artifact link row.
   */
  timelinePreviewSvg: string | null;
  benchReportHref: string | null;
  diffHrefs: { label: string; href: string }[];
}

export interface CategoryResult {
  category: Category;
  status: Status;
  /**
   * Non-fatal category-wide error to surface as a banner above the per-
   * viewport cards — e.g. the visreg engine aborted before producing any
   * pairs. Per-viewport perf errors live on the individual `PerfArtifact`
   * so one failed viewport doesn't erase the others' results.
   */
  error?: string;
  /**
   * Full captured stdout/stderr transcript from the engine run that
   * produced `error`, embedded so the report stays self-contained.
   */
  errorLog?: string | null;
  /**
   * Explanation shown when `status === 'skipped'`, e.g. "skipped: test's
   * viewport narrow ['desktop'] matches no perf viewport". Not an `error`
   * because skipping is intentional and must not promote the test-level
   * status to `error`.
   */
  skipReason?: string;
  visreg?: VisregArtifact[];
  /**
   * One entry per viewport this test was measured at. Always an array
   * even when a single viewport is configured, mirroring
   * `visreg: VisregArtifact[]`.
   */
  perfs?: PerfArtifact[];
}

export interface TestResult {
  id: string;
  name: string;
  filePath: string;
  startingPath: string;
  controlUrl: string;
  experimentUrl: string;
  code: string | null;
  status: Status;
  durationMs: number;
  categories: CategoryResult[];
}

export interface ReportMeta {
  title: string;
  generatedAt: string;
  controlUrl: string;
  experimentUrl: string;
  durationMs: number;
  cwd: string;
  categories: Category[];
  /**
   * Engine-level (cross-cutting) errors to show as a banner at the top
   * of the report. Per-test / per-category errors go on CategoryResult.
   */
  errors: string[];
}

export interface ReportData {
  meta: ReportMeta;
  tests: TestResult[];
}

const DATA_TAG_OPEN = '<script id="__shaka_report_data__" type="application/json">';
const DATA_TAG_CLOSE = '</script>';

function locateTemplate(): string {
  // After tsc + copy-assets, the template lives at <pkg>/dist/report-shell/index.html.
  // During dev (no copy-assets yet), fall back to the Vite output directly.
  const candidates = [
    path.resolve(__dirname, '..', 'report-shell', 'index.html'),
    path.resolve(__dirname, '..', '..', 'report-shell', 'dist', 'index.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `report-shell HTML template not found. Run \`vite build\` in packages/shaka-perf/report-shell first. Tried:\n${candidates.join('\n')}`,
  );
}

function escapeForScript(json: string): string {
  // Prevent </script> in payload from terminating the inline script.
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

export function renderReportHtml(data: ReportData): string {
  const templatePath = locateTemplate();
  const template = fs.readFileSync(templatePath, 'utf8');

  const start = template.indexOf(DATA_TAG_OPEN);
  if (start < 0) {
    throw new Error(`report-shell template missing data placeholder: ${templatePath}`);
  }
  const end = template.indexOf(DATA_TAG_CLOSE, start + DATA_TAG_OPEN.length);
  if (end < 0) {
    throw new Error(`report-shell template malformed near data placeholder: ${templatePath}`);
  }

  const payload = escapeForScript(JSON.stringify(data));
  return (
    template.slice(0, start + DATA_TAG_OPEN.length) +
    payload +
    template.slice(end)
  );
}

export function writeReport(data: ReportData, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderReportHtml(data);
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html);
  return outPath;
}
