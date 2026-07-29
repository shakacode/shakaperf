/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AgentReadinessResult, PageSignals } from '../audit/stages/agent_readiness/types';

// Turns the agent-readiness signals into a defensible 0-100 "Agent Ready" score
// (4 categories: SSR-reachability, crawler access, structure, semantics; weights
// + rules in ../audit/stages/agent_readiness/METHODOLOGY.md). Pure + unit-tested.
// Categories 3+4 score the page's structure as it exists in the rendered DOM;
// category 1 separately scores how much survives WITHOUT JavaScript, so a CSR page
// with great structure still loses where it matters (a non-rendering crawler)
// without being penalized twice for the same markup.

// ---- site-level access signals (fetched once at report time) ----
export interface SiteAccessSignals {
  robots: {
    fetched: boolean; // /robots.txt returned something parseable
    blocksAiBots: string[]; // major AI bot UA tokens disallowed from "/"
    blocksAll: boolean; // a `User-agent: *` `Disallow: /`
  };
  sitemap: boolean; // a sitemap is declared in robots.txt or /sitemap.xml exists
  llmsTxt: boolean; // /llms.txt exists
  llmsTxtConfirmedAbsent?: boolean; // a report-time response confirms no usable guide
}

export type Bucket = 'good' | 'fair' | 'poor';

export interface ScoreItem {
  label: string;
  points: number; // earned
  max: number; // possible
  // 'pass' | 'partial' | 'fail' drives the dot colour; 'na' means not applicable
  // (e.g. image-alt coverage on a page with no images) and is excluded from copy.
  state: 'pass' | 'partial' | 'fail' | 'na';
  detail: string; // one plain clause describing the finding
  // An imperative "what to do" line for the findings list, set only on items a
  // client can act on. The fallback "What to change" list renders this (not the
  // descriptive `detail`), so it reads as actions even without the AI rewrite.
  action?: string;
}

export interface CategoryScore {
  id: 'ssr' | 'access' | 'structure' | 'semantics';
  name: string;
  points: number; // earned across items
  max: number; // category weight
  items: ScoreItem[];
}

export interface PageAgentScore {
  score: number; // 0-100
  bucket: Bucket;
  categories: CategoryScore[];
  rawReachable: boolean; // raw fetch ok and not bot-blocked
  coverage: number; // rawWords / renderedWords, 0..1 (1 when rendered has no text)
}

// ---- category weights (sum to 100) ----
// Weighted by evidence strength (METHODOLOGY.md): reachability-without-JS is the
// strongest measurable AI-visibility factor (Vercel/MERJ study) and gates the
// score; structure + semantics help parsing but aren't proven ranking levers.
const W_SSR = 40;
const W_ACCESS = 25;
const W_STRUCTURE = 20;
const W_SEMANTICS = 15;

// Below this share of the page's text reachable without JavaScript, the raw HTML
// is a near-empty shell: a non-rendering AI crawler sees almost no content, so the
// page score is hard-capped at "poor" no matter how good the other categories are.
const SHELL_COVERAGE = 0.2;
const GATED_CAP = 49;

export const scoreBucket = (s: number): Bucket => (s >= 80 ? 'good' : s >= 50 ? 'fair' : 'poor');

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

// How much of the rendered text exists in the raw (no-JS) HTML. 1.0 when the
// rendered page itself has ~no text (nothing to miss); the SSR category then
// leans on the key-element checks instead of punishing an empty comparison.
export function contentCoverage(raw: PageSignals | null, rendered: PageSignals): number {
  // Nothing meaningful to compare when the rendered page itself is ~textless;
  // don't punish an empty comparison (the SSR key-element checks carry the load).
  if (rendered.textWords < 20) return 1;
  if (!raw) return 0;
  return clamp01(raw.textWords / rendered.textWords);
}

function item(label: string, earned: number, max: number, pass: boolean, detail: string, partial = false, action?: string): ScoreItem {
  return {
    label,
    points: round1(earned),
    max,
    state: pass ? 'pass' : partial ? 'partial' : 'fail',
    detail,
    ...(action ? { action } : {}),
  };
}

