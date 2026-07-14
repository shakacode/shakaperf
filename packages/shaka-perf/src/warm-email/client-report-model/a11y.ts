/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { sortViolations } from '../../audit/stages/accessibility/report-utils';
import type {
  AccessibilityScan,
  AccessibilityViolation,
} from '../../audit/stages/accessibility/types';
import type { StrongPageGroup } from './cost';

/** A C-design strong-page group replaces individual cards on the a11y or AI tabs. */
export type A11yStrongPageGroup = StrongPageGroup;

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
  { id: 'target-size', label: 'touch targets too small', matches: (ruleId) => ruleId === 'target-size' },
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

export interface A11yPromptRule {
  ruleId: string;
  impact: string;
  selectors: string[];
  htmlExample?: string;
}

interface A11yRuleMatcher {
  ids?: readonly string[];
  prefixes?: readonly string[];
  pattern?: RegExp;
}

interface A11yAffectsCopy extends A11yRuleMatcher {
  key: string;
  sentence: string;
  fixClause?: string;
}

const A11Y_HTML_EXAMPLE_CHARS = 240;

const A11Y_AFFECTS_COPY: readonly A11yAffectsCopy[] = [
  {
    key: 'contrast',
    ids: ['color-contrast'],
    sentence: 'Low-vision users can miss key content or calls to action when text contrast is too low.',
    fixClause: 'raise its text contrast so low-vision visitors can read it',
  },
  {
    key: 'zoom',
    ids: ['meta-viewport'],
    sentence: 'Low-vision users can be blocked from enlarging the page enough to read it.',
  },
  {
    key: 'refresh',
    ids: ['meta-refresh'],
    sentence: 'Screen-reader and keyboard users can be thrown back to the top before they finish.',
    fixClause: 'stop it from reloading on its own so screen reader and keyboard visitors are not thrown back to the top',
  },
  {
    key: 'keyboard',
    ids: ['scrollable-region-focusable'],
    pattern: /keyboard|tabindex|focus|nested-interactive/,
    sentence: 'Keyboard users can get stuck or miss controls when focus and scroll areas are not operable.',
  },
  {
    key: 'images',
    ids: ['image-alt', 'svg-img-alt', 'input-image-alt'],
    sentence: 'Screen-reader users lose product or content context when images have no text alternative.',
    fixClause: 'add text descriptions to its images so screen reader visitors know what they show',
  },
  {
    key: 'controls',
    ids: ['button-name', 'link-name', 'label', 'select-name', 'aria-input-field-name'],
    prefixes: ['aria-'],
    sentence: 'Screen-reader users are left guessing what buttons, links, or fields do when controls are not labeled.',
    fixClause: 'label its controls clearly so screen reader visitors know what they do',
  },
  {
    key: 'structure',
    ids: ['region'],
    prefixes: ['landmark'],
    sentence: 'Screen-reader users have to work harder to navigate the page when structure is unclear.',
    fixClause: 'label its page areas clearly so screen reader visitors can reach the main content and tell sections apart',
  },
  {
    key: 'structure',
    ids: ['page-has-heading-one', 'empty-heading'],
    prefixes: ['heading'],
    sentence: 'Screen-reader users have to work harder to navigate the page when structure is unclear.',
    fixClause: 'fix its heading order so screen reader visitors can move through it',
  },
  {
    key: 'structure',
    ids: ['html-has-lang', 'document-title'],
    sentence: 'Screen-reader users have to work harder to navigate the page when structure is unclear.',
  },
];

const A11Y_FALLBACK_AFFECTS =
  'Screen-reader and keyboard users can lose the context or controls they need to understand and operate the page.';
const A11Y_FALLBACK_FIX_CLAUSE =
  'fix its accessibility barriers so screen reader and keyboard visitors can use it';

function ruleMatches(ruleId: string, matcher: A11yRuleMatcher): boolean {
  return (
    (matcher.ids?.includes(ruleId) ?? false) ||
    (matcher.prefixes?.some((prefix) => ruleId.startsWith(prefix)) ?? false) ||
    (matcher.pattern?.test(ruleId) ?? false)
  );
}

function affectsCopyForRule(ruleId: string): A11yAffectsCopy | undefined {
  return A11Y_AFFECTS_COPY.find((copy) => ruleMatches(ruleId, copy));
}

function fixCopyForRule(ruleId: string): A11yAffectsCopy | undefined {
  return A11Y_AFFECTS_COPY.find((copy) => copy.fixClause && ruleMatches(ruleId, copy));
}

const isHighImpact = (impact: AccessibilityViolation['impact']): boolean =>
  impact === 'critical' || impact === 'serious';

function a11ySelectors(violation: AccessibilityViolation): string[] {
  const seen = new Set<string>();
  const selectors: string[] = [];
  for (const node of violation.nodes ?? []) {
    const targets = Array.isArray(node.target) ? node.target : [];
    for (const target of targets) {
      const selector = (
        Array.isArray(target)
          ? target.filter((part): part is string => typeof part === 'string').join(' ')
          : typeof target === 'string' ? target : ''
      ).trim();
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      selectors.push(selector);
      if (selectors.length >= 5) return selectors;
    }
  }
  return selectors;
}

function a11yHtmlExample(violation: AccessibilityViolation): string | undefined {
  for (const node of violation.nodes ?? []) {
    if (typeof node.html !== 'string') continue;
    const html = node.html.replace(/\s+/g, ' ').trim();
    if (!html) continue;
    return html.length <= A11Y_HTML_EXAMPLE_CHARS
      ? html
      : `${html.slice(0, A11Y_HTML_EXAMPLE_CHARS - 3).trimEnd()}...`;
  }
  return undefined;
}

export function a11yPromptRules(scan: AccessibilityScan): A11yPromptRule[] {
  return sortViolations(scan.violations).slice(0, 3).map((violation) => {
    const rule: A11yPromptRule = {
      ruleId: violation.ruleId,
      impact: violation.impact ?? 'unknown',
      selectors: a11ySelectors(violation),
    };
    const htmlExample = a11yHtmlExample(violation);
    if (htmlExample) rule.htmlExample = htmlExample;
    return rule;
  });
}

export function a11yAffectsProse(scan: AccessibilityScan): string {
  const sentences: string[] = [];
  const seen = new Set<string>();
  for (const violation of sortViolations(scan.violations).filter((v) => isHighImpact(v.impact))) {
    const copy = affectsCopyForRule(violation.ruleId);
    const key = copy?.key ?? 'fallback';
    if (seen.has(key)) continue;
    seen.add(key);
    sentences.push(copy?.sentence ?? A11Y_FALLBACK_AFFECTS);
    if (sentences.length >= 2) break;
  }
  return sentences.join(' ');
}

export function a11yFixClause(ruleId: string): string {
  return fixCopyForRule(ruleId)?.fixClause ?? A11Y_FALLBACK_FIX_CLAUSE;
}
