/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  AccessibilityNodeBounds,
  AccessibilityViolation,
} from '../../../audit/stages/accessibility/types';

export type AccessibilityCompareSide = 'control' | 'experiment';
export type AccessibilityFindingStatus = 'new' | 'fixed' | 'unchanged' | 'changed';

export interface AccessibilityCompareScreenshot {
  width: number;
  height: number;
  imageHref?: string;
  imageDataUri?: string;
}

export interface AccessibilitySideScan {
  side: AccessibilityCompareSide;
  url: string;
  rawArtifactHref?: string;
  screenshot?: AccessibilityCompareScreenshot;
  violations: AccessibilityViolation[];
  error?: string;
  blocked?: boolean;
}

export interface AccessibilityFindingSide {
  impact: AccessibilityViolation['impact'];
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: Array<{
    target: AccessibilityViolation['nodes'][number]['target'];
    html: string;
    failureSummary: string;
    bounds?: AccessibilityNodeBounds;
  }>;
}

export interface AccessibilityCompareFinding {
  status: AccessibilityFindingStatus;
  signature: string;
  ruleId: string;
  impact: AccessibilityViolation['impact'];
  tags: string[];
  control?: AccessibilityFindingSide;
  experiment?: AccessibilityFindingSide;
}

export interface AccessibilityCompareSummary {
  new: number;
  fixed: number;
  changed: number;
  unchanged: number;
  errors: number;
  blocked: number;
  newByImpact: Record<string, number>;
  fixedByImpact: Record<string, number>;
  changedByImpact: Record<string, number>;
}

export interface AccessibilityCompareResult {
  control: AccessibilitySideScan;
  experiment: AccessibilitySideScan;
  effectiveConfig: {
    tags: string[];
    disableRules: string[];
    includeRules: string[] | null;
  };
  failOnViolation: boolean;
  findings: AccessibilityCompareFinding[];
  summary: AccessibilityCompareSummary;
  comparisonArtifactHref?: string;
}
