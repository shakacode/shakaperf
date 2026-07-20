/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AccessibilityViolation } from '../../audit/stages/accessibility/types';
import { buildA11ySitePrompt, type A11ySitePromptData, type A11ySitePromptFinding } from '../copy-prompt';
import type { A11yPromptContext, A11ySectionView } from './a11y';
import { summarizeA11yRuleFamilies, type A11yRuleFamily } from './a11y-rule-families';
import { liveUrlFor } from './shared';

export interface BuildCanonicalA11ySitePromptInput {
  views: readonly A11ySectionView[];
  worstView?: A11ySectionView;
  siteUrl: string;
  promptContext: A11yPromptContext;
}

function a11yPageUrl(siteUrl: string, view: A11ySectionView): string {
  return liveUrlFor(siteUrl, view.page.startingPath || '/') || view.scan.url || siteUrl;
}

function canonicalA11yPageUrl(siteUrl: string, view: A11ySectionView): string {
  const pageUrl = a11yPageUrl(siteUrl, view);
  try {
    const parsed = new URL(pageUrl);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return pageUrl;
  }
}

function aggregateA11yPromptViews(
  views: readonly A11ySectionView[],
  siteUrl: string,
): A11ySectionView[] {
  // Report rows stay scenario-specific; only remediation prompt URLs are coalesced.
  const byPageUrl = new Map<string, A11ySectionView>();
  for (const view of views) {
    const key = canonicalA11yPageUrl(siteUrl, view);
    const existing = byPageUrl.get(key);
    if (!existing) {
      byPageUrl.set(key, view);
      continue;
    }
    const violations = [...existing.scan.violations, ...view.scan.violations];
    byPageUrl.set(key, {
      ...existing,
      scan: { ...existing.scan, violations },
      counts: {
        critical: existing.counts.critical + view.counts.critical,
        serious: existing.counts.serious + view.counts.serious,
        moderate: existing.counts.moderate + view.counts.moderate,
        minor: existing.counts.minor + view.counts.minor,
      },
      client: existing.client ?? view.client,
    });
  }
  return [...byPageUrl.values()];
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
  // The prompt builder intentionally rejects untrusted or incomplete selectors.
  // Keep this optional shared-component evidence to a conservative subset it accepts.
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
  families: readonly A11yRuleFamily[],
  siteUrl: string,
  highImpact: boolean,
): A11ySitePromptFinding[] {
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
      defectCount: family.defectCount,
      pageCount: family.pageCount,
      pageUrls: [...pageUrls],
      verificationRuleIds: [...ruleIds],
      ...(sharedSelector ? { sharedComponent: { selector: sharedSelector } } : {}),
    };
  });
}

function buildA11ySitePromptWithFallback(data: A11ySitePromptData): string | undefined {
  return buildA11ySitePrompt(data)
    ?? buildA11ySitePrompt({
      ...data,
      findings: data.findings.map(({ sharedComponent: _sharedComponent, ...finding }) => finding),
      ...(data.lowerImpactFindings
        ? { lowerImpactFindings: data.lowerImpactFindings.map(({ sharedComponent: _sharedComponent, ...finding }) => finding) }
        : {}),
    });
}

/** Builds the canonical, cross-page accessibility remediation prompt from report views. */
export function buildCanonicalA11ySitePrompt(input: BuildCanonicalA11ySitePromptInput): string | undefined {
  const { views, worstView, siteUrl, promptContext } = input;
  const promptViews = aggregateA11yPromptViews(views, siteUrl);
  const promptFamilySummary = summarizeA11yRuleFamilies(promptViews.map((view) => view.scan));
  const promptWorst = worstView
    ? promptViews.find((view) => canonicalA11yPageUrl(siteUrl, view) === canonicalA11yPageUrl(siteUrl, worstView))
    : undefined;
  const promptWorstFamilyCount = promptWorst
    ? summarizeA11yRuleFamilies([promptWorst.scan]).headlineCount
    : 0;
  const findings = a11yFamilyPromptFindings(
    promptViews,
    promptFamilySummary.countedFamilies,
    siteUrl,
    true,
  );
  const lowerImpactFindings = promptFamilySummary.notCountedExtras.length > 0
    ? a11yFamilyPromptFindings(
      promptViews,
      promptFamilySummary.notCountedExtras,
      siteUrl,
      false,
    )
    : undefined;
  const data: A11ySitePromptData | undefined = promptWorst && promptWorstFamilyCount > 0
    ? {
      url: siteUrl,
      host: promptContext.host,
      date: promptContext.date,
      pageCount: promptViews.length,
      highImpactCount: promptFamilySummary.occurrenceCount,
      worstPage: { url: a11yPageUrl(siteUrl, promptWorst), highImpactCount: promptWorstFamilyCount },
      pageUrls: promptViews.map((view) => a11yPageUrl(siteUrl, view)),
      findings,
      ...(lowerImpactFindings ? { lowerImpactFindings } : {}),
      ...(promptFamilySummary.smallerNotesCount > 0 ? { smallerNotesCount: promptFamilySummary.smallerNotesCount } : {}),
    }
    : undefined;
  return data ? buildA11ySitePromptWithFallback(data) : undefined;
}
