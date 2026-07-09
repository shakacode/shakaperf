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
