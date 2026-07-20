/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface A11yRuleFamilyViolationNode {
  target?: readonly (string | readonly string[])[];
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
  /** High-impact family occurrences, counted once per affected page. */
  occurrenceCount: number;
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

function hasSelector(target: readonly (string | readonly string[])[]): boolean {
  return target.some((segment) =>
    typeof segment === 'string'
      ? normalizeTargetSegment(segment).length > 0
      : segment.some((part) => normalizeTargetSegment(part).length > 0),
  );
}

interface CountedA11yRuleFamily extends A11yRuleFamily {
  selectorPages: Map<string, Set<number>>;
  unkeyedPages: Set<number>;
}

function countedFamily(definition: A11yRuleFamilyDefinition): CountedA11yRuleFamily {
  return {
    id: definition.id,
    label: definition.label,
    defectCount: 0,
    pageCount: 0,
    selectorPages: new Map(),
    unkeyedPages: new Set(),
  };
}

/**
 * Builds rule-family counts for the C findings panel. The headline counts
 * distinct selector clusters, while family rows retain their page coverage.
 */
export function summarizeA11yRuleFamilies(
  scans: readonly A11yRuleFamilyScan[],
  visibleExtraLimit = 2,
): A11yRuleFamilySummary {
  const counted = new Map<string, CountedA11yRuleFamily>();
  const extras = new Map<string, A11yRuleFamily>();
  for (const [pageIndex, scan] of scans.entries()) {
    const countedOnPage = new Map<string, A11yRuleFamilyDefinition>();
    const extrasOnPage = new Map<string, A11yRuleFamilyDefinition>();
    for (const violation of scan.violations) {
      const definition = a11yRuleFamilyDefinition(violation.ruleId);
      if (!isCountedA11yViolation(violation)) {
        extrasOnPage.set(definition.id, definition);
        continue;
      }
      countedOnPage.set(definition.id, definition);
      const current = counted.get(definition.id) ?? countedFamily(definition);
      let hasKeyedNode = false;
      for (const node of violation.nodes ?? []) {
        if (!node.target || !hasSelector(node.target)) continue;
        hasKeyedNode = true;
        const selector = `${violation.ruleId}|${targetKey(node.target)}`;
        const selectorPages = current.selectorPages.get(selector) ?? new Set<number>();
        selectorPages.add(pageIndex);
        current.selectorPages.set(selector, selectorPages);
      }
      if (!hasKeyedNode) current.unkeyedPages.add(pageIndex);
      counted.set(definition.id, current);
    }
    for (const definition of countedOnPage.values()) {
      const current = counted.get(definition.id) ?? countedFamily(definition);
      current.pageCount += 1;
      counted.set(definition.id, current);
    }
    for (const definition of extrasOnPage.values()) {
      if (countedOnPage.has(definition.id)) continue;
      const current = extras.get(definition.id) ?? { id: definition.id, label: definition.label, defectCount: 0, pageCount: 0 };
      current.pageCount += 1;
      current.defectCount += 1;
      extras.set(definition.id, current);
    }
  }
  for (const familyId of counted.keys()) extras.delete(familyId);
  const familyOrder = (familyId: string): number => {
    const index = A11Y_RULE_FAMILY_DEFINITIONS.findIndex((definition) => definition.id === familyId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sortFamilies = (a: A11yRuleFamily, b: A11yRuleFamily): number => (
    b.pageCount - a.pageCount
    || familyOrder(a.id) - familyOrder(b.id)
    || a.id.localeCompare(b.id)
  );
  const sharedDefects: Array<{ familyId: string; label: string; pageCount: number }> = [];
  for (const family of counted.values()) {
    const pageDefects = new Set(family.unkeyedPages);
    let sharedCount = 0;
    for (const pages of family.selectorPages.values()) {
      if (pages.size > 1) {
        sharedCount += 1;
        sharedDefects.push({ familyId: family.id, label: family.label, pageCount: pages.size });
      } else {
        for (const pageIndex of pages) pageDefects.add(pageIndex);
      }
    }
    family.defectCount = sharedCount + pageDefects.size;
  }
  const countedFamilies = [...counted.values()]
    .map(({ id, label, defectCount, pageCount }) => ({ id, label, defectCount, pageCount }))
    .sort(sortFamilies);
  const allExtras = [...extras.values()].sort(sortFamilies);
  const safeExtraLimit = Math.max(0, Math.floor(visibleExtraLimit));
  const notCountedExtras = allExtras.slice(0, safeExtraLimit);
  const smallerNotesCount = allExtras.slice(safeExtraLimit).reduce((total, family) => total + family.pageCount, 0);
  return {
    headlineCount: countedFamilies.reduce((total, family) => total + family.defectCount, 0),
    occurrenceCount: countedFamilies.reduce((total, family) => total + family.pageCount, 0),
    countedFamilies,
    notCountedExtras,
    smallerNotesCount,
    sharedDefects: sharedDefects.sort((a, b) => b.pageCount - a.pageCount || familyOrder(a.familyId) - familyOrder(b.familyId) || a.familyId.localeCompare(b.familyId)),
  };
}
