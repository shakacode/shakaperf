/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Browser } from 'playwright-core';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import {
  type AccessibilityEffectiveConfig,
  type AccessibilityStageConfig,
} from '../../../audit/stages/accessibility/config';
import {
  AccessibilityPageScanError,
  captureAccessibilityFailureMedia,
  launchAccessibilityBrowser,
  scanAccessibilityPage,
} from '../../../audit/stages/accessibility/scan';
import { StageFailureError } from '../../../stage/stage-failure';
import { formatLogPrefix } from '../../../pipeline/log-prefix-format';
import { withLogPrefix } from '../../../visreg/core/util/testContext';
import type {
  AccessibilityViolation,
} from '../../../audit/stages/accessibility/types';
import type {
  AccessibilityCompareFinding,
  AccessibilityCompareResult,
  AccessibilityCompareSide,
  AccessibilityCompareSummary,
  AccessibilityFindingSide,
  AccessibilitySideScan,
} from './types';

interface AccessibilityCompareSlotState extends PoolWorkerState {
  accessibilityCompareBrowser?: Browser;
}

const MAX_NODE_HTML_CHARS = 500;
const MAX_NODE_FAILURE_SUMMARY_CHARS = 2000;

async function disposeAccessibilityCompareBrowser(state: Record<string, unknown>): Promise<void> {
  const slot = state as AccessibilityCompareSlotState;
  const browser = slot.accessibilityCompareBrowser;
  if (!browser) return;
  slot.accessibilityCompareBrowser = undefined;
  await browser.close().catch(() => {});
}

export async function runAccessibilityCompareStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: AccessibilityStageConfig,
): Promise<AccessibilityCompareResult> {
  return workerPool.submit(async (state) => {
    const slot = workerPool.getWorkerState<AccessibilityCompareSlotState>(
      state,
      disposeAccessibilityCompareBrowser,
    );
    if (!slot.accessibilityCompareBrowser) {
      slot.accessibilityCompareBrowser = await launchAccessibilityBrowser(config, ctx.runtime.headed);
    }
    return scanAccessibilityComparison(ctx, slot.accessibilityCompareBrowser, config);
  }, { key: `${ctx.testAndViewportId}:accessibility` });
}

async function scanAccessibilityComparison(
  ctx: TestContext,
  browser: Browser,
  config: AccessibilityStageConfig,
): Promise<AccessibilityCompareResult> {
  const acc = ctx.config.accessibility;
  const effective = { tags: acc.tags, disableRules: acc.disableRules, includeRules: acc.includeRules ?? null };
  const [control, experiment] = await Promise.all([
    scanSide(ctx, browser, effective, config, 'control', ctx.controlURL),
    scanSide(ctx, browser, effective, config, 'experiment', ctx.experimentURL),
  ]);
  const findings = control.blocked || experiment.blocked
    ? []
    : compareScans(control, experiment);
  const result = projectCompareResultForReport({
    control,
    experiment,
    effectiveConfig: {
      tags: effective.tags,
      disableRules: effective.disableRules,
      includeRules: effective.includeRules,
    },
    // Per-test effective, like tags/disableRules/includeRules above.
    failOnViolation: acc.failOnViolation,
    findings,
    summary: summarizeFindings(findings, control, experiment),
  });
  result.comparisonArtifactHref = await ctx.artifacts.writeJson(
    'accessibility-comparison.json',
    result,
  );
  return result;
}

// Each side runs under its own log-prefix column, so a failure thrown from
// inside names the side it came from — the same way visreg labels a failing
// side rather than its concurrent sibling.
function scanSide(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
  side: AccessibilityCompareSide,
  url: string,
): Promise<AccessibilitySideScan> {
  return withLogPrefix(
    formatLogPrefix(side),
    () => scanSideUnprefixed(ctx, browser, effective, config, side, url),
  );
}

