/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface A11yRuleFamilyViolation {
  ruleId: string;
  impact?: string | null;
}

export interface A11yRuleFamilyScan {
  violations: readonly A11yRuleFamilyViolation[];
}

export interface A11yRuleFamily {
  id: string;
  label: string;
  pageCount: number;
}

export interface A11yRuleFamilySummary {
  /** Use with countedFamilies for the reconciled C-panel headline. */
  headlineCount: number;
  countedFamilies: readonly A11yRuleFamily[];
  notCountedExtras: readonly A11yRuleFamily[];
  smallerNotesCount: number;
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

/**
 * Builds reconciled rule-family counts for the C findings panel. A page can
 * count once per rule family, so counted-family totals always equal headlineCount.
 */
export function summarizeA11yRuleFamilies(
  scans: readonly A11yRuleFamilyScan[],
  visibleExtraLimit = 2,
): A11yRuleFamilySummary {
  const counted = new Map<string, A11yRuleFamily>();
  const extras = new Map<string, A11yRuleFamily>();
  for (const scan of scans) {
    const countedOnPage = new Map<string, A11yRuleFamilyDefinition>();
    const extrasOnPage = new Map<string, A11yRuleFamilyDefinition>();
    for (const violation of scan.violations) {
      const definition = a11yRuleFamilyDefinition(violation.ruleId);
      (isCountedA11yViolation(violation) ? countedOnPage : extrasOnPage).set(definition.id, definition);
    }
    for (const definition of countedOnPage.values()) {
      const current = counted.get(definition.id) ?? { id: definition.id, label: definition.label, pageCount: 0 };
      current.pageCount += 1;
      counted.set(definition.id, current);
    }
    for (const definition of extrasOnPage.values()) {
      if (countedOnPage.has(definition.id)) continue;
      const current = extras.get(definition.id) ?? { id: definition.id, label: definition.label, pageCount: 0 };
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
    b.pageCount - a.pageCount
    || familyOrder(a.id) - familyOrder(b.id)
    || a.id.localeCompare(b.id)
  );
  const countedFamilies = [...counted.values()].sort(sortFamilies);
  const allExtras = [...extras.values()].sort(sortFamilies);
  const safeExtraLimit = Math.max(0, Math.floor(visibleExtraLimit));
  const notCountedExtras = allExtras.slice(0, safeExtraLimit);
  const smallerNotesCount = allExtras.slice(safeExtraLimit).reduce((total, family) => total + family.pageCount, 0);
  return {
    headlineCount: countedFamilies.reduce((total, family) => total + family.pageCount, 0),
    countedFamilies,
    notCountedExtras,
    smallerNotesCount,
  };
}
