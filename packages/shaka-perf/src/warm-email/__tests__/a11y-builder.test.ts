/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildA11ySection,
  prepareA11ySection,
  type A11ySectionView,
} from '../client-report-model/a11y';
import type { AccessibilityScan, AccessibilityViolation } from '../../audit/stages/accessibility/types';
import type { PagePerf } from '../synthesis';

function view(
  impact: AccessibilityViolation['impact'],
  options: { blocked?: boolean; ruleId?: string; score?: number; name?: string; noViolations?: boolean } = {},
): A11ySectionView {
  const page: PagePerf = {
    id: 'home', name: options.name ?? 'Home', startingPath: '/', chips: [], metrics: {},
  };
  const scan: AccessibilityScan = {
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 } as AccessibilityScan['viewport'],
    url: 'https://example.com/',
    violations: options.noViolations ? [] : [{
      ruleId: options.ruleId ?? 'target-size',
      impact,
      help: 'fixture',
      helpUrl: '',
      tags: [],
      nodes: [{ target: ['.fixture'], html: '<button>Fixture</button>', failureSummary: '' }],
    }],
    ...(options.blocked ? { blocked: true } : {}),
  };
  return {
    page,
    scan,
    counts: {
      critical: impact === 'critical' ? 1 : 0,
      serious: impact === 'serious' ? 1 : 0,
      moderate: impact === 'moderate' ? 1 : 0,
      minor: impact === 'minor' ? 1 : 0,
    },
    ...(options.score === undefined ? {} : { client: { score: options.score } }),
  };
}

function promptView(
  id: string,
  name: string,
  startingPath: string,
  violations: AccessibilityViolation[],
): A11ySectionView {
  return {
    page: { id, name, startingPath, chips: [], metrics: {} },
    scan: {
      viewportLabel: 'phone',
      viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 } as AccessibilityScan['viewport'],
      url: `https://example.com${startingPath}`,
      violations,
    },
    counts: violations.reduce((counts, violation) => ({
      ...counts,
      ...(violation.impact ? { [violation.impact]: counts[violation.impact] + 1 } : {}),
    }), { critical: 0, serious: 0, moderate: 0, minor: 0 }),
  };
}

function promptViolation(ruleId: string, impact: AccessibilityViolation['impact']): AccessibilityViolation {
  return {
    ruleId,
    impact,
    help: 'fixture',
    helpUrl: '',
    tags: [],
    nodes: [{ target: ['.fixture'], html: '<button>Fixture</button>', failureSummary: '' }],
  };
}

const promptCtx = { host: 'example.com', date: 'July 10, 2026' };

describe('buildA11ySection', () => {
  it('builds a measured barrier cost block from hand-built scans', () => {
    const prepared = prepareA11ySection([view('serious')]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result).toMatchObject({
      a11yStatus: 'fair',
      highImpactTotal: 1,
      a11yCost: {
        state: 'measured',
        headline: '1 high-impact barrier keeps some visitors from using the site.',
        gapSubLines: [
          'worst page: Home - 1 high-impact',
          'touch targets too small to tap reliably - 1 defect on all 1 page',
          'WCAG - passes at zero critical barriers',
        ],
      },
    });
  });

  it('names multiple shared components after the distinct-defect headline', () => {
    const prepared = prepareA11ySection([
      promptView('home', 'Home', '/', [promptViolation('target-size', 'serious'), promptViolation('image-alt', 'serious')]),
      promptView('about', 'About', '/about', [promptViolation('target-size', 'serious'), promptViolation('image-alt', 'serious')]),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result).toMatchObject({
      highImpactTotal: 2,
      a11yCost: {
        headline: '2 high-impact barriers keep some visitors from using the site.',
        headlineSub: 'The bar for any website is zero barriers that block someone. We found 2 across your 2 pages. All 2 repeat across multiple pages via shared components.',
      },
    });
  });

  it('keeps optional contrast data absent when the scan has no contrast finding', () => {
    const prepared = prepareA11ySection([view('serious')]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCost?.gap).toBeUndefined();
  });

  it('uses the no-material-loss state for only lower-impact findings', () => {
    const prepared = prepareA11ySection([view('moderate', { ruleId: 'color-contrast' })]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCost).toMatchObject({ tab: 'a11y', state: 'zero' });
    expect(result.a11yStatus).toBe('good');
  });

  it('groups every score-bearing fine page even when another page has a high-impact finding', () => {
    const prepared = prepareA11ySection([
      view('serious', { name: 'Needs attention', score: 62 }),
      view('moderate', { name: 'Looks fine', score: 98 }),
      view('minor', { name: 'Also looks fine', score: 70 }),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yStrongPageGroup).toEqual({
      label: 'Strong pages',
      pages: [{ name: 'Looks fine', score: 98 }, { name: 'Also looks fine', score: 70 }],
    });
  });

  it('keeps a poor lower-impact page out of the strong-page group', () => {
    const prepared = prepareA11ySection([
      view('serious', { name: 'Needs attention', score: 62 }),
      view('minor', { name: 'Poor lower-impact page', score: 49 }),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yStrongPageGroup).toBeUndefined();
    expect(result.a11yFine).toEqual([
      expect.objectContaining({ name: 'Poor lower-impact page', score: 49, status: 'poor' }),
    ]);
  });

  it('groups clean score-bearing pages even when no a11y cost block was otherwise needed', () => {
    const prepared = prepareA11ySection([
      view('minor', { name: 'Homepage', score: 98, noViolations: true }),
      view('minor', { name: 'Contact', score: 94, noViolations: true }),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCost).toBeUndefined();
    expect(result.a11yStrongPageGroup).toEqual({
      label: 'Strong pages',
      pages: [{ name: 'Homepage', score: 98 }, { name: 'Contact', score: 94 }],
    });
  });

  it('leaves grouping absent when a fine page has no score', () => {
    const prepared = prepareA11ySection([
      view('serious', { name: 'Needs attention', score: 62 }),
      view('moderate', { name: 'Scored fine page', score: 98 }),
      view('minor', { name: 'Unscored fine page' }),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yStrongPageGroup).toBeUndefined();
  });

  it('uses the blocked state when every supplied scan is bot-protected', () => {
    const prepared = prepareA11ySection([view('serious', { blocked: true })]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCouldNotMeasure).toBe(true);
    expect(result.a11yCost).toEqual({ tab: 'a11y', state: 'blocked', headline: '' });
  });

  it('keeps report scenarios distinct while the site prompt aggregates their canonical page', () => {
    const prepared = prepareA11ySection([
      promptView('home-top', 'Home top', '/#top', [promptViolation('target-size', 'serious')]),
      promptView('home-footer', 'Home footer', '/#footer', [promptViolation('image-alt', 'critical')]),
      promptView('about', 'About', '/about', [promptViolation('target-size', 'serious')]),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);
    const prompt = result.a11yCost?.sitePrompts?.a11y;

    expect(result.cardedA11y).toHaveLength(3);
    expect(result.a11yCost?.headlineSub).toContain('across your 3 pages');
    expect(prompt).toContain("2 high-impact issues across the site's 2 pages");
    expect(prompt).toContain('worst page: the homepage with 2');
  });
});
