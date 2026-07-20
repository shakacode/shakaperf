/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface A11yRuleFamilyViolationNode {
  target?: unknown;
}

export interface A11yRuleFamilyViolation {
  ruleId: string;
  impact?: string | null;
  nodes?: readonly A11yRuleFamilyViolationNode[];
}

export interface A11yRuleFamilyScan {
  violations: readonly A11yRuleFamilyViolation[];
}

export interface A11yRuleFamily {
  id: string;
  label: string;
  defectCount: number;
  pageCount: number;
}

export interface A11yRuleFamilySummary {
  /** Distinct high-impact defects for the C-panel headline. */
  headlineCount: number;
  countedFamilies: readonly A11yRuleFamily[];
  notCountedExtras: readonly A11yRuleFamily[];
  smallerNotesCount: number;
  sharedDefects: readonly { familyId: string; label: string; pageCount: number }[];
}

interface A11yRuleFamilyDefinition {
  id: string;
  label: string;
  matches: (ruleId: string) => boolean;
}

const A11Y_RULE_FAMILY_DEFINITIONS: readonly A11yRuleFamilyDefinition[] = [
  { id: 'target-size', label: 'touch targets too small to tap reliably', matches: (ruleId) => ruleId === 'target-size' },
  { id: 'image-alt', label: 'images with no text description', matches: (ruleId) => /^(image-alt|svg-img-alt|input-image-alt)$/.test(ruleId) },
  { id: 'unlabeled-controls', label: 'unlabeled controls', matches: (ruleId) => /^(button-name|link-name|label|select-name|aria-input-field-name)$/.test(ruleId) },
  { id: 'list', label: 'broken list markup', matches: (ruleId) => ruleId === 'list' },
  { id: 'nested-interactive', label: 'controls nested inside controls', matches: (ruleId) => ruleId === 'nested-interactive' },
  { id: 'contrast', label: 'text that is too hard to read', matches: (ruleId) => ruleId === 'color-contrast' },
  { id: 'aria', label: 'accessibility markup problems', matches: (ruleId) => ruleId.startsWith('aria-') },
  { id: 'structure', label: 'page structure that is hard to navigate', matches: (ruleId) => /^(region|landmark|heading|page-has-heading-one|empty-heading|html-has-lang|document-title)/.test(ruleId) },
];

const OTHER_A11Y_RULE_FAMILY: A11yRuleFamilyDefinition = {
  id: 'other',
  label: 'other accessibility barrier',
  matches: () => false,
};

function a11yRuleFamilyDefinition(ruleId: string): A11yRuleFamilyDefinition {
  return A11Y_RULE_FAMILY_DEFINITIONS.find((candidate) => candidate.matches(ruleId)) ?? OTHER_A11Y_RULE_FAMILY;
}

function isCountedA11yViolation(violation: A11yRuleFamilyViolation): boolean {
  return violation.impact === 'critical' || violation.impact === 'serious';
}

