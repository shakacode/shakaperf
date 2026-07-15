/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { a11yIssueLabel, sortViolations } from '../../audit/stages/accessibility/report-utils';
import type {
  AccessibilityScan,
  AccessibilityViolation,
} from '../../audit/stages/accessibility/types';
import { buildA11ySitePrompt } from '../copy-prompt';
import { NO_MATERIAL_LOSS, a11yNoNumberLine } from '../cost-strings';
import type { ClientReportA11yCard, ClientReportBlockedPage, ClientReportCostBlock, ClientReportModel, ClientReportStatus } from '../client-report-renderer';
import type { PagePerf } from '../synthesis';
import { a11yContrastGap, a11yFixText, worstContrastRatio, type StrongPageGroup } from './cost';
import { SCORE_BADGE_POLICY, scoreStatus } from './perf';

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

export interface A11ySectionCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

export interface A11ySectionView {
  page: PagePerf;
  scan: AccessibilityScan;
  counts: A11ySectionCounts;
  client?: { score?: number; summary?: string; fixes?: string[] };
}

export interface A11yPromptContext {
  host: string;
  date: string;
}

export interface PreparedA11ySection {
  hasA11y: boolean;
  a11yBlocked: ClientReportBlockedPage[];
  a11yCouldNotMeasure: boolean;
  a11yMeasurable: A11ySectionView[];
  cardedA11y: A11ySectionView[];
  fineA11y: A11ySectionView[];
}

export interface A11ySection extends PreparedA11ySection {
  a11yCards: ClientReportA11yCard[];
  a11yFine: ClientReportModel['a11yFine'];
  a11yScore?: number;
  a11yStatus: ClientReportStatus;
  highImpactTotal: number;
  a11yTopIssues: string[];
  a11yWorst?: A11ySectionView;
  a11yCost?: ClientReportCostBlock;
}

const hasMajorA11yBarrier = (counts: A11ySectionCounts): boolean => counts.critical + counts.serious > 0;

export function prepareA11ySection(views: readonly A11ySectionView[]): PreparedA11ySection {
  const a11yBlockedViews = views.filter((view) => view.scan.blocked === true);
  const a11yMeasurable = views.filter((view) => view.scan.blocked !== true);
  return {
    hasA11y: views.length > 0,
    a11yBlocked: a11yBlockedViews.map((view) => ({ name: view.page.name, path: view.page.startingPath || '/' })),
    a11yCouldNotMeasure: a11yMeasurable.length === 0 && a11yBlockedViews.length > 0,
    a11yMeasurable,
    cardedA11y: a11yMeasurable.filter((view) => hasMajorA11yBarrier(view.counts)),
    fineA11y: a11yMeasurable.filter((view) => !hasMajorA11yBarrier(view.counts)),
  };
}

function liveUrlFor(siteUrl: string, startingPath: string): string | undefined {
  return siteUrl && startingPath ? `${siteUrl.replace(/\/$/, '')}${startingPath}` : undefined;
}

function a11yPageUrl(siteUrl: string, view: A11ySectionView): string {
  return liveUrlFor(siteUrl, view.page.startingPath || '/') || view.scan.url || siteUrl;
}

function a11yFamilyId(violation: AccessibilityViolation): string | undefined {
  const summary = summarizeA11yRuleFamilies([{ violations: [violation] }], 1);
  return summary.countedFamilies[0]?.id ?? summary.notCountedExtras[0]?.id;
}

function isHighImpactA11yViolation(violation: AccessibilityViolation): boolean {
  return violation.impact === 'critical' || violation.impact === 'serious';
}

function a11yViolationSelectors(violation: AccessibilityViolation): string[] {
  const selectors = new Set<string>();
  for (const node of violation.nodes) {
    for (const target of node.target) {
      const selector = (Array.isArray(target) ? target.join(' ') : target).trim();
      if (selector) selectors.add(selector);
    }
  }
  return [...selectors];
}

