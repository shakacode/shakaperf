/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  contentCoverage,
  scoreAccess,
  scoreBucket,
  scorePage,
  scorePageStructure,
  scoreSemantics,
  scoreSite,
  scoreSiteAccess,
  scoreSsr,
  scoreStructure,
  type SiteAccessSignals,
} from '../agent-ready-score';
import { parseRobots } from '../agent-ready-site';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';

function signals(over: Partial<PageSignals> = {}): PageSignals {
  return {
    title: 'A title',
    titlePresent: true,
    metaDescription: 'A description',
    metaDescriptionPresent: true,
    canonical: true,
    lang: 'en',
    robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 5, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 10, nondescriptive: 0 },
    images: { total: 4, withAlt: 4 },
    textChars: 2000,
    textWords: 400,
    ...over,
  };
}

function result(over: Partial<AgentReadinessResult> = {}, rawOver?: Partial<PageSignals> | null, renderedOver?: Partial<PageSignals>): AgentReadinessResult {
  const rendered = signals(renderedOver);
  const rawSignals = rawOver === null ? null : signals({ ...rawOver });
  return {
    url: 'https://example.com/',
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 412, height: 823, formFactor: 'mobile', deviceScaleFactor: 1.75 } as AgentReadinessResult['viewport'],
    fetchedAt: '2026-06-23T00:00:00.000Z',
    raw: { ok: rawSignals !== null, status: 200, likelyBlocked: false, signals: rawSignals },
    rendered,
    ...over,
  };
}

const openAccess: SiteAccessSignals = {
  robots: { fetched: true, blocksAiBots: [], blocksAll: false },
  sitemap: true,
  llmsTxt: false,
};

describe('scoreBucket', () => {
  it('maps >=80 good, 50-79 fair, <50 poor', () => {
    expect(scoreBucket(80)).toBe('good');
    expect(scoreBucket(100)).toBe('good');
    expect(scoreBucket(79)).toBe('fair');
    expect(scoreBucket(50)).toBe('fair');
    expect(scoreBucket(49)).toBe('poor');
    expect(scoreBucket(0)).toBe('poor');
  });
});

describe('contentCoverage', () => {
  it('is the raw/rendered word ratio', () => {
    expect(contentCoverage(signals({ textWords: 100 }), signals({ textWords: 400 }))).toBeCloseTo(0.25);
  });
  it('is 0 when the raw fetch failed (null) on a content page', () => {
    expect(contentCoverage(null, signals({ textWords: 400 }))).toBe(0);
  });
  it('does not penalize a genuinely text-light rendered page', () => {
    expect(contentCoverage(null, signals({ textWords: 5 }))).toBe(1);
  });
  it('caps at 1 even if raw has more text than rendered', () => {
    expect(contentCoverage(signals({ textWords: 800 }), signals({ textWords: 400 }))).toBe(1);
  });
});

describe('scoreSsr', () => {
  it('rewards a fully server-rendered page', () => {
    const c = scoreSsr(result({}, {}, {}));
    expect(c.points).toBe(c.max); // 35/35
    expect(c.items.every((i) => i.state === 'pass')).toBe(true);
  });

  it('zeroes the category when the raw fetch is bot-blocked', () => {
    const r = result({ raw: { ok: false, status: 403, likelyBlocked: true, signals: null } });
    const c = scoreSsr(r);
    expect(c.points).toBe(0);
    expect(c.items[0].detail).toMatch(/bot-block|challenge/i);
  });

  it('shows no false SSR fixes when the raw fetch is blocked (a Cloudflare-fronted SSR site)', () => {
    const r = result({ raw: { ok: false, status: 403, likelyBlocked: true, signals: null } });
    const c = scoreSsr(r);
    // the key-check items are "not determinable" (na), not "fail" with wrong server-render actions
    const keyItems = c.items.filter((i) => i.label !== 'Content before JavaScript');
    expect(keyItems.length).toBeGreaterThan(0);
    expect(keyItems.every((i) => i.state === 'na')).toBe(true);
    expect(keyItems.every((i) => i.action === undefined)).toBe(true);
  });

  it('penalizes a client-rendered shell (content only after JS)', () => {
    // Raw HTML has a title but almost no text or structured data; rendered is full.
    const raw = { textWords: 5, structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 }, metaDescriptionPresent: false };
    const c = scoreSsr(result({}, raw, { textWords: 400 }));
    expect(c.points).toBeLessThan(c.max * 0.4);
  });
});

