/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type {
  AccessibilityScan,
  AccessibilityViolation,
  AccessibilityViolationNode,
} from './types';

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

export interface FilterOption {
  value: string;
  count: number;
}

export interface AccessibilityFilterOptions {
  rules: FilterOption[];
  tags: FilterOption[];
}

export interface AccessibilityFilterSelection {
  rules: Set<string>;
  tags: Set<string>;
}

export interface HotspotEntry {
  issueId: string;
  violation: AccessibilityViolation;
  node: AccessibilityViolationNode;
}

export function collectConfiguredFilterOptions(
  results: readonly { effectiveConfig: { tags: string[]; includeRules: string[] | null }; scans: AccessibilityScan[] }[],
): AccessibilityFilterOptions {
  const configuredRules = uniq(results.flatMap((result) => result.effectiveConfig.includeRules ?? []));
  const configuredTags = uniq(results.flatMap((result) => result.effectiveConfig.tags));
  const violations = results.flatMap((result) =>
    result.scans.flatMap((scan) => scan.violations),
  );
  return countFilterOptionsForViolations({
    rules: configuredRules.map((value) => ({ value, count: 0 })),
    tags: configuredTags.map((value) => ({ value, count: 0 })),
  }, violations);
}

export function countFilterOptionsForScans(
  options: AccessibilityFilterOptions,
  scans: readonly AccessibilityScan[],
): AccessibilityFilterOptions {
  return countFilterOptionsForViolations(
    options,
    scans.flatMap((scan) => scan.violations),
  );
}

function countFilterOptionsForViolations(
  options: AccessibilityFilterOptions,
  violations: readonly AccessibilityViolation[],
): AccessibilityFilterOptions {
  return {
    rules: options.rules.map(({ value }) => ({
      value,
      count: violations.filter((violation) => violation.ruleId === value).length,
    })),
    tags: options.tags.map(({ value }) => ({
      value,
      count: violations.filter((violation) => (violation.tags ?? []).includes(value)).length,
    })),
  };
}

export function isViolationVisibleForTags(
  violation: AccessibilityViolation,
  selectedTags: ReadonlySet<string>,
): boolean {
  return (violation.tags ?? []).some((tag) => selectedTags.has(tag));
}

export function isViolationVisibleForFilters(
  violation: AccessibilityViolation,
  selection: AccessibilityFilterSelection,
): boolean {
  return selection.rules.has(violation.ruleId) || isViolationVisibleForTags(violation, selection.tags);
}

export function defaultAccessibilityFilterSelection(options: AccessibilityFilterOptions): AccessibilityFilterSelection {
  return {
    rules: new Set(options.rules.map((option) => option.value)),
    tags: new Set(options.tags.map((option) => option.value)),
  };
}

export function normalizeAccessibilityFilterSelection(
  selection: AccessibilityFilterSelection,
  options: AccessibilityFilterOptions,
): AccessibilityFilterSelection {
  return {
    rules: new Set(options.rules.map((option) => option.value).filter((value) => selection.rules.has(value))),
    tags: new Set(options.tags.map((option) => option.value).filter((value) => selection.tags.has(value))),
  };
}

export function hasAccessibilityFilterOptions(options: AccessibilityFilterOptions): boolean {
  return options.rules.length > 0 || options.tags.length > 0;
}

export function scanWithVisibleViolations(
  scan: AccessibilityScan,
  selection: AccessibilityFilterSelection,
): AccessibilityScan {
  return {
    ...scan,
    violations: scan.violations.filter((violation) =>
      isViolationVisibleForFilters(violation, selection),
    ),
  };
}

export function sortViolations(violations: readonly AccessibilityViolation[]): AccessibilityViolation[] {
  return [...violations].sort((a, b) => {
    const ai = a.impact ? IMPACT_ORDER[a.impact] ?? 9 : 9;
    const bi = b.impact ? IMPACT_ORDER[b.impact] ?? 9 : 9;
    return ai - bi || a.ruleId.localeCompare(b.ruleId);
  });
}

export function impactColor(impact: AccessibilityViolation['impact']): string {
  return impact === 'critical' || impact === 'serious' ? '#b91c1c' : '#92400e';
}

export function pct(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0%';
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

export function boundedThumbnailSize(width: number, height: number): { width: number; height: number } {
  const maxWidth = 180;
  const maxHeight = 140;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.625) };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function tooltipPlacement(
  bounds: NonNullable<AccessibilityViolationNode['bounds']>,
  screenshot: NonNullable<AccessibilityScan['screenshot']>,
): { x: 'left' | 'right'; y: 'above' | 'below' } {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: centerX > screenshot.width * 0.55 ? 'left' : 'right',
    y: centerY > screenshot.height * 0.6 ? 'above' : 'below',
  };
}

