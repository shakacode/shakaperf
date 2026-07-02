/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ImpactValue, NodeResult, Result } from 'axe-core';
import type {
  AccessibilityRawArtifact,
  AccessibilityResult,
  AccessibilityScan,
  AccessibilityViolation,
  AccessibilityViolationNode,
} from './types';

export const ACCESSIBILITY_RAW_REPORT_FILENAME = 'accessibility-report.json';
export const ACCESSIBILITY_SCREENSHOT_FILENAME = 'accessibility-screenshot.png';

const MAX_NODE_HTML_CHARS = 500;
const MAX_NODE_FAILURE_SUMMARY_CHARS = 2000;

export function normalizeViolation(result: Result): AccessibilityViolation {
  const resultTags = (result as Result & { tags?: readonly string[] }).tags ?? [];
  return {
    ruleId: result.id,
    impact: (result.impact as ImpactValue | undefined) ?? null,
    help: result.help,
    helpUrl: result.helpUrl,
    tags: [...new Set(resultTags)],
    nodes: result.nodes.map(normalizeNode),
  };
}

function normalizeNode(node: NodeResult): AccessibilityViolationNode {
  return {
    target: Array.isArray(node.target) ? [...node.target] : [node.target],
    html: node.html,
    failureSummary: node.failureSummary ?? '',
  };
}

export function projectAccessibilityRawArtifact(
  raw: AccessibilityRawArtifact,
  options: {
    failOnViolation: boolean;
    rawArtifactHref?: string;
  },
): AccessibilityResult {
  const scans = raw.scans.map(projectScanForReport);
  return {
    scans,
    totalViolations: scans.reduce((sum, scan) => sum + scan.violations.length, 0),
    failOnViolation: options.failOnViolation,
    effectiveConfig: {
      tags: raw.effectiveConfig.tags,
      disableRules: raw.effectiveConfig.disableRules,
      includeRules: raw.effectiveConfig.includeRules,
    },
    ...(options.rawArtifactHref ? { rawArtifactHref: options.rawArtifactHref } : {}),
  };
}

function projectScanForReport(scan: AccessibilityScan): AccessibilityScan {
  return {
    ...scan,
    violations: scan.violations.map((violation) => ({
      ...violation,
      nodes: violation.nodes.map((node) => ({
        ...node,
        html: truncate(node.html, MAX_NODE_HTML_CHARS),
        failureSummary: truncate(node.failureSummary, MAX_NODE_FAILURE_SUMMARY_CHARS),
      })),
    })),
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated from ${value.length} chars]`;
}