describe('scoreAccess', () => {
  it('strong marks when nothing is blocked and a sitemap exists', () => {
    const c = scoreAccess(openAccess, signals());
    // 16 (answer crawlers) + 5 (sitemap) + 0 (no llms) + 2 (indexable) = 23 of 25
    expect(c.points).toBe(23);
  });

  // A realistic "blocks every crawler" robots.txt: parseRobots reports every AI
  // bot as effectively blocked (the wildcard governs each one).
  const ALL_CITATION = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot'];

  it('drops crawler-access points when robots blocks every AI answer crawler', () => {
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: ALL_CITATION, blocksAll: true }, sitemap: false, llmsTxt: false }, signals());
    expect(c.items[0].points).toBe(0);
    expect(c.items[0].state).toBe('fail');
  });

  it('does NOT treat the site as fully blocked when a citation bot is explicitly allowed (Allow:/ overriding *)', () => {
    // robots.txt: `* Disallow: /` + `OAI-SearchBot Allow: /` -> OAI is not in
    // blocksAiBots, so the site is not "blocks every crawler" - it is partial.
    const someAllowed = ALL_CITATION.filter((b) => b !== 'OAI-SearchBot');
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: someAllowed, blocksAll: true }, sitemap: true, llmsTxt: false }, signals());
    expect(c.items[0].state).toBe('partial');
    expect(c.items[0].points).toBeGreaterThan(0);
    expect(c.items[0].points).toBeLessThan(16);
  });

  it('partially penalizes blocking AI ANSWER (citation) bots', () => {
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: ['OAI-SearchBot', 'PerplexityBot'], blocksAll: false }, sitemap: true, llmsTxt: true }, signals());
    expect(c.items[0].state).toBe('partial');
    expect(c.items[0].detail).toMatch(/OAI-SearchBot/);
  });

  it('does NOT penalize blocking training-only crawlers (GPTBot/CCBot)', () => {
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: ['GPTBot', 'CCBot'], blocksAll: false }, sitemap: true, llmsTxt: false }, signals());
    const answer = c.items.find((i) => i.label === 'AI answer crawlers allowed')!;
    expect(answer.points).toBe(16); // full - training-only blocks cost nothing
    expect(answer.state).toBe('pass');
    const note = c.items.find((i) => i.label === 'AI training crawlers blocked')!;
    expect(note.state).toBe('na');
    expect(note.max).toBe(0);
    expect(note.detail).toMatch(/GPTBot/);
  });

  it('does NOT penalize blocking Google-Extended (training/grounding, not a citation bot)', () => {
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: ['Google-Extended'], blocksAll: false }, sitemap: true, llmsTxt: false }, signals());
    const answer = c.items.find((i) => i.label === 'AI answer crawlers allowed')!;
    expect(answer.points).toBe(16);
    expect(answer.state).toBe('pass');
  });

  it('gives a fixable finding an imperative action for the fallback "what to change" list', () => {
    const c = scoreAccess({ robots: { fetched: true, blocksAiBots: [], blocksAll: false }, sitemap: false, llmsTxt: false }, signals());
    const sitemap = c.items.find((i) => i.label === 'Sitemap')!;
    expect(sitemap.action).toMatch(/sitemap/i);
  });

  it('docks the page-level noindex', () => {
    const c = scoreAccess(openAccess, signals({ robotsMeta: 'noindex, nofollow' }));
    const indexable = c.items.find((i) => i.label === 'Page is indexable')!;
    expect(indexable.points).toBe(0);
    expect(indexable.state).toBe('fail');
  });

  it('treats no robots.txt as open access (default-open)', () => {
    const c = scoreAccess({ robots: { fetched: false, blocksAiBots: [], blocksAll: false }, sitemap: false, llmsTxt: false }, signals());
    expect(c.items[0].points).toBe(16);
  });
});

describe('scoreStructure', () => {
  it('full marks with structured data + meta + OG', () => {
    const c = scoreStructure(signals());
    expect(c.points).toBe(c.max);
  });
  it('loses the structured-data points when JSON-LD is absent', () => {
    const c = scoreStructure(signals({ structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 } }));
    const sd = c.items.find((i) => i.label === 'Structured data')!;
    expect(sd.points).toBe(0);
  });
});