async function scanSideUnprefixed(
  ctx: TestContext,
  browser: Browser,
  effective: AccessibilityEffectiveConfig,
  config: AccessibilityStageConfig,
  side: AccessibilityCompareSide,
  url: string,
): Promise<AccessibilitySideScan> {
  try {
    const result = await scanAccessibilityPage(ctx, browser, effective, config, {
      url,
      isControl: side === 'control',
      screenshotFilename: `${side}-accessibility-screenshot.png`,
      captureFailure: async ({ page }) => ({
        media: await captureAccessibilityFailureMedia(
          ctx,
          page,
          `${side}-accessibility-failure-screenshot.png`,
        ),
      }),
    });
    const rawFilename = `${side}-accessibility-report.json`;
    const rawArtifactHref = await ctx.artifacts.writeJson(rawFilename, {
      side,
      testName: ctx.test.name,
      url: result.url,
      blocked: result.blocked,
      effectiveConfig: {
        tags: effective.tags,
        disableRules: effective.disableRules,
        includeRules: effective.includeRules,
      },
      axe: result.axeResults,
    });
    return {
      side,
      url: result.url,
      rawArtifactHref,
      screenshot: result.screenshot,
      violations: result.violations,
      blocked: result.blocked,
    };
  } catch (err) {
    // Unwrapped so the report names the real cause, and re-wrapped as a stage
    // failure only when there is a screenshot to attach — like the audit stage.
    if (err instanceof AccessibilityPageScanError) {
      if (err.artifacts.media) {
        throw new StageFailureError(err.cause, { media: err.artifacts.media });
      }
      throw err.cause;
    }
    throw err;
  }
}

interface GroupedFinding {
  ruleId: string;
  side: AccessibilityFindingSide;
  stableSignature: string;
}

export function compareScans(
  control: AccessibilitySideScan,
  experiment: AccessibilitySideScan,
): AccessibilityCompareFinding[] {
  const controlMap = groupViolations(control.violations);
  const experimentMap = groupViolations(experiment.violations);
  return matchSignatures(controlMap, experimentMap).map((pair) => {
    const controlEntry = pair.control == null ? undefined : controlMap.get(pair.control);
    const experimentEntry = pair.experiment == null ? undefined : experimentMap.get(pair.experiment);
    const signature = pair.experiment ?? pair.control!;
    const ruleId = experimentEntry?.ruleId ?? controlEntry!.ruleId;
    const status = !controlEntry
      ? 'new'
      : !experimentEntry
        ? 'fixed'
        : findingChanged(controlEntry.side, experimentEntry.side)
          ? 'changed'
          : 'unchanged';
    const impact = experimentEntry?.side.impact ?? controlEntry?.side.impact ?? null;
    const tags = sortedUnique([
      ...(controlEntry?.side.tags ?? []),
      ...(experimentEntry?.side.tags ?? []),
    ]);
    return {
      status,
      signature,
      ruleId,
      impact,
      tags,
      ...(controlEntry ? { control: controlEntry.side } : {}),
      ...(experimentEntry ? { experiment: experimentEntry.side } : {}),
    };
  });
}

interface SignaturePair {
  control?: string;
  experiment?: string;
}

/**
 * Pairs each control finding with its experiment counterpart. Exact target
 * matches are taken first; only what is left over is paired on the stable
 * key, so a generated class name no longer splits one violation into a
 * phantom `fixed` + `new`, while two distinct elements that merely look alike
 * once their generated names are stripped stay separate.
 */