function normalizeTargetSegment(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function targetKey(target: readonly (string | readonly string[])[]): string {
  return JSON.stringify(target.map((segment) =>
    typeof segment === 'string' ? normalizeTargetSegment(segment) : segment.map(normalizeTargetSegment),
  ));
}

function isKeyableTarget(target: unknown): target is readonly (string | readonly string[])[] {
  return Array.isArray(target)
    && target.length > 0
    && target.every((segment) => typeof segment === 'string'
      ? normalizeTargetSegment(segment).length > 0
      : Array.isArray(segment)
        && segment.length > 0
        && segment.every((part) => typeof part === 'string' && normalizeTargetSegment(part).length > 0));
}

interface TrackedA11yRuleFamily extends A11yRuleFamily {
  selectorPages: Map<string, Set<number>>;
  unkeyedKeys: Set<string>;
}

function trackedFamily(definition: A11yRuleFamilyDefinition): TrackedA11yRuleFamily {
  return {
    id: definition.id,
    label: definition.label,
    defectCount: 0,
    pageCount: 0,
    selectorPages: new Map(),
    unkeyedKeys: new Set(),
  };
}

function trackViolation(
  family: TrackedA11yRuleFamily,
  violation: A11yRuleFamilyViolation,
  pageIndex: number,
): void {
  let hasNode = false;
  let hasUnkeyedNode = false;
  for (const node of violation.nodes ?? []) {
    if (!node || typeof node !== 'object') {
      hasUnkeyedNode = true;
      continue;
    }
    hasNode = true;
    if (!isKeyableTarget(node.target)) {
      hasUnkeyedNode = true;
      continue;
    }
    const selector = `${violation.ruleId}|${targetKey(node.target)}`;
    const selectorPages = family.selectorPages.get(selector) ?? new Set<number>();
    selectorPages.add(pageIndex);
    family.selectorPages.set(selector, selectorPages);
  }
  // A malformed target has no stable selector, so count its rule once per page.
  if (!hasNode || hasUnkeyedNode) family.unkeyedKeys.add(`${violation.ruleId}|page:${pageIndex}`);
}

function finalizeFamily(family: TrackedA11yRuleFamily): A11yRuleFamily {
  return {
    id: family.id,
    label: family.label,
    defectCount: family.selectorPages.size + family.unkeyedKeys.size,
    pageCount: family.pageCount,
  };
}

/**
 * Builds rule-family counts for the C findings panel. The headline counts
 * distinct rule-selector pairs, while family rows retain their page coverage.
 */
export function summarizeA11yRuleFamilies(
  scans: readonly A11yRuleFamilyScan[],
  visibleExtraLimit = 2,
): A11yRuleFamilySummary {
  const counted = new Map<string, TrackedA11yRuleFamily>();
  const extras = new Map<string, TrackedA11yRuleFamily>();
  for (const [pageIndex, scan] of scans.entries()) {
    const countedOnPage = new Map<string, A11yRuleFamilyDefinition>();
    const extrasOnPage = new Map<string, A11yRuleFamilyDefinition>();
    for (const violation of scan.violations) {
      const definition = a11yRuleFamilyDefinition(violation.ruleId);
      if (!isCountedA11yViolation(violation)) {
        extrasOnPage.set(definition.id, definition);
        const current = extras.get(definition.id) ?? trackedFamily(definition);
        trackViolation(current, violation, pageIndex);
        extras.set(definition.id, current);
        continue;
      }
      countedOnPage.set(definition.id, definition);
      const current = counted.get(definition.id) ?? trackedFamily(definition);
      trackViolation(current, violation, pageIndex);
      counted.set(definition.id, current);
    }
    for (const definition of countedOnPage.values()) {
      const current = counted.get(definition.id) ?? trackedFamily(definition);
      current.pageCount += 1;
      counted.set(definition.id, current);
    }
    for (const definition of extrasOnPage.values()) {
      if (countedOnPage.has(definition.id)) continue;
      const current = extras.get(definition.id) ?? trackedFamily(definition);
      current.pageCount += 1;
      extras.set(definition.id, current);
    }
  }
  for (const familyId of counted.keys()) extras.delete(familyId);
  const familyOrder = (familyId: string): number => {
    const index = A11Y_RULE_FAMILY_DEFINITIONS.findIndex((definition) => definition.id === familyId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sortFamilies = (a: A11yRuleFamily, b: A11yRuleFamily): number => (
    b.defectCount - a.defectCount
    || b.pageCount - a.pageCount
    || familyOrder(a.id) - familyOrder(b.id)
    || a.id.localeCompare(b.id)
  );
  const sharedDefects: Array<{ familyId: string; label: string; pageCount: number }> = [];
  for (const family of counted.values()) {
    for (const pages of family.selectorPages.values()) {
      if (pages.size > 1) {
        sharedDefects.push({ familyId: family.id, label: family.label, pageCount: pages.size });
      }
    }
  }
  const countedFamilies = [...counted.values()]
    .map(finalizeFamily)
    .sort(sortFamilies);
  const allExtras = [...extras.values()].map(finalizeFamily).sort(sortFamilies);
  const safeExtraLimit = Math.max(0, Math.floor(visibleExtraLimit));
  const notCountedExtras = allExtras.slice(0, safeExtraLimit);
  const smallerNotesCount = allExtras.slice(safeExtraLimit).reduce((total, family) => total + family.defectCount, 0);
  return {
    headlineCount: countedFamilies.reduce((total, family) => total + family.defectCount, 0),
    countedFamilies,
    notCountedExtras,
    smallerNotesCount,
    sharedDefects: sharedDefects.sort((a, b) => b.pageCount - a.pageCount || familyOrder(a.familyId) - familyOrder(b.familyId) || a.familyId.localeCompare(b.familyId)),
  };
}
