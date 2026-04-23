import type { Viewport } from 'shaka-shared';

/**
 * A single failing DOM node under an axe violation. Target may be a nested
 * array when the node lives inside an iframe or shadow root — in that case
 * each segment selects one frame/root level.
 */
export type AxeNodeTarget = string | string[];

export interface AxeViolationNode {
  target: AxeNodeTarget[];
  html: string;
  failureSummary: string;
}

export interface AxeViolation {
  ruleId: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
}

export interface AxeScan {
  viewportLabel: string;
  viewport: Viewport;
  url: string;
  violations: AxeViolation[];
}

/**
 * On-disk artifact shape persisted at `<resultsRoot>/<slug>/axe-report.json`
 * (see requirement 3.7). Kept stable across phases so v1 artifacts can be
 * re-harvested unchanged by the v2 compare integration.
 */
export interface AxeRunArtifact {
  testName: string;
  experimentURL: string;
  skipped: boolean;
  effectiveConfig: {
    tags: string[];
    disableRules: string[];
    includeRules: string[] | null;
    viewports: Viewport[];
  };
  scans: AxeScan[];
}

export interface AxeRunResult {
  testName: string;
  slug: string;
  artifactPath: string;
  skipped: boolean;
  totalViolations: number;
  /** Populated when the axe engine crashed for this test. */
  error?: string;
}