// ---- category 1: reachable without JavaScript ----
export function scoreSsr(result: AgentReadinessResult): CategoryScore {
  const raw = result.raw.signals;
  const rendered = result.rendered;
  const reachable = result.raw.ok && !result.raw.likelyBlocked && raw !== null;
  const coverage = contentCoverage(raw, rendered);
  const items: ScoreItem[] = [];

  // The dominant signal: share of the page's text present before JavaScript runs.
  // Client-facing wording avoids "raw / server HTML" cold; the INTRO establishes
  // "the page the server sends before JavaScript runs" and we reuse that here.
  const covMax = 24;
  const ssrAction = 'Server-render this page so its text is in the page the server sends, before JavaScript runs.';
  if (!reachable) {
    items.push(item(
      'Content before JavaScript',
      0,
      covMax,
      false,
      result.raw.likelyBlocked
        ? 'The server returned a bot-block or challenge page, so a crawler sees no content here.'
        : 'We could not read the page the server sends, so we cannot confirm the content is reachable without JavaScript.',
    ));
  } else {
    const covPts = covMax * coverage;
    const pctText = Math.round(coverage * 100);
    items.push(item(
      'Content before JavaScript',
      covPts,
      covMax,
      coverage >= 0.9,
      `${pctText}% of the page's text is already in the page the server sends, before any JavaScript runs.`,
      coverage >= 0.5,
      coverage >= 0.9 ? undefined : ssrAction,
    ));
  }

  // Key elements present in the no-JS page (what a non-rendering agent can read).
  const keyChecks: Array<[string, number, boolean, string, string | undefined]> = [
    ['Title before JavaScript', 4, !!raw?.titlePresent, raw?.titlePresent ? 'The page title is in the page the server sends.' : 'The page title only appears after JavaScript runs.', 'Put the page title in the HTML the server sends, before JavaScript runs.'],
    ['Description before JavaScript', 3, !!raw?.metaDescriptionPresent, raw?.metaDescriptionPresent ? 'The page description is in the page the server sends.' : 'The page description is missing before JavaScript runs.', 'Add a meta description in the HTML the server sends.'],
    ['Structured data before JavaScript', 5, !!(raw && raw.structuredData.valid > 0), raw && raw.structuredData.valid > 0 ? 'Structured data is in the page the server sends, where AI crawlers can read it.' : 'No machine-readable structured data in the page the server sends.', 'Add schema.org structured data to the HTML the server sends.'],
    ['Main text before JavaScript', 4, !!(raw && raw.textWords >= 100), raw && raw.textWords >= 100 ? 'The page the server sends already carries the main copy.' : 'The page the server sends carries little to no body text.', ssrAction],
  ];
  for (const [label, max, pass, detail, action] of keyChecks) {
    // When the server HTML could not be read (a 403 / WAF challenge to a plain
    // fetch), we have NO evidence either way - a Cloudflare-fronted but fully
    // server-rendered site must not be shown "the title only appears after
    // JavaScript runs" or four wrong "server-render this page" fixes. Emit a
    // neutral, unscored "not determinable" item instead.
    if (!reachable) {
      const na = item(label, 0, max, false, 'Not determinable - we could not read the page the server sends.');
      na.state = 'na';
      items.push(na);
      continue;
    }
    items.push(item(label, pass ? max : 0, max, pass, detail, false, pass ? undefined : action));
  }

  const points = items.reduce((s, it) => s + it.points, 0);
  return { id: 'ssr', name: 'Reachable without JavaScript', points: round1(points), max: W_SSR, items };
}

// Bots whose robots.txt block actually costs AI-answer citations (search/answer +
// user-fetch crawlers). TRAINING-only bots (GPTBot, CCBot) carry no citation cost
// and are never scored; Google-Extended is excluded too (it gates Gemini
// training, not Search/AI-Overviews citations). See METHODOLOGY.md.
const CITATION_BOTS = new Set(
  ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot'].map((b) => b.toLowerCase()),
);

// True only when EVERY AI citation bot is effectively blocked from the root (the
// wildcard blocks all AND no citation bot has an overriding Allow group). A
// `* Disallow: /` with an `OAI-SearchBot Allow: /` is NOT fully blocked.
export function citationFullyBlocked(site: SiteAccessSignals | undefined): boolean {
  if (!site || !site.robots.fetched || !site.robots.blocksAll) return false;
  const blocked = new Set(site.robots.blocksAiBots.map((b) => b.toLowerCase()));
  return [...CITATION_BOTS].every((bot) => blocked.has(bot));
}

