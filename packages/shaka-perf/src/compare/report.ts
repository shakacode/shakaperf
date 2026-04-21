import * as fs from 'fs';
import * as path from 'path';

export type Status = 'regression' | 'visual_change' | 'improvement' | 'no_difference';

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
}

export interface PerfMetric {
  label: string;
  controlMs: number;
  experimentMs: number;
  pValue: number;
  hlDiffMs: number;
  significant: boolean;
}

export interface PerfArtifact {
  metrics: PerfMetric[];
  regressedMetrics: string[];
  improvedMetrics: string[];
  controlLighthouseHref: string | null;
  experimentLighthouseHref: string | null;
  timelineHref: string | null;
  diffHrefs: { label: string; href: string }[];
}

export interface CategoryResult {
  category: Category;
  status: Status;
  /**
   * Non-fatal error message to surface in the report card — e.g. "perf
   * engine aborted before this test ran". Presence of `error` does NOT
   * change the category status (still `no_difference` by default).
   */
  error?: string;
  visreg?: VisregArtifact[];
  perf?: PerfArtifact;
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
