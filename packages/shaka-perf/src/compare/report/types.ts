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
  controlLighthouseHref: string | null;
  experimentLighthouseHref: string | null;
  timelineHref: string | null;
  diffHrefs: { label: string; href: string }[];
}

export interface CategoryResult {
  category: Category;
  status: Status;
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
}

export interface ReportData {
  meta: ReportMeta;
  tests: TestResult[];
}