// ---- category 2: crawler access (site-level) ----
// `siteNoindex` overrides the per-page noindex check for the SITE-level Access
// section (which is shown once for the whole site): pass true when ANY audited
// page carries a noindex, so the card does not silently reflect only page 0.
export function scoreAccess(site: SiteAccessSignals | undefined, page: PageSignals, siteNoindex?: boolean): CategoryScore {
  const items: ScoreItem[] = [];

  const blocked = site?.robots.blocksAiBots ?? [];
  const fullyBlocked = citationFullyBlocked(site);
  const citationBlocked = blocked.filter((b) => CITATION_BOTS.has(b.toLowerCase()));
  const trainingBlocked = blocked.filter((b) => !CITATION_BOTS.has(b.toLowerCase()));
  const accessMax = 16;

  // The gate that actually matters: are the AI SEARCH / answer crawlers allowed?
  if (!site || !site.robots.fetched) {
    items.push(item('AI answer crawlers allowed', accessMax, accessMax, true, 'We did not find a robots.txt block, so this check treats crawler access as open.'));
  } else if (fullyBlocked) {
    items.push(item('AI answer crawlers allowed', 0, accessMax, false, 'robots.txt blocks every crawler from the whole site, so the AI answer engines that respect it will not read these pages.', false, 'Update robots.txt to stop blocking crawlers across the whole site.'));
  } else if (citationBlocked.length > 0) {
    items.push(item('AI answer crawlers allowed', accessMax * 0.25, accessMax, false, `robots.txt blocks ${citationBlocked.length} AI answer crawler${citationBlocked.length === 1 ? '' : 's'} (${citationBlocked.slice(0, 4).join(', ')}), which reduces how often AI answers can cite you.`, true, `Allow these crawlers in robots.txt: ${citationBlocked.slice(0, 4).join(', ')}.`));
  } else {
    items.push(item('AI answer crawlers allowed', accessMax, accessMax, true, 'robots.txt does not block the AI answer crawlers (the ones that cite sources).'));
  }
  // Blocking a training-only crawler is reported neutrally and never scored.
  if (trainingBlocked.length > 0) {
    const i = item('AI training crawlers blocked', 0, 0, true, `robots.txt blocks ${trainingBlocked.length} training-only crawler${trainingBlocked.length === 1 ? '' : 's'} (${trainingBlocked.slice(0, 4).join(', ')}). This is a deliberate opt-out with no effect on AI-answer citations, so it does not lower the score.`);
    i.state = 'na';
    items.push(i);
  }

  // sitemap.xml - an actually-consumed, stronger AI-discovery signal than llms.txt.
  items.push(item('Sitemap', site?.sitemap ? 5 : 0, 5, !!site?.sitemap, site?.sitemap ? 'A sitemap is published, which gives crawlers a clearer page list to discover.' : 'No sitemap.xml found, so crawlers may miss pages.', false, site?.sitemap ? undefined : 'Publish a sitemap.xml and reference it in robots.txt.'));

  // llms.txt is an emerging, low-adoption convention - small bonus only. When
  // absent it is a neutral note (gray dot), not a failure, since it has near-zero
  // real impact today; present, it is a small positive.
  const llms = item('llms.txt guide', site?.llmsTxt ? 2 : 0, 2, !!site?.llmsTxt, site?.llmsTxt ? 'An llms.txt guide is published (an emerging, optional convention).' : 'No llms.txt (an optional, emerging guide for AI tools - low impact today).');
  if (!site?.llmsTxt) llms.state = 'na';
  items.push(llms);

  // Not asking engines NOT to index. `siteNoindex` (when supplied for the
  // site-wide Access section) reflects ANY audited page; otherwise it is the
  // single page's own meta.
  const noindex = siteNoindex ?? /noindex/i.test(page.robotsMeta);
  const noindexDetail = noindex
    ? siteNoindex !== undefined
      ? 'At least one checked page asks search and AI engines not to index it.'
      : 'This page asks search and AI engines not to index it.'
    : siteNoindex !== undefined
      ? 'The pages we checked allow indexing.'
      : 'This page allows indexing.';
  items.push(item('Page is indexable', noindex ? 0 : 2, 2, !noindex, noindexDetail, false, noindex ? 'Remove the noindex tag from the affected page(s) if you want them found.' : undefined));

  const points = items.reduce((s, it) => s + it.points, 0);
  return { id: 'access', name: 'Crawler access', points: round1(points), max: W_ACCESS, items };
}

