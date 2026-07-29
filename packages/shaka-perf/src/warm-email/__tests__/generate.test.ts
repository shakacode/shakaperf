/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { buildPrompt } from '../generate';
import type { SiteScorecard, PagePerf } from '../synthesis';

function page(path: string, lcpMs: number, score: number): PagePerf {
  return {
    id: path,
    name: path,
    startingPath: path,
    chips: [],
    metrics: {
      LCP: { value: lcpMs, display: `${(lcpMs / 1000).toFixed(1)}s` },
      'LH Score': { value: score, display: String(score) },
    },
  };
}

function scorecard(overrides: Partial<SiteScorecard> = {}): SiteScorecard {
  const pages = [page('/', 9100, 42), page('/about', 5200, 61)];
  return {
    url: 'https://example.com',
    generatedAt: '2026-06-09',
    pageCount: pages.length,
    pages,
    slowestByLcp: pages[0],
    heaviestByDownload: undefined,
    worstByScore: pages[0],
    lcpMs: { min: 5200, max: 9100, avg: 7150 },
    score: { min: 42, max: 61, avg: 51.5 },
    brokenCount: 0,
    ...overrides,
  };
}

describe('buildPrompt (warm)', () => {
  it('demands normal sentence capitalization, never the whole email in lowercase', () => {
    const prompt = buildPrompt(scorecard(), 'notes');
    expect(prompt).toContain('normal sentence capitalization');
    expect(prompt).toContain('never write the');
  });

  it('no longer asks for a lowercase voice or a lowercase subject', () => {
    const prompt = buildPrompt(scorecard(), 'notes');
    expect(prompt).not.toContain('lowercase-leaning');
    expect(prompt).not.toContain('SUBJECT LINE: lowercase');
  });

  it('contains no em- or en-dashes itself', () => {
    const prompt = buildPrompt(scorecard(), 'notes');
    expect(prompt).not.toMatch(/[–—]/);
  });

  it('signs off with a name/title placeholder, not a hardcoded person', () => {
    const prompt = buildPrompt(scorecard(), 'notes');
    expect(prompt).toContain('<YOUR NAME> | <YOUR TITLE> | ShakaCode');
    expect(prompt).toContain('141 Makahiki Street, Paia, HI 96779');
    expect(prompt).not.toContain('Sasha Kharitonov');
  });

  it('shares the report as a hosted link placeholder, not an attachment', () => {
    const prompt = buildPrompt(scorecard(), 'notes');
    expect(prompt).toContain('## LINK');
    expect(prompt).toContain('https://<CLIENT>.shakaperf.com');
    expect(prompt).not.toContain('## ATTACH');
  });
});