export function localizedHotspots(scan: AccessibilityScan): HotspotEntry[] {
  const screenshot = scan.screenshot;
  if (!screenshot) return [];
  return scan.violations.flatMap((violation) =>
    violation.nodes
      .map((node, nodeIndex) => ({ issueId: makeIssueId(violation.ruleId, nodeIndex), violation, node }))
      .filter((entry): entry is HotspotEntry =>
        entry.node.bounds != null && isLocalizedBounds(
          entry.node.bounds.width,
          entry.node.bounds.height,
          screenshot.width,
          screenshot.height,
        ),
      ),
  );
}

export function hotspotZIndex(
  width: number,
  height: number,
  screenshotWidth: number,
  screenshotHeight: number,
): number {
  const hotspotArea = Math.max(1, width * height);
  const screenshotArea = Math.max(1, screenshotWidth * screenshotHeight);
  const areaRatio = Math.max(0, Math.min(1, hotspotArea / screenshotArea));
  return Math.max(1, Math.round(100000 - areaRatio * 99999));
}

export function makeIssueId(ruleId: string, nodeIndex: number): string {
  return `${ruleId}-${nodeIndex}`;
}

// A short, plain-language label for one axe rule, for the crop captions (so a
// frame says WHAT is wrong, not just "Middle of the page"). Kept lowercase so
// the caption builder can capitalize the lead. Falls back to a generic label.
export function a11yIssueLabel(ruleId: string): string {
  if (ruleId === 'color-contrast') return 'low-contrast text';
  if (ruleId === 'button-name') return 'unlabeled buttons';
  if (ruleId === 'link-name') return 'unlabeled links';
  if (ruleId === 'frame-title') return 'unlabeled frames';
  if (ruleId === 'nested-interactive') return 'nested controls';
  if (ruleId === 'scrollable-region-focusable') return "scroll areas keyboard users can't reach";
  if (ruleId === 'label' || ruleId === 'select-name' || ruleId === 'aria-input-field-name') return 'unlabeled form fields';
  if (ruleId === 'image-alt' || ruleId === 'svg-img-alt' || ruleId === 'input-image-alt' || ruleId === 'image-redundant-alt') return 'images without text';
  if (ruleId.startsWith('heading') || ruleId === 'page-has-heading-one' || ruleId === 'empty-heading') return 'heading structure';
  if (ruleId.startsWith('landmark') || ruleId === 'region') return 'page section labels';
  if (ruleId === 'list' || ruleId === 'listitem' || ruleId === 'definition-list' || ruleId === 'dlitem') return 'list structure';
  if (ruleId === 'meta-refresh') return 'automatic page reload';
  if (ruleId === 'meta-viewport') return 'zoom disabled';
  if (ruleId.startsWith('duplicate-id')) return 'duplicate element IDs';
  if (ruleId.startsWith('aria-')) return "controls screen readers can't read";
  return 'other issues';
}

// Structural rules (heading order, landmarks, lists, doc language) have no
// on-screen spot to crop - the element looks normal - so the client report
// counts/describes them but skips the crop. Unknown rules default to spatial.
export function isStructuralA11yRule(ruleId: string): boolean {
  return (
    ruleId.startsWith('heading') ||
    ruleId === 'page-has-heading-one' ||
    ruleId === 'empty-heading' ||
    ruleId.startsWith('landmark') ||
    ruleId === 'region' ||
    ruleId === 'list' ||
    ruleId === 'listitem' ||
    ruleId === 'definition-list' ||
    ruleId === 'dlitem' ||
    ruleId === 'aria-required-children' ||
    ruleId === 'aria-required-parent' ||
    // duplicate-id: markup defect on a normal element; bypass/aria-hidden-body target the whole doc.
    ruleId === 'duplicate-id' ||
    ruleId === 'duplicate-id-active' ||
    ruleId === 'duplicate-id-aria' ||
    ruleId === 'bypass' ||
    ruleId === 'aria-hidden-body' ||
    ruleId === 'document-title' ||
    ruleId === 'html-has-lang' ||
    ruleId === 'html-lang-valid' ||
    ruleId === 'html-xml-lang-mismatch' ||
    ruleId === 'valid-lang'
  );
}

function isLocalizedBounds(
  width: number,
  height: number,
  screenshotWidth: number,
  screenshotHeight: number,
): boolean {
  const hotspotArea = Math.max(1, width * height);
  const screenshotArea = Math.max(1, screenshotWidth * screenshotHeight);
  return hotspotArea / screenshotArea < 0.65;
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}