describe('scoreSemantics', () => {
  it('full marks on a clean semantic page', () => {
    const c = scoreSemantics(signals());
    expect(c.points).toBe(c.max);
  });
  it('marks image alt N/A when there are no images', () => {
    const c = scoreSemantics(signals({ images: { total: 0, withAlt: 0 } }));
    const alt = c.items.find((i) => i.label === 'Image alt text')!;
    expect(alt.state).toBe('na');
    expect(alt.points).toBe(2); // not penalized for having no images (full sub-weight)
  });
  it('flags multiple h1s', () => {
    const c = scoreSemantics(signals({ headings: { h1Count: 3, total: 5, orderOk: true } }));
    const h1 = c.items.find((i) => i.label === 'Single main heading')!;
    expect(h1.points).toBe(0);
    expect(h1.state).toBe('partial');
  });
});

describe('scorePage', () => {
  it('a fully SSR, well-structured, accessible page scores high', () => {
    const s = scorePage(result(), openAccess);
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.bucket).toBe('good');
    expect(s.categories).toHaveLength(4);
  });

  it('a client-rendered SPA with no structured data scores poorly', () => {
    const raw = { textWords: 3, titlePresent: false, metaDescriptionPresent: false, structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 } };
    const rendered = { structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 }, metaDescriptionPresent: false, canonical: false, og: { title: false, description: false, image: false, type: false, siteName: false }, landmarks: { main: false, nav: false, header: false, footer: false, article: false } };
    const s = scorePage(result({}, raw, rendered), { robots: { fetched: false, blocksAiBots: [], blocksAll: false }, sitemap: false, llmsTxt: false });
    expect(s.score).toBeLessThan(50);
    expect(s.bucket).toBe('poor');
    expect(s.rawReachable).toBe(true);
  });

  it('never exceeds 100 or drops below 0', () => {
    const s = scorePage(result(), openAccess);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.score).toBeGreaterThanOrEqual(0);
  });
});

describe('scorePageStructure (SSR gating)', () => {
  it('caps a near-empty raw shell at "poor" even with perfect structure', () => {
    // Rendered page is flawless, but only ~1% of its text is in the raw HTML.
    const raw = { textWords: 4 };
    const s = scorePageStructure(result({}, raw, { textWords: 400 }));
    expect(s.coverage).toBeLessThan(0.2);
    expect(s.shellCapped).toBe(true);
    expect(s.score).toBe(49);
    expect(s.uncappedScore).toBeGreaterThan(49); // structure/semantics were strong
    expect(s.bucket).toBe('poor');
  });

  it('does not cap a server-rendered page', () => {
    const s = scorePageStructure(result());
    expect(s.shellCapped).toBe(false);
    expect(s.score).toBe(s.uncappedScore);
    expect(s.score).toBeGreaterThanOrEqual(95);
  });

  it('flags an unreadable raw fetch without inventing a number', () => {
    const s = scorePageStructure(result({ raw: { ok: false, status: 403, likelyBlocked: true, signals: null } }));
    expect(s.rawUnreadable).toBe(true);
    expect(s.rawReachable).toBe(false);
  });
});

describe('scoreSiteAccess', () => {
  it('scales the access category to /100', () => {
    const a = scoreSiteAccess(openAccess, signals());
    expect(a.score).toBe(Math.round((23 / 25) * 100)); // 92
    expect(a.bucket).toBe('good');
  });
});

