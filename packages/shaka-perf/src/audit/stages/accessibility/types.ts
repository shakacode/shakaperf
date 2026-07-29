/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Viewport } from '../../../config';

export type AccessibilityNodeTarget = string | string[];

export interface AccessibilityViolationNode {
  target: AccessibilityNodeTarget[];
  html: string;
  failureSummary: string;
  bounds?: AccessibilityNodeBounds;
}

export interface AccessibilityNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AccessibilityScreenshot {
  width: number;
  height: number;
  imageHref?: string;
}

export interface AccessibilityViolation {
  ruleId: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AccessibilityViolationNode[];
}

export interface AccessibilityScan {
  viewportLabel: string;
  viewport: Viewport;
  url: string;
  screenshot?: AccessibilityScreenshot;
  violations: AccessibilityViolation[];
  // True when the scanned page was a bot-protection / challenge interstitial, not
  // the real page - so the report shows the captured frame as "couldn't measure"
  // instead of presenting the challenge's violations as the site's.
  blocked?: boolean;
}

export interface AccessibilityRawArtifact {
  testName: string;
  experimentURL: string;
  effectiveConfig: {
    tags: string[];
    disableRules: string[];
    includeRules: string[] | null;
  };
  scans: AccessibilityScan[];
}

export interface AccessibilityResult {
  scans: AccessibilityScan[];
  totalViolations: number;
  failOnViolation: boolean;
  effectiveConfig: {
    tags: string[];
    disableRules: string[];
    includeRules: string[] | null;
  };
  rawArtifactHref?: string;
}