// ---- category 3: machine-readable structure (rendered) ----
export function scoreStructure(rendered: PageSignals): CategoryScore {
  const sd = rendered.structuredData;
  const ogCount = [rendered.og.title, rendered.og.description, rendered.og.image].filter(Boolean).length;
  // A present-but-unparseable JSON-LD block is a real defect (worse than none),
  // so an invalid block with no valid one earns nothing and is called out.
  const sdOk = sd.valid > 0;
  const items: ScoreItem[] = [
    item('Structured data', sdOk ? 8 : 0, 8, sdOk,
      sdOk
        ? `Structured data found that helps machines understand the page (${sd.types.slice(0, 4).join(', ') || 'present'}).`
        : sd.invalid > 0
          ? `${sd.invalid} structured-data block${sd.invalid === 1 ? '' : 's'} on the page could not be parsed, so a machine cannot read ${sd.invalid === 1 ? 'it' : 'them'}.`
          : 'No schema.org structured data, so machines must infer what the page is about.',
      false,
      sd.invalid > 0 ? 'Fix the broken structured-data block so a machine can parse it.' : 'Add schema.org structured data (Organization, Product, Article, and so on) so machines can identify the page.'),
    item('Page title', rendered.titlePresent ? 3 : 0, 3, rendered.titlePresent,
      rendered.titlePresent ? 'The page has a title.' : 'The page has no title.', false, 'Add a clear, specific title to the page.'),
    item('Meta description', rendered.metaDescriptionPresent ? 3 : 0, 3, rendered.metaDescriptionPresent,
      rendered.metaDescriptionPresent ? 'The page has a meta description.' : 'No meta description, so engines write their own summary.', false, 'Add a meta description that summarizes the page.'),
    item('Social preview tags', (ogCount / 3) * 3, 3, ogCount === 3,
      ogCount === 3 ? 'Open Graph title, description, and image are all set.' : `Open Graph tags are incomplete (${ogCount}/3 of title, description, image).`, ogCount > 0, 'Add Open Graph title, description, and image tags for clean link previews.'),
    item('Canonical URL', rendered.canonical ? 1.5 : 0, 1.5, rendered.canonical,
      rendered.canonical ? 'A canonical URL is declared.' : 'No canonical URL, so duplicate addresses can confuse crawlers.', false, 'Add a canonical URL to the page.'),
    item('Language declared', rendered.lang ? 1.5 : 0, 1.5, !!rendered.lang,
      rendered.lang ? `Page language is declared (${rendered.lang}).` : 'No lang attribute, so the page language is left to guesswork.', false, 'Set the html lang attribute to the page language.'),
  ];
  const points = items.reduce((s, it) => s + it.points, 0);
  return { id: 'structure', name: 'Machine-readable structure', points: round1(points), max: W_STRUCTURE, items };
}

