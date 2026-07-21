/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { buildAgentUnderstanding } from '../client-report-model/agent-understanding';
import { scorePageStructure } from '../agent-ready-score';
import type { AgentPageView } from '../agent-ready-report';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';
import type { PagePerf } from '../synthesis';

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    title: 'Example page', titlePresent: true,
    metaDescription: 'Example description', metaDescriptionPresent: true,
    canonical: true, lang: 'en', robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['Organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 3, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 10, nondescriptive: 0 },
    images: { total: 10, withAlt: 10 },
    textChars: 1800, textWords: 300,
    ...overrides,
  };
}

function view(
  name: string,
  renderedOverrides: Partial<PageSignals> = {},
  rawOverrides: Partial<PageSignals> | null = renderedOverrides,
): AgentPageView {
  const rendered = signals(renderedOverrides);
  const raw = rawOverrides === null ? null : signals(rawOverrides);
  const page: PagePerf = { id: name.toLowerCase().replaceAll(' ', '-'), name, startingPath: `/${name.toLowerCase().replaceAll(' ', '-')}`, chips: [], metrics: {} };
  const result: AgentReadinessResult = {
    url: `https://example.com${page.startingPath}`,
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 } as AgentReadinessResult['viewport'],
    fetchedAt: '2026-07-21T00:00:00.000Z',
    raw: { ok: raw !== null, status: raw === null ? 500 : 200, likelyBlocked: false, signals: raw },
    rendered,
    rawHtmlBytes: raw === null ? 0 : 1000,
    renderedHtmlBytes: 5000,
  };
  return { page, result, struct: scorePageStructure(result) };
}

const sharedLabelingGaps: Partial<PageSignals> = {
  metaDescription: '',
  metaDescriptionPresent: false,
  og: { title: false, description: false, image: false, type: false, siteName: false },
  structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 },
};

describe('buildAgentUnderstanding', () => {
  it('deduplicates shared gaps, reports their page coverage, and sorts by total lost points', () => {
    const result = buildAgentUnderstanding([
      view('Home', sharedLabelingGaps),
      view('Services', sharedLabelingGaps),
      view('Contact', sharedLabelingGaps),
    ]);

    expect(result.status).toBe('fair');
    expect(result.items[0]).toMatchObject({
      label: 'Structured data',
      coverage: 'on all 3 pages',
      detail: 'No schema.org structured data, so machines must infer what the page is about.',
      action: 'Add schema.org structured data (Organization, Product, Article, and so on) so machines can identify the page.',
    });
    expect(result.items.filter((item) => item.label === 'Structured data')).toHaveLength(1);
    expect(result.items.map((item) => item.label)).toEqual(expect.arrayContaining([
      'Structured data before JavaScript',
      'Meta description',
      'Social preview tags',
    ]));
  });

  it('uses the worst measured partial result without inventing an average', () => {
    const result = buildAgentUnderstanding([
      view('Home', { ...sharedLabelingGaps, images: { total: 10, withAlt: 6 } }),
      view('Media & PR', { ...sharedLabelingGaps, images: { total: 10, withAlt: 8 } }),
      view('Contact', { ...sharedLabelingGaps, images: { total: 10, withAlt: 7 } }),
    ]);
    const altText = result.items.find((item) => item.label === 'Image alt text');

    expect(altText).toMatchObject({
      status: 'partial',
      coverage: 'on all 3 pages',
      action: 'Add descriptive alt text to the images that lack it.',
    });
    expect(altText?.detail).toBe('Lowest coverage: 6 of 10 images have alt text describing them. on Home.');
  });

  it('keeps page-only gaps separate and excludes text-reachability checks', () => {
    const result = buildAgentUnderstanding([
      view('Home', sharedLabelingGaps, { ...sharedLabelingGaps, textWords: 0 }),
      view('Media & PR', {
        ...sharedLabelingGaps,
        headings: { h1Count: 2, total: 4, orderOk: false },
      }),
    ]);

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Single main heading', coverage: 'Media & PR only' }),
      expect.objectContaining({ label: 'Heading order', coverage: 'Media & PR only' }),
    ]));
    expect(result.items.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      'Content before JavaScript',
      'Title before JavaScript',
      'Main text before JavaScript',
    ]));
  });

  it('keeps understanding green when only server-rendered text is missing', () => {
    const result = buildAgentUnderstanding([view('Home', {}, { textWords: 0 })]);

    expect(result).toEqual({
      status: 'good',
      verdict: 'Labeling is in place.',
      items: [],
    });
  });

  it('does not let missing server-rendered text worsen the labeling verdict', () => {
    const result = buildAgentUnderstanding([
      view('Home', sharedLabelingGaps, { ...sharedLabelingGaps, textWords: 0 }),
    ]);

    expect(result.status).toBe('fair');
    expect(result.verdict).toBe('Only partly - the labels machines rely on are missing.');
    expect(result.items.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      'Content before JavaScript',
      'Title before JavaScript',
      'Main text before JavaScript',
    ]));
  });

  it('keeps the action paired with the displayed worst-case detail', () => {
    const result = buildAgentUnderstanding([
      view('Services', sharedLabelingGaps),
      view('Home', {
        ...sharedLabelingGaps,
        structuredData: { blocks: 1, valid: 0, invalid: 1, types: [], microdataItems: 0 },
      }),
    ]);
    const structuredData = result.items.find((item) => item.label === 'Structured data');

    expect(structuredData).toMatchObject({
      detail: '1 structured-data block on the page could not be parsed, so a machine cannot read it.',
      action: 'Fix the broken structured-data block so a machine can parse it.',
    });
  });

  it('returns a green one-line verdict for good-bucket pages', () => {
    const result = buildAgentUnderstanding([view('Home')]);

    expect(result).toEqual({
      status: 'good',
      verdict: 'Labeling is in place.',
      items: [],
    });
  });
});
