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
          'touch targets too small to tap reliably - all 1 page',
          'WCAG - passes at zero critical barriers',
        ],
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

    expect(result.a11yCost?.strongPageGroup).toEqual({
      label: 'Strong pages',
      pages: [{ name: 'Looks fine', score: 98 }, { name: 'Also looks fine', score: 70 }],
    });
  });

  it('groups clean score-bearing pages even when no a11y cost block was otherwise needed', () => {
    const prepared = prepareA11ySection([
      view('minor', { name: 'Homepage', score: 98, noViolations: true }),
      view('minor', { name: 'Contact', score: 94, noViolations: true }),
    ]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCost).toMatchObject({ tab: 'a11y', state: 'zero' });
    expect(result.a11yCost?.strongPageGroup).toEqual({
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

    expect(result.a11yCost?.strongPageGroup).toBeUndefined();
  });

  it('uses the blocked state when every supplied scan is bot-protected', () => {
    const prepared = prepareA11ySection([view('serious', { blocked: true })]);
    const result = buildA11ySection(prepared, [], 'https://example.com', promptCtx);

    expect(result.a11yCouldNotMeasure).toBe(true);
    expect(result.a11yCost).toEqual({ tab: 'a11y', state: 'blocked', headline: '' });
  });
});
