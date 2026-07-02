/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseA11yResponse, buildA11yPrompt } from '../a11y-summary-ai';
import type { A11ySummaryRequest } from '../client-report';

function req(name = 'Home', path = '/'): A11ySummaryRequest {
  return {
    pageName: name,
    path,
    score: 84,
    counts: { critical: 1, serious: 2, moderate: 0, minor: 1 },
    issues: [{ impact: 'critical', help: 'Buttons must have a label', places: 3 }],
  };
}

describe('parseA11yResponse', () => {
  const ok = (pages: unknown[], site = 'Site is mostly usable.') =>
    JSON.stringify({ pages, site });

  it('returns per-page summaries aligned to the page count plus the site summary', () => {
    const raw = ok([
      { summary: 'Some buttons have no label', fixes: ['Add labels'] },
      { summary: 'Text is hard to read', fixes: ['Darken the grey text', 'Increase size'] },
    ]);
    const out = parseA11yResponse(raw, 2);
    expect(out).toEqual({
      pages: [
        { summary: 'Some buttons have no label', fixes: ['Add labels'] },
        { summary: 'Text is hard to read', fixes: ['Darken the grey text', 'Increase size'] },
      ],
      site: 'Site is mostly usable.',
    });
  });

  it('strips a ```json code fence', () => {
    const raw = '```json\n' + ok([{ summary: 'x', fixes: ['y'] }]) + '\n```';
    expect(parseA11yResponse(raw, 1)?.pages[0]).toEqual({ summary: 'x', fixes: ['y'] });
  });

  it('recovers JSON when the model adds a note after the object', () => {
    const raw = ok([{ summary: 'x', fixes: ['y'] }]) + '\n\nHope this helps!';
    expect(parseA11yResponse(raw, 1)?.pages[0]).toEqual({ summary: 'x', fixes: ['y'] });
  });

  it('recovers JSON from a fenced block with leading prose and CRLF endings', () => {
    const raw = 'Here is the summary:\r\n```json\r\n' + ok([{ summary: 'x', fixes: ['y'] }]) + '\r\n```';
    expect(parseA11yResponse(raw, 1)?.pages[0]).toEqual({ summary: 'x', fixes: ['y'] });
  });

  it('normalizes em/en-dashes in the summary, fixes, and site text', () => {
    const raw = ok([{ summary: 'a\u2014b', fixes: ['c\u2013d'] }], 'site\u2014wide issue');
    const out = parseA11yResponse(raw, 1);
    expect(out?.pages[0]).toEqual({ summary: 'a - b', fixes: ['c - d'] });
    expect(out?.site).toBe('site - wide issue');
  });

  it('rejects the whole reply when the page count does not match', () => {
    expect(parseA11yResponse(ok([{ summary: 'x', fixes: ['y'] }]), 2)).toBeNull();
  });

  it('caps fixes at three and keeps the first three', () => {
    const raw = ok([{ summary: 'x', fixes: ['a', 'b', 'c', 'd'] }]);
    expect(parseA11yResponse(raw, 1)?.pages[0]?.fixes).toEqual(['a', 'b', 'c']);
  });

  it('drops over-long fixes but keeps the page if one usable fix remains', () => {
    const raw = ok([{ summary: 'x', fixes: ['z'.repeat(200), 'short fix'] }]);
    expect(parseA11yResponse(raw, 1)?.pages[0]?.fixes).toEqual(['short fix']);
  });

  it('nulls a page with no usable fix (fallback to raw axe text)', () => {
    const raw = ok([
      { summary: 'x', fixes: [] },
      { summary: 'ok', fixes: ['real fix'] },
    ]);
    expect(parseA11yResponse(raw, 2)?.pages).toEqual([null, { summary: 'ok', fixes: ['real fix'] }]);
  });

  it('nulls a page whose summary is empty or over-long', () => {
    const raw = ok([
      { summary: '', fixes: ['a'] },
      { summary: 'z'.repeat(300), fixes: ['a'] },
    ]);
    expect(parseA11yResponse(raw, 2)?.pages).toEqual([null, null]);
  });

  it('returns the site summary even when every page falls back', () => {
    const raw = ok([{ summary: '', fixes: [] }], 'Across the site, labels are missing.');
    expect(parseA11yResponse(raw, 1)).toEqual({ pages: [null], site: 'Across the site, labels are missing.' });
  });

  it('keeps a site summary up to the 400-char cap', () => {
    const raw = ok([{ summary: 'x', fixes: ['y'] }], 'z'.repeat(360));
    expect(parseA11yResponse(raw, 1)?.site).toBe('z'.repeat(360));
  });

  it('drops an over-long (>400) site summary to null but keeps usable pages', () => {
    const raw = ok([{ summary: 'x', fixes: ['y'] }], 'z'.repeat(401));
    expect(parseA11yResponse(raw, 1)).toEqual({ pages: [{ summary: 'x', fixes: ['y'] }], site: null });
  });

  it('returns null when nothing is usable (no pages, no site)', () => {
    expect(parseA11yResponse(ok([{ summary: '', fixes: [] }], ''), 1)).toBeNull();
  });

  it('returns null on unparseable or wrong-shape output', () => {
    expect(parseA11yResponse('not json', 1)).toBeNull();
    expect(parseA11yResponse(JSON.stringify([{ summary: 'x' }]), 1)).toBeNull(); // array, not {pages}
    expect(parseA11yResponse(JSON.stringify({ pages: 'nope' }), 1)).toBeNull();
  });
});

describe('buildA11yPrompt', () => {
  it('fences the site-derived data and forbids dashes', () => {
    const p = buildA11yPrompt([req('Home & Shop', '/shop')]);
    expect(p).toContain('"""');
    expect(p).toContain('Home & Shop');
    expect(p).toContain('no em-dashes and no en-dashes');
    expect(p).toContain('1 element(s)');
  });

  it('renders the score, counts, and issues for each page', () => {
    const p = buildA11yPrompt([req()]);
    expect(p).toContain('accessibility score 84/100');
    expect(p).toContain('1 critical, 2 serious, 0 moderate, 1 minor');
    expect(p).toContain('Buttons must have a label (3 places)');
  });
});