// ---- category 4: semantic HTML and content quality (rendered) ----
export function scoreSemantics(rendered: PageSignals): CategoryScore {
  const h = rendered.headings;
  const lm = rendered.landmarks;
  const imgs = rendered.images;
  const links = rendered.links;
  const descriptiveRatio = links.total > 0 ? (links.total - links.nondescriptive) / links.total : 1;
  const altRatio = imgs.total > 0 ? imgs.withAlt / imgs.total : 1;

  const items: ScoreItem[] = [
    item('Single main heading', h.h1Count === 1 ? 3 : 0, 3, h.h1Count === 1,
      h.h1Count === 1 ? 'The page has exactly one main heading.' : h.h1Count === 0 ? 'The page has no h1 heading.' : `The page has ${h.h1Count} h1 headings (one is ideal).`, h.h1Count > 1,
      h.h1Count === 0 ? 'Add a single h1 as the page main heading.' : 'Use exactly one h1 as the page main heading.'),
    item('Heading order', h.orderOk ? 2 : 0, 2, h.orderOk,
      h.orderOk ? 'Headings follow a logical order.' : 'Heading levels skip around, so the outline is hard to follow.', false, 'Fix the heading order so levels do not skip (h2 then h3, not h2 then h4).'),
    item('Main content region', lm.main ? 4 : 0, 4, lm.main,
      lm.main ? 'A <main> region marks the primary content.' : 'No <main> landmark, so agents must guess which part is the content.', false, 'Wrap the primary content in a <main> region.'),
    item('Descriptive links', descriptiveRatio * 2, 2, descriptiveRatio >= 0.9,
      links.total === 0 ? 'No links to evaluate.' : `${Math.round(descriptiveRatio * 100)}% of links have descriptive text.`, descriptiveRatio >= 0.6, 'Give links descriptive text instead of "click here" or a bare URL.'),
    item('Image alt text', altRatio * 2, 2, altRatio >= 0.9,
      imgs.total === 0 ? 'No images to evaluate.' : `${imgs.withAlt} of ${imgs.total} images have alt text describing them.`, altRatio >= 0.6, 'Add descriptive alt text to the images that lack it.'),
    item('Real text content', rendered.textWords >= 250 ? 2 : (rendered.textWords / 250) * 2, 2, rendered.textWords >= 250,
      `The page has ${rendered.textWords} words of text${rendered.textWords < 250 ? ' (thin pages are hard for agents to summarize)' : ''}.`, rendered.textWords >= 100, 'Add more real text content so the page has something substantial to read.'),
  ];
  // Image / link "na" presentation when there is nothing to evaluate.
  if (imgs.total === 0) items[4].state = 'na';
  if (links.total === 0) items[3].state = 'na';
  const points = items.reduce((s, it) => s + it.points, 0);
  return { id: 'semantics', name: 'Semantic HTML and content', points: round1(points), max: W_SEMANTICS, items };
}

// Full per-page score (all four categories, including site access). Kept for a
// single holistic number per page; the report instead splits page-varying signal
// from site-wide access (below) so a reader never sees the same robots.txt result
// repeated on every page card.
export function scorePage(result: AgentReadinessResult, site: SiteAccessSignals | undefined): PageAgentScore {
  const categories = [
    scoreSsr(result),
    scoreAccess(site, result.rendered),
    scoreStructure(result.rendered),
    scoreSemantics(result.rendered),
  ];
  const score = Math.round(categories.reduce((s, c) => s + c.points, 0));
  return {
    score,
    bucket: scoreBucket(score),
    categories,
    rawReachable: result.raw.ok && !result.raw.likelyBlocked && result.raw.signals !== null,
    coverage: contentCoverage(result.raw.signals, result.rendered),
  };
}

// The page-varying portion of the score (SSR + structure + semantics), rescaled
// to /100 so a per-page card reads as a clean 0-100. Crawler access is excluded
// here because it is site-wide; it gets its own section once.
export const PAGE_STRUCTURE_MAX = W_SSR + W_STRUCTURE + W_SEMANTICS; // 75

export interface PageStructureScore {
  score: number; // 0-100, after the shell cap
  uncappedScore: number; // before the shell cap (for transparency)
  bucket: Bucket;
  categories: CategoryScore[]; // [ssr, structure, semantics]
  rawPoints: number; // raw earned, out of PAGE_STRUCTURE_MAX
  rawReachable: boolean; // raw fetch ok and not bot-blocked
  rawUnreadable: boolean; // raw fetch failed or was bot-blocked (no honest number)
  coverage: number;
  shellCapped: boolean; // a near-empty raw shell forced the score down to "poor"
}

export function scorePageStructure(result: AgentReadinessResult): PageStructureScore {
  const categories = [scoreSsr(result), scoreStructure(result.rendered), scoreSemantics(result.rendered)];
  const rawPoints = categories.reduce((s, c) => s + c.points, 0);
  const uncappedScore = Math.round((rawPoints / PAGE_STRUCTURE_MAX) * 100);
  const rawReachable = result.raw.ok && !result.raw.likelyBlocked && result.raw.signals !== null;
  const coverage = contentCoverage(result.raw.signals, result.rendered);
  // Gating: a reachable-but-near-empty raw shell is the CSR-invisibility case -
  // cap the score at "poor" so strong structure/semantics can't paper over the
  // fact that a non-rendering crawler sees almost no content.
  const shellCapped = rawReachable && coverage < SHELL_COVERAGE && uncappedScore > GATED_CAP;
  const score = shellCapped ? GATED_CAP : uncappedScore;
  return {
    score,
    uncappedScore,
    bucket: scoreBucket(score),
    categories,
    rawPoints: round1(rawPoints),
    rawReachable,
    rawUnreadable: !rawReachable,
    coverage,
    shellCapped,
  };
}