function matchSignatures(
  controlMap: Map<string, GroupedFinding>,
  experimentMap: Map<string, GroupedFinding>,
): SignaturePair[] {
  const pairs: SignaturePair[] = [];
  const controlLeft = new Set([...controlMap.keys()].sort());
  const experimentLeft = new Set([...experimentMap.keys()].sort());

  for (const signature of [...controlLeft]) {
    if (!experimentLeft.has(signature)) continue;
    pairs.push({ control: signature, experiment: signature });
    controlLeft.delete(signature);
    experimentLeft.delete(signature);
  }

  const experimentByStableKey = new Map<string, string[]>();
  for (const signature of experimentLeft) {
    const key = experimentMap.get(signature)!.stableSignature;
    const bucket = experimentByStableKey.get(key);
    if (bucket) bucket.push(signature);
    else experimentByStableKey.set(key, [signature]);
  }

  for (const signature of controlLeft) {
    const key = controlMap.get(signature)!.stableSignature;
    const match = experimentByStableKey.get(key)?.shift();
    if (match == null) {
      pairs.push({ control: signature });
      continue;
    }
    experimentLeft.delete(match);
    pairs.push({ control: signature, experiment: match });
  }
  for (const signature of experimentLeft) pairs.push({ experiment: signature });

  return pairs.sort((a, b) =>
    (a.experiment ?? a.control!).localeCompare(b.experiment ?? b.control!),
  );
}

function groupViolations(violations: AccessibilityViolation[]): Map<string, GroupedFinding> {
  const grouped = new Map<string, GroupedFinding>();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const signature = `${violation.ruleId}|${targetKey(node.target)}`;
      const existing = grouped.get(signature);
      const stableSignature = `${violation.ruleId}|${stableTargetKey(node.target)}`;
      const side = existing?.side ?? {
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: [],
        nodes: [],
      };
      side.impact = worstImpact(side.impact, violation.impact);
      side.tags = sortedUnique([...side.tags, ...violation.tags]);
      side.nodes.push({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
        ...(node.bounds ? { bounds: node.bounds } : {}),
      });
      grouped.set(signature, {
        ruleId: violation.ruleId,
        side,
        stableSignature,
      });
    }
  }
  return grouped;
}

function findingChanged(control: AccessibilityFindingSide, experiment: AccessibilityFindingSide): boolean {
  return control.impact !== experiment.impact ||
    control.nodes.length !== experiment.nodes.length ||
    normalizedNodePayload(control.nodes) !== normalizedNodePayload(experiment.nodes);
}

function normalizedNodePayload(nodes: AccessibilityFindingSide['nodes']): string {
  return JSON.stringify(nodes.map((node) => ({
    html: normalizeHtml(node.html),
    failureSummary: normalizeText(node.failureSummary),
  })).sort((a, b) =>
    a.html.localeCompare(b.html) || a.failureSummary.localeCompare(b.failureSummary),
  ));
}

/**
 * CSS-in-JS class names carry a build-order counter or content hash — JSS
 * `jss162`, emotion `css-1q2w3e`, styled-components `sc-bdVaJa`. Control and
 * experiment mount a different number of components before the element, so
 * the same node gets a different name on each side. Axe's target and html
 * then differ, the finding fails to match itself, and one unchanged violation
 * is reported as a phantom `fixed` + `new` pair — every page with a styled
 * violation reads as an accessibility regression.
 */
const GENERATED_CLASS = /^(?:jss\d+|css-[0-9a-z]{4,}|sc-[0-9a-zA-Z]{5,})$/;
const GENERATED_CLASS_PLACEHOLDER = 'generated-class';

function stableClassToken(token: string): string {
  return GENERATED_CLASS.test(token) ? GENERATED_CLASS_PLACEHOLDER : token;
}

/**
 * Both sides derive the key the same way, so this only ever has to be
 * consistent — it is a matching key, never the target shown in the report.
 * Classes are sorted because the same element's compound selector can list
 * them in either order (`.MuiCollapse-root.MuiCollapse-entered` one side,
 * reversed on the other).
 */
function normalizeSelector(value: string): string {
  return normalizeText(value).replace(/(?:\.[-\w]+)+/g, (run) => {
    const classes = run.split('.').filter(Boolean).map(stableClassToken).sort();
    return `.${classes.join('.')}`;
  });
}