describe('scoreSite', () => {
  it('uses the rounded average of per-page structure scores as the headline', () => {
    const pages = [result(), result({}, { textWords: 200 }, { textWords: 400 })];
    const perPage = pages.map((page) => scorePageStructure(page));
    const s = scoreSite(pages, openAccess);

    expect(s.overall).toBe(Math.round(perPage.reduce((sum, page) => sum + page.score, 0) / perPage.length));
    expect(s.overall).toBe(s.structureAvg);
    expect(s.bucket).toBe('good');
    expect(s.shellCapped).toBe(false);
  });

  it('keeps the headline independent from the separate crawler-access score', () => {
    const pages = [result(), result({}, { textWords: 200 }, { textWords: 400 })];
    const open = scoreSite(pages, openAccess);
    const limitedAccess = scoreSite(pages, {
      robots: { fetched: true, blocksAiBots: [], blocksAll: false },
      sitemap: false,
      llmsTxt: false,
    });

    expect(open.access.score).not.toBe(limitedAccess.access.score);
    expect(open.overall).toBe(limitedAccess.overall);
  });

  it('caps the site when most pages are client-rendered shells', () => {
    const shell = result({}, { textWords: 3 }, { textWords: 400 });
    const s = scoreSite([shell, shell], openAccess);
    expect(s.shellCapped).toBe(true);
    expect(s.overall).toBe(49);
  });

  it('reports allRawUnreadable when every raw fetch failed', () => {
    const blocked = result({ raw: { ok: false, likelyBlocked: true, signals: null } });
    const s = scoreSite([blocked], openAccess);
    expect(s.allRawUnreadable).toBe(true);
  });

  it('caps the site to poor when robots.txt blocks every crawler, even with strong pages', () => {
    const allCitation = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot'];
    const blockedSite: SiteAccessSignals = { robots: { fetched: true, blocksAiBots: allCitation, blocksAll: true }, sitemap: true, llmsTxt: false };
    const s = scoreSite([result(), result()], blockedSite);
    expect(s.accessBlocked).toBe(true);
    expect(s.overall).toBe(49);
    expect(s.bucket).toBe('poor');
  });

  it('does NOT cap the site when a citation bot is explicitly allowed despite a wildcard block', () => {
    // `* Disallow: /` + `OAI-SearchBot Allow: /`: AI answers can still cite via OAI.
    const someBlocked = ['ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot'];
    const site: SiteAccessSignals = { robots: { fetched: true, blocksAiBots: someBlocked, blocksAll: true }, sitemap: true, llmsTxt: false };
    const s = scoreSite([result()], site);
    expect(s.accessBlocked).toBe(false);
    expect(s.overall).toBeGreaterThan(49);
  });

  it('reflects a noindex on ANY page in the site-level access section (not just page 0)', () => {
    const clean = result({}, {}, { robotsMeta: '' }); // page 0 indexable
    const noidx = result({}, {}, { robotsMeta: 'noindex' }); // a later page noindex
    const s = scoreSite([clean, noidx], openAccess);
    const indexable = s.access.category.items.find((i) => i.label === 'Page is indexable')!;
    expect(indexable.points).toBe(0);
    expect(indexable.detail).toMatch(/at least one/i);
  });
});

describe('parseRobots', () => {
  it('detects a global block (User-agent: * / Disallow: /)', () => {
    const r = parseRobots('User-agent: *\nDisallow: /');
    expect(r.blocksAll).toBe(true);
  });

  it('detects specific AI-bot blocks', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow:';
    const r = parseRobots(txt);
    expect(r.blocksAiBots).toEqual(expect.arrayContaining(['GPTBot', 'CCBot']));
    expect(r.blocksAll).toBe(false);
  });

  it('an Allow: / override lifts a Disallow: /', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\nAllow: /');
    expect(r.blocksAll).toBe(false);
  });

  it('a specific AI bot Allow:/ group overrides a wildcard Disallow:/ (bot not effectively blocked)', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /');
    expect(r.blocksAll).toBe(true);
    const low = r.blocksAiBots.map((b) => b.toLowerCase());
    expect(low).not.toContain('oai-searchbot'); // its own Allow group wins
    expect(low).toContain('perplexitybot'); // no own group -> governed by the wildcard block
  });

  it('groups consecutive user-agents with the shared rules', () => {
    const r = parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /');
    expect(r.blocksAiBots).toEqual(expect.arrayContaining(['GPTBot', 'ClaudeBot']));
  });

  it('does not flag a bot that is only partially path-disallowed', () => {
    const r = parseRobots('User-agent: GPTBot\nDisallow: /private/');
    expect(r.blocksAiBots).toEqual([]);
  });

  it('reads a Sitemap declaration', () => {
    const r = parseRobots('Sitemap: https://example.com/sitemap.xml\nUser-agent: *\nDisallow:');
    expect(r.sitemapDeclared).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    const r = parseRobots('# comment\n\nUser-agent: *   # all\nDisallow: /  # everything');
    expect(r.blocksAll).toBe(true);
  });
});
