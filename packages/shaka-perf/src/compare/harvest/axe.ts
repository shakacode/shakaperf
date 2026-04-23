import * as fs from 'fs';
import * as path from 'path';
import type { AxeRunArtifact } from 'shaka-accessibility';
import type {
  AxeArtifact,
  AxeScanArtifact,
  AxeViolationArtifact,
  AxeViolationNodeArtifact,
  CategoryResult,
  Status,
} from '../report';

const ENGINE_ERROR_FILE = 'axe-engine-error.txt';
const ENGINE_LOG_FILE = 'axe-engine-output.log';
const REPORT_FILE = 'axe-report.json';
const MAX_LOG_BYTES = 512 * 1024;

// Requirement 4.2: truncate per-node strings before embedding in report.json
// so a chatty page doesn't balloon the self-contained `report.html` — the
// originals stay on disk in `<slug>/axe-report.json` for deep inspection.
const MAX_NODE_HTML_CHARS = 500;
const MAX_NODE_FAILURE_SUMMARY_CHARS = 2000;

const EMPTY_AXE_CATEGORY: CategoryResult = {
  category: 'axe',
  status: 'no_difference',
};

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  // Marker keeps the UI honest: reviewers who paste the truncated html back
  // into a DOM inspector will see that something was elided rather than get a
  // silently malformed fragment.
  return `${s.slice(0, maxChars)}… [truncated from ${s.length} chars]`;
}

function truncateNodes(nodes: AxeRunArtifact['scans'][number]['violations'][number]['nodes']): AxeViolationNodeArtifact[] {
  return nodes.map((n) => ({
    target: n.target,
    html: truncate(n.html, MAX_NODE_HTML_CHARS),
    failureSummary: truncate(n.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
  }));
}

function projectScan(scan: AxeRunArtifact['scans'][number]): AxeScanArtifact {
  const violations: AxeViolationArtifact[] = scan.violations.map((v) => ({
    ruleId: v.ruleId,
    impact: v.impact,
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: truncateNodes(v.nodes),
  }));
  return {
    viewportLabel: scan.viewportLabel,
    url: scan.url,
    violations,
  };
}

function safeReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Returns the first line of `<perTestDir>/axe-engine-error.txt` (written by
 * runAxe's per-test try/catch when a single scan blew up) so we can surface it
 * on the card. Absent file = no error, the common case.
 */
export function readAxeEngineError(perTestDir: string): string | null {
  const raw = safeReadFile(path.join(perTestDir, ENGINE_ERROR_FILE));
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.split(/\r?\n/, 1)[0] || null;
}

/**
 * Captured stdout/stderr transcript for a failed axe run so it can be embedded
 * in the self-contained report. Mirrors the perf harvester's behavior: stack
 * first, then log, truncate if the combined bytes exceed MAX_LOG_BYTES.
 */
export function readAxeEngineLog(perTestDir: string): string | null {
  const stack = safeReadFile(path.join(perTestDir, ENGINE_ERROR_FILE));
  const log = safeReadFile(path.join(perTestDir, ENGINE_LOG_FILE));
  if (stack == null && log == null) return null;
  const parts: string[] = [];
  if (stack) parts.push('── error ──', stack.trim(), '');
  if (log) parts.push('── engine output ──', log.trim());
  const combined = parts.join('\n');
  if (combined.length <= MAX_LOG_BYTES) return combined;
  const head = '[… truncated; see the on-disk axe-engine-output.log for the full transcript …]\n';
  return head + combined.slice(combined.length - MAX_LOG_BYTES);
}

export interface HarvestAxeOptions {
  perTestDir: string;
}

/**
 * Reads `<perTestDir>/axe-report.json` (shape: AxeRunArtifact from
 * shaka-accessibility) and projects it into the report-shell CategoryResult.
 * See AXE_A11Y_REQUIREMENTS.md §3.8 for status rules:
 *   skipped → no_difference (flag is retained via axe.skipped),
 *   totalViolations > 0 → a11y_violation,
 *   otherwise no_difference.
 */
export function harvestAxe(opts: HarvestAxeOptions): CategoryResult {
  const { perTestDir } = opts;
  const reportPath = path.join(perTestDir, REPORT_FILE);
  const raw = safeReadFile(reportPath);
  if (raw == null) {
    return EMPTY_AXE_CATEGORY;
  }
  let artifact: AxeRunArtifact;
  try {
    artifact = JSON.parse(raw) as AxeRunArtifact;
  } catch (err) {
    throw new Error(
      `axe-report.json unreadable at ${reportPath}: ${(err as Error).message}`,
    );
  }

  const scans = artifact.scans.map(projectScan);
  const totalViolations = scans.reduce((sum, s) => sum + s.violations.length, 0);
  const axe: AxeArtifact = {
    scans,
    totalViolations,
    skipped: artifact.skipped,
    effectiveConfig: {
      tags: artifact.effectiveConfig.tags,
      disableRules: artifact.effectiveConfig.disableRules,
      includeRules: artifact.effectiveConfig.includeRules,
    },
  };

  let status: Status = 'no_difference';
  if (!artifact.skipped && totalViolations > 0) {
    status = 'a11y_violation';
  }

  return {
    category: 'axe',
    status,
    axe,
  };
}