function safeA11ySharedSelector(selector: string): string | undefined {
  const normalized = selector.replace(/\s+/g, ' ').trim();
  const simpleSelector = /^(?:(?:a|article|button|div|footer|form|h[1-6]|header|img|input|label|li|main|nav|ol|p|section|select|span|textarea|ul)(?:\.[A-Za-z_][\w-]*)*|\.[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)(?:\[[A-Za-z][\w:-]*(?:=(?:"[A-Za-z0-9_:#.+/-]*"|'[A-Za-z0-9_:#.+/-]*'|[A-Za-z0-9_:#.+/-]*))?\])?$/i;
  const instructionLikeClass = /(?:^|\.)(?:ignore|disregard|forget|override|bypass)(?:[-_][A-Za-z0-9_]+)*[-_](?:instructions?|prompt|system|developer|assistant|user|tool)(?:$|\.|\[)/i;
  return normalized.length > 0
    && normalized.length <= 240
    && !/(?:https?:)?\/\//i.test(normalized)
    && !instructionLikeClass.test(normalized)
    && simpleSelector.test(normalized)
    ? normalized
    : undefined;
}

function a11yFamilyPromptFindings(
  views: readonly A11ySectionView[],
  families: readonly { id: string; label: string; pageCount: number }[],
  siteUrl: string,
  highImpact: boolean,
): Array<{
  familyId: string;
  label: string;
  impact: string;
  pageCount: number;
  pageUrls: string[];
  verificationRuleIds: string[];
  sharedComponent?: { selector: string };
}> {
  return families.map((family) => {
    const pageUrls = new Set<string>();
    const ruleIds = new Set<string>();
    const selectorPages = new Map<string, Set<string>>();
    let critical = false;
    let serious = false;
    for (const view of views) {
      for (const violation of view.scan.violations) {
        if (a11yFamilyId(violation) !== family.id || isHighImpactA11yViolation(violation) !== highImpact) continue;
        const pageUrl = a11yPageUrl(siteUrl, view);
        pageUrls.add(pageUrl);
        ruleIds.add(violation.ruleId);
        critical ||= violation.impact === 'critical';
        serious ||= violation.impact === 'serious';
        for (const selector of a11yViolationSelectors(violation)) {
          const pages = selectorPages.get(selector) ?? new Set<string>();
          pages.add(pageUrl);
          selectorPages.set(selector, pages);
        }
      }
    }
    const sharedSelector = [...selectorPages]
      .filter(([, pages]) => pages.size > 1)
      .map(([selector]) => safeA11ySharedSelector(selector))
      .find((selector): selector is string => selector !== undefined);
    return {
      familyId: family.id,
      label: family.label,
      impact: critical ? 'critical' : serious ? 'serious' : 'moderate',
      pageCount: family.pageCount,
      pageUrls: [...pageUrls],
      verificationRuleIds: [...ruleIds],
      ...(sharedSelector ? { sharedComponent: { selector: sharedSelector } } : {}),
    };
  });
}

function a11yFamilyReach(pageCount: number, pageTotal: number): string {
  return pageCount === pageTotal
    ? `all ${pageTotal} ${pageTotal === 1 ? 'page' : 'pages'}`
    : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
}

function a11yFamilyLine(family: { label: string; pageCount: number }, pageTotal: number): string {
  return `${family.label} - ${a11yFamilyReach(family.pageCount, pageTotal)}`;
}

/** Builds the a11y family, cost, and site-prompt data from already-read scans. */
export function buildA11ySection(
  prepared: PreparedA11ySection,
  a11yCards: ClientReportA11yCard[],
  siteUrl: string,
  promptCtx: A11yPromptContext,
): A11ySection {
  const { hasA11y, a11yBlocked, a11yCouldNotMeasure, a11yMeasurable, cardedA11y, fineA11y } = prepared;
  const a11yFindingScans = a11yMeasurable.map((view) => view.scan);
  const a11yFamilySummary = summarizeA11yRuleFamilies(a11yFindingScans);
  const a11yFine = fineA11y.map((view) => {
    const score = view.client?.score;
    const row: ClientReportModel['a11yFine'][number] = {
      name: view.page.name,
      path: view.page.startingPath || '/',
      status: typeof score === 'number' ? scoreStatus(score) : 'good',
      summary: view.client?.summary ? view.client.summary.replace(/\s*[—–]\s*/g, ' - ') : 'Only minor issues here.',
    };
    if (typeof score === 'number') row.score = score;
    return row;
  });
  const a11yScores = [...a11yCards.map((card) => card.score), ...a11yFine.map((row) => row.score)].filter((score): score is number => typeof score === 'number');
  const a11yScore = !a11yCouldNotMeasure && a11yScores.length > 0
    ? Math.round(a11yScores.reduce((sum, score) => sum + score, 0) / a11yScores.length)
    : undefined;
  const highImpactTotal = a11yFamilySummary.headlineCount;
  const criticalTotal = cardedA11y.reduce((total, view) => total + view.counts.critical, 0);
  const a11yStatus: ClientReportStatus = !hasA11y || highImpactTotal === 0 ? 'good' : criticalTotal > 0 ? 'poor' : 'fair';
  const a11yIssueWeight = new Map<string, number>();
  for (const view of cardedA11y) {
    for (const violation of view.scan.violations) {
      const label = a11yIssueLabel(violation.ruleId);
      a11yIssueWeight.set(label, (a11yIssueWeight.get(label) ?? 0) + (violation.impact === 'critical' || violation.impact === 'serious' ? 3 : 1));
    }
  }
  const a11yTopIssues = [...a11yIssueWeight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label).slice(0, 2);
  const a11yWorst = cardedA11y[0];
  const a11yHeadlineScope = cardedA11y.length === a11yMeasurable.length
    ? `across your ${a11yMeasurable.length} ${a11yMeasurable.length === 1 ? 'page' : 'pages'}`
    : `on ${cardedA11y.length} of ${a11yMeasurable.length} pages checked`;
  const a11yFix = a11yFixText(a11yFindingScans);
  const a11yGap = a11yContrastGap(worstContrastRatio(a11yFindingScans));
  const a11yCountedFamilies = a11yFamilySummary.countedFamilies;
  const widestA11yFamily = a11yCountedFamilies[0];
  const a11yFixTextWithLead = widestA11yFamily
    ? `Start with ${widestA11yFamily.label} - it reaches ${a11yFamilyReach(widestA11yFamily.pageCount, a11yMeasurable.length)}. ${a11yFix ?? ''}`.trim()
    : a11yFix;
  const a11yWorstFamilyCount = a11yWorst
    ? summarizeA11yRuleFamilies([a11yWorst.scan]).headlineCount
    : 0;
  const a11yFindingLines = a11yWorst
    ? [
      `worst page: ${a11yWorst.page.name} - ${a11yWorstFamilyCount} high-impact`,
      ...(criticalTotal > 0 ? ['Critical accessibility barriers found'] : []),
      ...a11yCountedFamilies.map((family) => a11yFamilyLine(family, a11yMeasurable.length)),
      ...(a11yFamilySummary.notCountedExtras.length > 0
        ? [`also seen, not counted in the ${highImpactTotal}: ${a11yFamilySummary.notCountedExtras.map((family) => a11yFamilyLine(family, a11yMeasurable.length)).join('; ')}`]
        : []),
      ...(a11yFamilySummary.smallerNotesCount > 0
        ? [`plus ${a11yFamilySummary.smallerNotesCount} smaller ${a11yFamilySummary.smallerNotesCount === 1 ? 'note' : 'notes'}`]
        : []),
      'WCAG - passes at zero critical barriers',
    ]
    : [];
  const a11yPromptFindings = a11yFamilyPromptFindings(a11yMeasurable, a11yCountedFamilies, siteUrl, true);
  const a11yLowerImpactPromptFindings = a11yFamilySummary.notCountedExtras.length > 0
    ? a11yFamilyPromptFindings(a11yMeasurable, a11yFamilySummary.notCountedExtras, siteUrl, false)
    : undefined;
  const a11ySitePromptData = a11yWorst && a11yWorstFamilyCount > 0
    ? {
      url: siteUrl,
      host: promptCtx.host,
      date: promptCtx.date,
      pageCount: a11yMeasurable.length,
      highImpactCount: highImpactTotal,
      worstPage: { url: a11yPageUrl(siteUrl, a11yWorst), highImpactCount: a11yWorstFamilyCount },
      pageUrls: a11yMeasurable.map((view) => a11yPageUrl(siteUrl, view)),
      findings: a11yPromptFindings,
      ...(a11yLowerImpactPromptFindings ? { lowerImpactFindings: a11yLowerImpactPromptFindings } : {}),
      ...(a11yFamilySummary.smallerNotesCount > 0 ? { smallerNotesCount: a11yFamilySummary.smallerNotesCount } : {}),
    }
    : undefined;
  const a11ySitePrompt = a11ySitePromptData
    ? buildA11ySitePrompt(a11ySitePromptData)
      ?? buildA11ySitePrompt({
        ...a11ySitePromptData,
        findings: a11ySitePromptData.findings.map(({ sharedComponent: _sharedComponent, ...finding }) => finding),
        ...(a11ySitePromptData.lowerImpactFindings
          ? { lowerImpactFindings: a11ySitePromptData.lowerImpactFindings.map(({ sharedComponent: _sharedComponent, ...finding }) => finding) }
          : {}),
      })
    : undefined;
  const a11yAffects = (scan: AccessibilityScan): string =>
    [a11yAffectsProse(scan), a11yNoNumberLine()].filter(Boolean).join(' ');
  let a11yCost: ClientReportCostBlock | undefined;
  if (a11yCouldNotMeasure) {
    a11yCost = { tab: 'a11y', state: 'blocked', headline: '' };
  } else if (highImpactTotal > 0 && a11yWorst) {
    a11yCost = {
      tab: 'a11y',
      state: 'measured',
      headline: `${highImpactTotal} high-impact ${highImpactTotal === 1 ? 'barrier keeps' : 'barriers keep'} some visitors from using the site.`,
      headlineSub: `The bar for any website is zero barriers that block someone. We found ${highImpactTotal} ${a11yHeadlineScope}.`,
      affectsProse: a11yAffects(a11yWorst.scan),
      ...(a11ySitePrompt ? { sitePrompts: { a11y: a11ySitePrompt } } : {}),
      gapSubLines: a11yFindingLines,
      ...(a11yGap ? { gap: a11yGap } : {}),
      ...(a11yFixTextWithLead ? { fix: { tone: 'secondary' as const, text: a11yFixTextWithLead } } : {}),
      scoreBadgePolicy: SCORE_BADGE_POLICY,
    };
  } else if (fineA11y.some((view) => view.scan.violations.length > 0)) {
    const strongestMinorScan = fineA11y.find((view) => view.scan.violations.length > 0)!.scan;
    a11yCost = {
      tab: 'a11y',
      state: 'zero',
      headline: NO_MATERIAL_LOSS,
      affectsProse: a11yAffects(strongestMinorScan),
      stakes: {
        kind: 'no-material-loss',
        prose: `${NO_MATERIAL_LOSS} Nothing we measured is turning visitors away today - that is rarer than it sounds, and worth protecting.`,
      },
      ...(a11yGap ? { gap: a11yGap } : {}),
      ...(a11yFixTextWithLead ? { fix: { tone: 'secondary' as const, text: a11yFixTextWithLead } } : {}),
      scoreBadgePolicy: SCORE_BADGE_POLICY,
    };
  }
  const a11yStrongPages = fineA11y
    .filter((view) => typeof view.client?.score === 'number' && scoreStatus(view.client.score) === 'good')
    .map((view) => ({ name: view.page.name, score: view.client!.score! }));
  if (a11yCost && a11yStrongPages.length === fineA11y.length && a11yStrongPages.length > 0) {
    a11yCost.strongPageGroup = { label: 'Strong pages', pages: a11yStrongPages };
  }
  return {
    ...prepared,
    a11yCards,
    a11yFine,
    ...(a11yScore !== undefined ? { a11yScore } : {}),
    a11yStatus,
    highImpactTotal,
    a11yTopIssues,
    ...(a11yWorst ? { a11yWorst } : {}),
    ...(a11yCost ? { a11yCost } : {}),
  };
}
