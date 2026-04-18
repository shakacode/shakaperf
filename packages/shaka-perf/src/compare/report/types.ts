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