export interface SiteAccessScore {
  score: number; // 0-100
  bucket: Bucket;
  category: CategoryScore;
  rawPoints: number; // out of W_ACCESS
}

export function scoreSiteAccess(site: SiteAccessSignals | undefined, page: PageSignals, siteNoindex?: boolean): SiteAccessScore {
  const category = scoreAccess(site, page, siteNoindex);
  const score = Math.round((category.points / W_ACCESS) * 100);
  return { score, bucket: scoreBucket(score), category, rawPoints: round1(category.points) };
}

export interface SiteAgentScore {
  overall: number; // 0-100 average of the per-page structure scores, capped at GATED_CAP when shell- or robots-gated
  bucket: Bucket;
  structureAvg: number; // ungated 0-100 average of the per-page structure scores
  access: SiteAccessScore;
  shellCapped: boolean; // most pages are near-empty raw shells (CSR), capping the site
  accessBlocked: boolean; // robots.txt blocks every crawler - no AI engine can read any page
  allRawUnreadable: boolean; // every page's raw fetch failed/blocked - show a caveat, not a number
}

// The headline site score is the average 0-100 per-page structure score, on the
// same scale as the page cards. Two gating rules cap it at "poor": most pages
// are near-empty raw shells, or robots.txt blocks every AI answer crawler.
export function scoreSite(results: readonly AgentReadinessResult[], site: SiteAccessSignals | undefined): SiteAgentScore {
  // noindex is per-page, but the Access section is shown once for the whole site:
  // flag it if ANY audited page carries a noindex (not just page 0).
  const anyNoindex = results.some((r) => /noindex/i.test(r.rendered.robotsMeta));
  const access = scoreSiteAccess(site, results[0]?.rendered ?? emptySignals(), anyNoindex);
  const pages = results.map((r) => scorePageStructure(r));
  const reachable = pages.filter((p) => p.rawReachable);
  const structureRaws = pages.map((p) => p.rawPoints);
  const structureRawAvg = structureRaws.length ? structureRaws.reduce((a, b) => a + b, 0) / structureRaws.length : 0;
  const structureAvg = Math.round((structureRawAvg / PAGE_STRUCTURE_MAX) * 100);
  // Most reachable pages are shells -> the site is effectively CSR-invisible.
  const shellCapped =
    reachable.length > 0 && reachable.filter((p) => p.coverage < SHELL_COVERAGE).length >= Math.ceil(reachable.length / 2) && structureAvg > GATED_CAP;
  // robots.txt blocks every AI answer crawler -> a well-built page is still
  // invisible to AI. Uses the citation-aware gate: a site that blocks generic
  // crawlers but allows the AI answer bots is NOT capped.
  const accessBlocked = citationFullyBlocked(site);
  const allRawUnreadable = pages.length > 0 && pages.every((p) => p.rawUnreadable);
  const overall = shellCapped || (accessBlocked && structureAvg > GATED_CAP) ? GATED_CAP : structureAvg;
  return { overall, bucket: scoreBucket(overall), structureAvg, access, shellCapped, accessBlocked, allRawUnreadable };
}

function emptySignals(): PageSignals {
  return {
    title: '', titlePresent: false, metaDescription: '', metaDescriptionPresent: false,
    canonical: false, lang: '', robotsMeta: '',
    og: { title: false, description: false, image: false, type: false, siteName: false },
    twitterCard: false,
    structuredData: { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 },
    headings: { h1Count: 0, total: 0, orderOk: true },
    landmarks: { main: false, nav: false, header: false, footer: false, article: false },
    links: { total: 0, nondescriptive: 0 }, images: { total: 0, withAlt: 0 },
    textChars: 0, textWords: 0,
  };
}
