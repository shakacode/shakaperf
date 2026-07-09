/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import type { Browser } from 'playwright-core';
import { toPosixRelative } from '../../../pipeline/path-utils';
import type { PoolWorkerState, WorkerPool } from '../../../pipeline/worker-pool';
import type { TestContext } from '../../../stage/stage';
import {
  getLatestTestAnnotation,
  messageWithLatestTestAnnotation,
} from '../../../test-annotation';
import {
  accessibilityConfigForTest,
  type AccessibilityEffectiveConfig,
  type AccessibilityStageConfig,
} from '../../../audit/stages/accessibility/config';
import {
  AccessibilityPageScanError,
  captureAccessibilityScreenshotIfPossible,
  launchAccessibilityBrowser,
  scanAccessibilityPage,
} from '../../../audit/stages/accessibility/scan';
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
  const effective = accessibilityConfigForTest(config, ctx.test);
  const [control, experiment] = await Promise.all([
    scanSide(ctx, browser, effective, config, 'control', ctx.controlURL),
    scanSide(ctx, browser, effective, config, 'experiment', ctx.experimentURL),
  ]);
  const findings = control.error || experiment.error || control.blocked || experiment.blocked
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
    failOnViolation: config.failOnViolation,
    findings,
    summary: summarizeFindings(findings, control, experiment),
  });
  await ctx.artifacts.writeJson('accessibility-comparison.json', result);
  result.comparisonArtifactHref = relativeArtifactHref(ctx, 'accessibility-comparison.json');
  return result;
}

async function scanSide(
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
      inlineEncodeWarningPrefix: '[shaka-perf compare a11y]',
      captureFailure: async ({ page }) => ({
        screenshot: await captureAccessibilityScreenshotIfPossible(
          ctx,
          page,
          `${side}-failure-accessibility-screenshot.png`,
          '[shaka-perf compare a11y]',
        ),
      }),
    });
    const rawFilename = `${side}-accessibility-report.json`;
    await ctx.artifacts.writeJson(rawFilename, {
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
      rawArtifactHref: relativeArtifactHref(ctx, rawFilename),
      screenshot: result.screenshot,
      violations: result.violations,
      blocked: result.blocked,
    };
  } catch (err) {
    const scanError = err instanceof AccessibilityPageScanError ? err : null;
    const cause = scanError?.cause ?? err;
    const error = messageWithLatestTestAnnotation(
      (cause as Error).message || String(cause),
      getLatestTestAnnotation(cause),
    );
    const rawFilename = `${side}-accessibility-error.json`;
    await ctx.artifacts.writeJson(rawFilename, {
      side,
      testName: ctx.test.name,
      url,
      error,
    }).catch(() => {});
    return {
      side,
      url,
      rawArtifactHref: relativeArtifactHref(ctx, rawFilename),
      screenshot: scanError?.artifacts.screenshot,
      violations: [],
      error,
    };
  }
}

interface GroupedFinding {
  ruleId: string;
  side: AccessibilityFindingSide;
}

export function compareScans(
  control: AccessibilitySideScan,
  experiment: AccessibilitySideScan,
): AccessibilityCompareFinding[] {
  const controlMap = groupViolations(control.violations);
  const experimentMap = groupViolations(experiment.violations);
  const signatures = [...new Set([...controlMap.keys(), ...experimentMap.keys()])].sort();
  return signatures.map((signature) => {
    const controlEntry = controlMap.get(signature);
    const experimentEntry = experimentMap.get(signature);
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

function groupViolations(violations: AccessibilityViolation[]): Map<string, GroupedFinding> {
  const grouped = new Map<string, GroupedFinding>();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const signature = `${violation.ruleId}|${targetKey(node.target)}`;
      const existing = grouped.get(signature);
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
    html: normalizeText(node.html),
    failureSummary: normalizeText(node.failureSummary),
  })).sort((a, b) =>
    a.html.localeCompare(b.html) || a.failureSummary.localeCompare(b.failureSummary),
  ));
}

function targetKey(target: AccessibilityViolation['nodes'][number]['target']): string {
  return JSON.stringify(target.map((segment) =>
    Array.isArray(segment) ? segment.map(normalizeText) : normalizeText(segment),
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
    errors: (control.error ? 1 : 0) + (experiment.error ? 1 : 0),
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

function relativeArtifactHref(ctx: TestContext, filename: string): string {
  return toPosixRelative(ctx.runtime.resultsRoot, path.join(ctx.artifacts.dir, filename));
}