function normalizeHtml(value: string): string {
  return normalizeText(value).replace(
    /(\sclass=)(["'])(.*?)\2/g,
    (_match, prefix: string, quote: string, classList: string) => {
      const classes = classList.split(/\s+/).filter(Boolean).map(stableClassToken).sort();
      return `${prefix}${quote}${classes.join(' ')}${quote}`;
    },
  );
}

function targetKey(target: AccessibilityViolation['nodes'][number]['target']): string {
  return JSON.stringify(target.map((segment) =>
    Array.isArray(segment) ? segment.map(normalizeText) : normalizeText(segment),
  ));
}

/**
 * The same target with generated class names and class order collapsed. Only
 * ever used to pair leftovers after exact matching, so two genuinely distinct
 * elements that share a stable key stay separate findings.
 */
function stableTargetKey(target: AccessibilityViolation['nodes'][number]['target']): string {
  return JSON.stringify(target.map((segment) =>
    Array.isArray(segment) ? segment.map(normalizeSelector) : normalizeSelector(segment),
  ));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function summarizeFindings(
  findings: AccessibilityCompareFinding[],
  control: AccessibilitySideScan,
  experiment: AccessibilitySideScan,
): AccessibilityCompareSummary {
  const summary: AccessibilityCompareSummary = {
    new: 0,
    fixed: 0,
    changed: 0,
    unchanged: 0,
    blocked: (control.blocked ? 1 : 0) + (experiment.blocked ? 1 : 0),
    newByImpact: {},
    fixedByImpact: {},
    changedByImpact: {},
  };
  for (const finding of findings) {
    if (finding.status === 'new') {
      summary.new += 1;
      incrementImpact(summary.newByImpact, finding.impact);
    } else if (finding.status === 'fixed') {
      summary.fixed += 1;
      incrementImpact(summary.fixedByImpact, finding.impact);
    } else if (finding.status === 'changed') {
      summary.changed += 1;
      incrementImpact(summary.changedByImpact, finding.impact);
    } else {
      summary.unchanged += 1;
    }
  }
  return summary;
}

export function projectCompareResultForReport(
  result: AccessibilityCompareResult,
): AccessibilityCompareResult {
  return {
    ...result,
    control: projectSideForReport(result.control),
    experiment: projectSideForReport(result.experiment),
    findings: result.findings.map((finding) => ({
      ...finding,
      ...(finding.control ? { control: projectFindingSideForReport(finding.control) } : {}),
      ...(finding.experiment ? { experiment: projectFindingSideForReport(finding.experiment) } : {}),
    })),
  };
}

function projectSideForReport(side: AccessibilitySideScan): AccessibilitySideScan {
  return {
    ...side,
    violations: side.violations.map((violation) => ({
      ...violation,
      nodes: violation.nodes.map((node) => ({
        ...node,
        html: truncate(node.html, MAX_NODE_HTML_CHARS),
        failureSummary: truncate(node.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
      })),
    })),
  };
}

function projectFindingSideForReport(side: AccessibilityFindingSide): AccessibilityFindingSide {
  return {
    ...side,
    nodes: side.nodes.map((node) => ({
      ...node,
      html: truncate(node.html, MAX_NODE_HTML_CHARS),
      failureSummary: truncate(node.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
    })),
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated from ${value.length} chars]`;
}

function incrementImpact(target: Record<string, number>, impact: AccessibilityCompareFinding['impact']): void {
  const key = impact ?? 'unknown';
  target[key] = (target[key] ?? 0) + 1;
}

function worstImpact(
  a: AccessibilityViolation['impact'],
  b: AccessibilityViolation['impact'],
): AccessibilityViolation['impact'] {
  return impactRank(b) < impactRank(a) ? b : a;
}

function impactRank(impact: AccessibilityViolation['impact']): number {
  if (impact === 'critical') return 0;
  if (impact === 'serious') return 1;
  if (impact === 'moderate') return 2;
  if (impact === 'minor') return 3;
  return 4;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
