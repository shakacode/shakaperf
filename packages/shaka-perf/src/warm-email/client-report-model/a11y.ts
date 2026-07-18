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
import { NO_MATERIAL_LOSS, a11yNoNumberLine } from '../cost-strings';
import type { ClientReportA11yCard, ClientReportBlockedPage, ClientReportCostBlock, ClientReportModel, ClientReportStatus } from '../client-report-renderer';
import type { PagePerf } from '../synthesis';
import { a11yContrastGap, a11yFixText, worstContrastRatio, type StrongPageGroup } from './cost';
import { summarizeA11yRuleFamilies } from './a11y-rule-families';
import { buildCanonicalA11ySitePrompt } from './a11y-site-prompt';
import { SCORE_BADGE_POLICY, scoreStatus } from './perf';
import { dashSafe } from './shared';

/** A C-design strong-page group replaces individual cards on the a11y or AI tabs. */
export type A11yStrongPageGroup = StrongPageGroup;

export {
  summarizeA11yRuleFamilies,
  type A11yRuleFamily,
  type A11yRuleFamilyScan,
  type A11yRuleFamilySummary,
  type A11yRuleFamilyViolation,
} from './a11y-rule-families';

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
  a11yStrongPageGroup?: A11yStrongPageGroup;
  a11yScore?: number;
  a11yStatus: ClientReportStatus;
  highImpactTotal: number;
  lowerImpactTotal: number;
  a11yTopIssues: string[];
  a11yWorst?: A11ySectionView;
  a11yCost?: ClientReportCostBlock;
}

export const hasMajorA11yBarrier = (counts: A11ySectionCounts): boolean => counts.critical + counts.serious > 0;

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
  const lowerImpactA11y = fineA11y.filter((view) => view.scan.violations.length > 0);
  const groupLowerImpact = lowerImpactA11y.length > 0
    && lowerImpactA11y.every((view) => {
      const score = view.client?.score;
      return typeof score === 'number' && scoreStatus(score) !== 'poor';
    });
  const groupedA11y = fineA11y.filter((view) => view.scan.violations.length === 0 || groupLowerImpact);
  const ungroupedA11y = groupLowerImpact ? [] : lowerImpactA11y;
  const a11yFindingScans = a11yMeasurable.map((view) => view.scan);
  const a11yFamilySummary = summarizeA11yRuleFamilies(a11yFindingScans);
  const a11yFine = ungroupedA11y.map((view) => {
    const score = view.client?.score;
    const row: ClientReportModel['a11yFine'][number] = {
      name: view.page.name,
      path: view.page.startingPath || '/',
      status: typeof score === 'number' ? scoreStatus(score) : 'good',
      summary: view.client?.summary ? dashSafe(view.client.summary) : 'Only minor issues here.',
    };
    if (typeof score === 'number') row.score = score;
    return row;
  });
  const a11yScores = [
    ...a11yCards.map((card) => card.score),
    ...fineA11y.map((view) => view.client?.score),
  ].filter((score): score is number => typeof score === 'number');
  const a11yScore = !a11yCouldNotMeasure && a11yScores.length > 0
    ? Math.round(a11yScores.reduce((sum, score) => sum + score, 0) / a11yScores.length)
    : undefined;
  const highImpactTotal = a11yFamilySummary.headlineCount;
  const lowerImpactTotal = lowerImpactA11y.reduce((total, view) => total + view.scan.violations.length, 0);
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
  const a11ySitePrompt = buildCanonicalA11ySitePrompt({
    views: a11yMeasurable,
    worstView: a11yWorst,
    siteUrl,
    promptContext: promptCtx,
  });
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
  } else if (lowerImpactA11y.length > 0) {
    const strongestMinorScan = lowerImpactA11y[0].scan;
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
  const a11yStrongPages = groupedA11y.map((view) => ({
    name: view.page.name,
    ...(typeof view.client?.score === 'number' ? { score: view.client.score } : {}),
  }));
  const a11yStrongPageGroup = a11yStrongPages.length > 0
    ? { label: 'Strong pages', pages: a11yStrongPages }
    : undefined;
  return {
    ...prepared,
    a11yCards,
    a11yFine,
    ...(a11yScore !== undefined ? { a11yScore } : {}),
    a11yStatus,
    highImpactTotal,
    lowerImpactTotal,
    a11yTopIssues,
    ...(a11yWorst ? { a11yWorst } : {}),
    ...(a11yStrongPageGroup ? { a11yStrongPageGroup } : {}),
    ...(a11yCost ? { a11yCost } : {}),
  };
}
