/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildCaptionCues,
  captionCuesForRewrite,
  renderClientReport,
  type Frame,
} from '../client-report';
import {
  BENCHMARK_LINES,
  MATERIALITY_FLOOR_USD_PER_MONTH,
  RECOVERY_BANDS,
  a11yFixText,
  moneyPage,
  perfFixText,
  perfGap,
  perfGapSubLines,
  perfStakesProse,
} from '../client-report-model/cost';
import { DEFAULT_MOBILE_TRAFFIC_SHARE } from '../cost-model';
import { findBannedWords } from '../cost-strings';
import type { AccessibilityResult, AccessibilityScan, AccessibilityViolation } from '../../audit/stages/accessibility/types';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';

interface A11yFixture {
  blocked?: boolean;
  score?: number;
  violations: Array<{ ruleId: string; impact: AccessibilityViolation['impact']; failureSummary?: string; selector?: string }>;
}

interface AgentFixture {
  rawWords: number;
  renderedWords: number;
  blocked?: boolean;
  withoutStructuredData?: boolean;
}

interface PageFixture {
  id: string;
  name: string;
  startingPath: string;
  metrics: Record<string, number>;
  a11y?: A11yFixture;
  agent?: AgentFixture;
}

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function display(label: string, value: number): string {
  if (label === 'LCP' || label === 'FCP' || label === 'TBT') return `${(value / 1000).toFixed(1)}s`;
  if (label === 'CLS') return (value / 100).toFixed(2);
  return String(value);
}

function signals(words: number, fixture: Pick<AgentFixture, 'withoutStructuredData'> = {}): PageSignals {
  return {
    title: 'Example page',
    titlePresent: true,
    metaDescription: 'Example page description',
    metaDescriptionPresent: true,
    canonical: true,
    lang: 'en',
    robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: fixture.withoutStructuredData
      ? { blocks: 0, valid: 0, invalid: 0, types: [], microdataItems: 0 }
      : { blocks: 1, valid: 1, invalid: 0, types: ['Organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 3, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 4, nondescriptive: 0 },
    images: { total: 1, withAlt: 1 },
    textChars: words * 6,
    textWords: words,
  };
}

function agent(url: string, fixture: AgentFixture): AgentReadinessResult {
  const raw = fixture.blocked ? null : signals(fixture.rawWords, fixture);
  return {
    url,
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 },
    fetchedAt: '2026-07-10T00:00:00.000Z',
    raw: {
      ok: !fixture.blocked,
      status: fixture.blocked ? 403 : 200,
      contentType: fixture.blocked ? undefined : 'text/html',
      bytes: fixture.blocked ? undefined : 1000,
      likelyBlocked: !!fixture.blocked,
      signals: raw,
    },
    rendered: signals(fixture.renderedWords, fixture),
    rawHtmlBytes: fixture.blocked ? 0 : 1000,
    renderedHtmlBytes: 5000,
    ...(fixture.blocked ? { blocked: true } : {}),
  };
}

function a11y(url: string, fixture: A11yFixture): AccessibilityResult {
  const violations: AccessibilityViolation[] = fixture.violations.map((violation) => ({
    ruleId: violation.ruleId,
    impact: violation.impact,
    help: violation.ruleId,
    helpUrl: '',
    tags: [],
    nodes: [{ target: [violation.selector ?? '.fixture'], html: '<p>fixture</p>', failureSummary: violation.failureSummary ?? '' }],
  }));
  const scan: AccessibilityScan = {
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 },
    url,
    violations,
    ...(fixture.blocked ? { blocked: true } : {}),
  };
  return {
    scans: [scan],
    totalViolations: violations.length,
    failOnViolation: true,
    effectiveConfig: { tags: [], disableRules: [], includeRules: null },
  };
}

function writeResults(pages: PageFixture[], siteUrl = 'http://localhost:1'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-reframe-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({
    meta: {
      experimentUrl: siteUrl,
      generatedAt: '2026-07-10T00:00:00.000Z',
      throttleProfile: 'Slow-4G',
    },
    tests: pages.map((page) => ({
      id: page.id,
      name: page.name,
      startingPath: page.startingPath,
      viewport: { label: 'phone', width: 390, height: 844 },
    })),
  }, null, 2)}\n`);
  for (const page of pages) {
    const pageDir = path.join(dir, page.id);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'audit.json'), `${JSON.stringify({
      stage: 'audit',
      measurement: {
        metrics: Object.entries(page.metrics).map(([label, value]) => ({ label, value, display: display(label, value) })),
      },
    }, null, 2)}\n`);
    const url = `${siteUrl}${page.startingPath}`;
    if (page.a11y) {
      fs.writeFileSync(path.join(pageDir, 'accessibility.json'), `${JSON.stringify({
        kind: 'ok', stage: 'accessibility', measurement: a11y(url, page.a11y),
      }, null, 2)}\n`);
      if (typeof page.a11y.score === 'number') {
        fs.writeFileSync(path.join(pageDir, 'accessibility-client.json'), `${JSON.stringify({ score: page.a11y.score })}\n`);
      }
    }
    if (page.agent) {
      fs.writeFileSync(path.join(pageDir, 'agent-readiness.json'), `${JSON.stringify({
        kind: 'ok', stage: 'agent-readiness', measurement: agent(url, page.agent),
      }, null, 2)}\n`);
    }
  }
  return dir;
}

const basePage = (overrides: Partial<PageFixture> = {}): PageFixture => ({
  id: 'home',
  name: 'Home',
  startingPath: '/',
  metrics: { LCP: 4200, FCP: 1200, CLS: 2, TBT: 80, js: 100, downloads: 4096, 'downloads-before-LCP': 1024 },
  ...overrides,
});

describe('cost-of-pain reframe model', () => {
  it('assembles every Cost C builder slot from one synthesized audit', async () => {
    const result = await renderClientReport(writeResults([
      basePage({
        metrics: { LCP: 4200, FCP: 3030, CLS: 2, TBT: 80, js: 900, downloads: 1100, 'downloads-before-LCP': 900 },
        a11y: { violations: [{ ruleId: 'target-size', impact: 'serious' }] },
        agent: { rawWords: 615, renderedWords: 937 },
      }),
      basePage({
        id: 'platform', name: 'Platform', startingPath: '/platform',
        metrics: { LCP: 3200, FCP: 3421.7, CLS: 2, TBT: 80, js: 700, downloads: 2200, 'downloads-before-LCP': 1200 },
        a11y: {
          violations: [
            { ruleId: 'target-size', impact: 'serious' },
            { ruleId: 'image-alt', impact: 'serious' },
          ],
        },
        agent: { rawWords: 700, renderedWords: 700 },
      }),
      basePage({
        id: 'about', name: 'About', startingPath: '/about',
        metrics: { LCP: 2200, FCP: 1700, CLS: 1, TBT: 50, js: 300, downloads: 900, 'downloads-before-LCP': 500 },
        a11y: { score: 96, violations: [{ ruleId: 'color-contrast', impact: 'moderate' }] },
        agent: { rawWords: 700, renderedWords: 700 },
      }),
    ]));

    const perf = result.model.perfCost;
    expect(perf).toMatchObject({
      state: 'measured',
      gap: {
        metricLabel: 'First content', measuredLabel: '3.0s', goodLabel: '1.8s', poorLabel: '3.0s', multipleLabel: '1.6x',
        lineOwner: "Google's Lighthouse benchmark - first contentful paint",
      },
      scale: { axisMaxDisplay: 4, markerPercent: 75 },
      pageSpeedUrl: 'https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%3A1%2F',
      scoreBadgePolicy: 'score-status',
    });
    expect(perf?.gapSubLines).toEqual([
      'slowest page: Platform, 3.4s - 1.8x the line',
      'next slowest: Home, 3.0s - 1.6x the line',
      'site average: 2.7s - 1.5x the line',
      'the phone pulls 0.9 MB before the main content shows, 1.1 MB in total',
    ]);
    expect(perf?.countedZeroLine).toContain('About (1.7s)');
    expect(perf?.sitePrompts?.perf).toContain("The site's first content is slow on phones");
    expect(perf?.fix?.text).toMatch(/^Start where the wait is: Home pulls 0\.9 MB before its main content shows\./);

    const a11y = result.model.a11yCost;
    expect(a11y).toMatchObject({
      state: 'measured',
      headline: '3 high-impact barriers keep some visitors from using the site.',
      headlineSub: 'The bar for any website is zero barriers that block someone. We found 3 on 2 of 3 pages checked.',
      scoreBadgePolicy: 'score-status',
    });
    expect(result.model.a11yStrongPageGroup).toEqual({
      label: 'Strong pages',
      pages: [{ name: 'About', score: 96 }],
    });
    expect(a11y?.gapSubLines).toEqual(expect.arrayContaining([
      'worst page: Platform - 2 high-impact',
      'touch targets too small to tap reliably - 2 pages',
      'images with no text description - 1 page',
      'also seen, not counted in the 3: text that is too hard to read - 1 page',
      'WCAG - passes at zero critical barriers',
    ]));
    expect(a11y?.sitePrompts?.a11y).toContain('Goal: all 3 high-impact issues pass');
    expect(a11y?.sitePrompts?.a11y).toContain('largely a shared component');

    const ai = result.model.agentCost;
    expect(ai).toMatchObject({
      state: 'measured',
      aiTiles: { invisiblePercent: 34, readableWords: 615, totalWords: 937 },
      scoreBadgePolicy: 'score-status',
      strongPageGroup: {
        label: 'Strong pages',
        pages: [{ name: 'About', score: 100 }, { name: 'Platform', score: 100 }],
      },
    });
    expect(ai?.headlineSub).toContain('Site-wide, about');
  });

  it('does not label a non-homepage AI audit page as the homepage', async () => {
    const result = await renderClientReport(writeResults([
      basePage({
        id: 'entry', name: 'Entry', startingPath: '/entry',
        metrics: { LCP: 4200, FCP: 3000, CLS: 2, TBT: 80 },
        agent: { rawWords: 0, renderedWords: 100 },
      }),
    ]));

    expect(result.model.agentCost).toMatchObject({ state: 'measured' });
    expect(result.model.agentCost?.aiTiles).toBeUndefined();
  });

  it('weights AI site context by words and names the page the cost block grades', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ agent: { rawWords: 100, renderedWords: 100 } }),
      basePage({
        id: 'pricing', name: 'Pricing', startingPath: '/pricing',
        agent: { rawWords: 800, renderedWords: 1000 },
      }),
    ]));

    expect(result.model.agentCost).toMatchObject({
      state: 'measured',
      headlineSub: expect.stringContaining('Site-wide, about 82% of your text is readable today - the pricing sits below that'),
      aiTiles: { invisiblePercent: 0, readableWords: 100, totalWords: 100 },
    });
  });

  it('uses the slowest first-content page when the legacy cost anchor is FCP-healthy', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 1200, CLS: 2, TBT: 80 } }),
      basePage({
        id: 'pricing', name: 'Pricing', startingPath: '/pricing',
        metrics: { LCP: 2800, FCP: 3000, CLS: 2, TBT: 80, downloads: 1200, 'downloads-before-LCP': 600 },
      }),
    ]));

    expect(result.model.perfCost).toMatchObject({
      state: 'measured',
      gap: { metricLabel: 'First content', measuredLabel: '3.0s' },
      pageSpeedUrl: 'https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%3A1%2Fpricing',
    });
    expect(result.model.perfCost?.sitePrompts?.perf).toBeDefined();
  });

  it('does not add an at-risk FCP cost when the performance verdict is good', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 2000, FCP: 2000, CLS: 2, TBT: 80 } }),
    ]));

    expect(result.model.tiles.find((tile) => tile.target === 'perf')?.status).toBe('good');
    expect(result.model.perfCost).toMatchObject({ state: 'zero' });
  });

  it('builds an FCP cost when first content is the only fair performance signal', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { FCP: 2000, CLS: 2, TBT: 80, js: 100, downloads: 1000, 'downloads-before-LCP': 500 } }),
    ]));

    expect(result.model.tiles.find((tile) => tile.target === 'perf')?.status).toBe('fair');
    expect(result.model.perfCost).toMatchObject({
      state: 'measured',
      headline: 'nothing for the first 2.0s',
      gap: { metricLabel: 'First content', measuredLabel: '2.0s' },
    });
  });

  it('keeps a worse LCP cost story ahead of a mild first-content delay', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 2000, FCP: 2000, CLS: 2, TBT: 80 } }),
      basePage({
        id: 'book', name: 'Book now', startingPath: '/book',
        metrics: { LCP: 12000, FCP: 1500, CLS: 2, TBT: 80, js: 600, downloads: 20480, 'downloads-before-LCP': 4096 },
      }),
    ]));

    expect(result.model.perfCost).toMatchObject({
      headline: '12.0s before your main content appears on a mid-range phone',
      bookingLine: expect.stringContaining('Book now is the page where booking starts'),
      gap: { metricLabel: 'Main content', measuredLabel: '12.0s' },
    });
  });

  it('floors the FCP average multiple from the displayed average', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 3000, FCP: 3400, CLS: 2, TBT: 80, js: 100, downloads: 1000, 'downloads-before-LCP': 500 } }),
      basePage({ id: 'pricing', name: 'Pricing', startingPath: '/pricing', metrics: { LCP: 3000, FCP: 3400, CLS: 2, TBT: 80, js: 100, downloads: 1000, 'downloads-before-LCP': 500 } }),
      basePage({ id: 'about', name: 'About', startingPath: '/about', metrics: { LCP: 3000, FCP: 3500, CLS: 2, TBT: 80, js: 100, downloads: 1000, 'downloads-before-LCP': 500 } }),
    ]));

    expect(result.model.perfCost?.gapSubLines).toContain('site average: 3.4s - 1.8x the line');
  });

  it('keeps a11y family counts and mixed-impact prompt evidence reconciled', async () => {
    const result = await renderClientReport(writeResults([
      basePage({
        a11y: {
          violations: [
            { ruleId: 'button-name', impact: 'serious' },
            { ruleId: 'link-name', impact: 'serious' },
            { ruleId: 'image-alt', impact: 'serious' },
          ],
        },
      }),
      basePage({
        id: 'about', name: 'About', startingPath: '/about',
        a11y: { violations: [{ ruleId: 'image-alt', impact: 'moderate' }] },
      }),
    ]));
    const cost = result.model.a11yCost;

    expect(cost).toMatchObject({
      headline: '2 high-impact barriers keep some visitors from using the site.',
      fix: { text: expect.stringContaining('Start with images with no text description - it reaches 1 page.') },
    });
    expect(cost?.gapSubLines).toContain('worst page: Home - 2 high-impact');
    expect(cost?.sitePrompts?.a11y).toContain('Goal: all 2 high-impact issues pass');
  });

  it('keeps the a11y site prompt when a repeated selector is not safe prompt evidence', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: 'a[href="https://example.com/contact"]' }] } }),
      basePage({ id: 'about', name: 'About', startingPath: '/about', a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: 'a[href="https://example.com/contact"]' }] } }),
    ]));

    expect(result.model.a11yCost?.sitePrompts?.a11y).toContain('Goal: all 2 high-impact issues pass');
  });

  it('keeps a shared user-card selector as a11y prompt evidence', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: '.user-card' }] } }),
      basePage({ id: 'about', name: 'About', startingPath: '/about', a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: '.user-card' }] } }),
    ]));

    expect(result.model.a11yCost?.sitePrompts?.a11y).toContain('largely a shared component');
  });

  it('keeps the a11y prompt when shared evidence fails downstream sanitization', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: '.reveal-token' }] } }),
      basePage({ id: 'about', name: 'About', startingPath: '/about', a11y: { violations: [{ ruleId: 'target-size', impact: 'serious', selector: '.reveal-token' }] } }),
    ]));

    expect(result.model.a11yCost?.sitePrompts?.a11y).toContain('Goal: all 2 high-impact issues pass');
    expect(result.model.a11yCost?.sitePrompts?.a11y).not.toContain('largely a shared component');
  });

  it('keeps same-path audit scenarios distinct while deduping the a11y site prompt', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ a11y: { violations: [{ ruleId: 'target-size', impact: 'serious' }] } }),
      basePage({ id: 'home-scroll', name: 'Home after scroll', startingPath: '/', a11y: { score: 98, violations: [] } }),
    ]));

    expect(result.model.a11yCards).toHaveLength(1);
    expect(result.model.a11yCost?.headlineSub).toContain('on 1 of 2 pages checked');
    expect(result.model.a11yStrongPageGroup).toEqual({
      label: 'Strong pages',
      pages: [{ name: 'Home after scroll', score: 98 }],
    });
    expect(result.model.a11yCost?.sitePrompts?.a11y).toContain('Goal: all 1 high-impact issues pass');
  });

  it('collapses a fully readable AI page even when its structural score is fair', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ agent: { rawWords: 300, renderedWords: 300, withoutStructuredData: true } }),
    ]));

    expect(result.model.tiles.find((tile) => tile.target === 'agent')).toMatchObject({ status: 'fair' });
    expect(result.model.agentCards).toHaveLength(0);
    expect(result.model.agentCost?.strongPageGroup).toMatchObject({
      pages: [{ name: 'Home', score: 83 }],
    });
  });

  it('preserves the established cost treatment when FCP is healthy but LCP is slow', async () => {
    const result = await renderClientReport(writeResults([
      basePage(),
      basePage({ id: 'book', name: 'Book now', startingPath: '/book', metrics: { LCP: 12000, FCP: 1500, CLS: 2, TBT: 90, js: 600, downloads: 20480, 'downloads-before-LCP': 4096 } }),
      basePage({ id: 'near', name: 'About', startingPath: '/about', metrics: { LCP: 2400, FCP: 900, CLS: 1, TBT: 50, js: 200, downloads: 5120, 'downloads-before-LCP': 512 } }),
    ]));
    const cost = result.model.perfCost;

    expect(cost).toMatchObject({
      state: 'measured',
      gap: {
        metricLabel: 'Main content', measuredLabel: '4.2s', goodLabel: '2.5s', poorLabel: '4.0s', multipleLabel: '1.6x', zone: 'poor',
        lineOwner: "Google's Core Web Vitals", lineUrl: 'https://web.dev/articles/lcp',
      },
      bookingLine: 'Book now is the page where booking starts. It shows its main content after 12.0s - a visitor who gives up here is an inquiry that never begins.',
      stakes: { kind: 'at-risk' },
      fix: { tone: 'primary', text: 'The target: main content under 2.5 seconds on the same phone profile. The dominant cause we measured: every page carries 0.1-0.6 MB of JavaScript, and the heaviest page moves 20.0 MB in total.' },
      calculator: {
        mobileSharePrefill: DEFAULT_MOBILE_TRAFFIC_SHARE,
        bands: RECOVERY_BANDS,
        materialityFloorUsdPerMonth: MATERIALITY_FLOOR_USD_PER_MONTH,
        inquiryNoun: 'inquiry',
      },
    });
    expect(cost?.headline).toContain('4.2s before your main content appears');
    expect(cost?.checkLine).toContain('url=http%3A%2F%2Flocalhost%3A1%2Fbook');
    expect(cost?.gapSubLines).toEqual([
      'slowest page: Book now, 12.0s - 4.8x the line',
      'site average: 6.2s - 2.4x the line',
      'the phone pulls 1.0 MB before the main content shows, 4.0 MB in total',
    ]);
    expect(cost?.countedZeroLine).toBe('Counted as zero above: About (2.4s) sits close to the line. It is included in the site average, but not counted as a slow page above.');
    expect(result.model.narrative.bottomLineHtml).toContain('Home shows its main content after');
    expect(result.model.narrative.bottomLineHtml).toContain('1.6x past Google&#39;s 2.5-second good line.');
    expect(findBannedWords(JSON.stringify(cost))).toEqual([]);
  });

  it('keeps the established LCP cost story when layout shift ranks first', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 4500, FCP: 1200, CLS: 2, TBT: 80 } }),
      basePage({
        id: 'unstable',
        name: 'Unstable page',
        startingPath: '/unstable',
        metrics: { LCP: 2300, FCP: 1000, CLS: 60, TBT: 80 },
      }),
    ]));
    const cost = result.model.perfCost;

    expect(result.model.perfCards.find((card) => card.path === '/unstable')?.headlineHtml).toContain('jumps around');
    expect(cost).toMatchObject({
      state: 'measured',
      headline: '4.5s before your main content appears on a mid-range phone',
      gap: { metricLabel: 'Main content', measuredLabel: '4.5s' },
      stakes: { prose: expect.stringContaining('Waits like this') },
      fix: { text: expect.stringContaining('The target: main content under 2.5 seconds') },
    });
  });

  it('keeps layout shift as the established cost hero when FCP is healthy', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 2300, FCP: 1000, CLS: 60, TBT: 80 } }),
    ]));
    const cost = result.model.perfCost;

    expect(cost).toMatchObject({
      state: 'measured',
      headline: 'the layout jumps around on a mid-range phone',
      gap: { metricLabel: 'Layout shift', measuredLabel: '0.60' },
      stakes: { prose: expect.stringContaining('Layout shifts like this') },
      fix: { text: expect.stringContaining('The target: layout shift under 0.10 on the same phone profile') },
    });
  });

  it('keeps the booking line in the established non-FCP treatment', async () => {
    const pages = [
      basePage(),
      basePage({ id: 'contact', name: 'Contact', startingPath: '/contact', metrics: { LCP: 6000, FCP: 1500, js: 200, downloads: 4096 } }),
      basePage({ id: 'pricing', name: 'Pricing', startingPath: '/pricing', metrics: { LCP: 5000, FCP: 1200, js: 200, downloads: 4096 } }),
    ];
    const overridden = await renderClientReport(writeResults(pages), { moneyPage: 'pricing' });
    expect(overridden.model.perfCost?.bookingLine).toContain('Pricing is the page where booking starts');

    const noMatch = await renderClientReport(writeResults([
      basePage(),
      basePage({ id: 'about', name: 'About us', startingPath: '/about', metrics: { LCP: 5000, FCP: 1200, js: 200, downloads: 4096 } }),
    ]));
    expect(noMatch.model.perfCost?.bookingLine).toBeUndefined();
  });

  it('preserves the root path as an explicit money-page override', () => {
    const selected = moneyPage([
      { name: 'Home', startingPath: '/', lcpMs: 4200 },
      { name: 'Book now', startingPath: '/book', lcpMs: 6000 },
    ], '/');
    expect(selected?.name).toBe('Home');
  });

  it('matches money-page words but not unrelated substrings', () => {
    const selected = moneyPage([
      { name: 'Handbook', startingPath: '/handbook', lcpMs: 6000 },
      { name: 'Book now', startingPath: '/book', lcpMs: 5000 },
    ]);
    expect(selected?.name).toBe('Book now');
  });

  it('builds a correct gap for each performance problem and only emits data-backed sub-lines', () => {
    expect(perfGap('slow-lcp', { lcpMs: 5000 })?.lineUrl).toBe('https://web.dev/articles/lcp');
    expect(perfGap('layout-shift', { cls: 0.26 })).toMatchObject({ measuredLabel: '0.26', goodLabel: '0.10', poorLabel: '0.25', zone: 'poor' });
    expect(perfGap('blank', { fcpMs: 3200 })).toMatchObject({ measuredLabel: '3.2s', goodLabel: '1.8s', poorLabel: '3.0s' });
    expect(perfGap('late-paint', { fcpMs: 2100 })?.multipleLabel).toBe('1.1x');
    expect(perfGap('sluggish', { tbtMs: 800 })).toMatchObject({ measuredLabel: '0.8s', goodLabel: '0.2s', poorLabel: '0.6s' });
    expect(perfGapSubLines([{ name: 'Only LCP', lcpMs: 5000 }], { name: 'No bytes' })).toEqual([
      'slowest page: Only LCP, 5.0s - 2x the line',
    ]);
    expect(perfFixText([], 'layout-shift')).toBe('The target: layout shift under 0.10 on the same phone profile.');
    expect(perfStakesProse('layout-shift')).toContain('Layout shifts like this');
    expect(perfStakesProse('layout-shift')).toContain('so we do not print a made-up number.');
  });

  it('keeps a minor accessibility finding number-free while carrying real finding details', async () => {
    const result = await renderClientReport(writeResults([
      basePage({
        metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 },
        a11y: { violations: [{ ruleId: 'color-contrast', impact: 'minor', failureSummary: 'Element has insufficient color contrast of 3.20:1' }] },
      }),
    ]));
    const cost = result.model.a11yCost;

    expect(cost).toMatchObject({
      state: 'zero',
      stakes: {
        kind: 'no-material-loss',
        prose: 'No material loss here. Nothing we measured is turning visitors away today - that is rarer than it sounds, and worth protecting.',
      },
      gap: { metricLabel: 'Text contrast', measuredLabel: '3.20:1', goodLabel: '4.50:1', lineOwner: 'WCAG AA' },
      fix: { tone: 'secondary', text: 'Fix the concrete findings we measured: contrast below the 4.5:1 WCAG line on 1 page.' },
    });
    expect(cost?.affectsProse).toContain('We put no visitor count on this');
    expect(findBannedWords(JSON.stringify(cost))).toEqual([]);
  });

  it('does not call every ARIA failure an unlabeled control', () => {
    const fix = a11yFixText([{ violations: [{ ruleId: 'aria-hidden-focus' }] }]);
    expect(fix).toBe('Fix the concrete findings we measured: controls with accessibility markup screen readers cannot use on 1 page.');
    expect(fix).not.toContain('unlabeled');
  });

  it('keeps heading findings distinct from unlabeled page sections', () => {
    expect(a11yFixText([{ violations: [{ ruleId: 'heading-order' }] }]))
      .toBe('Fix the concrete findings we measured: heading structure that is harder to navigate on 1 page.');
  });

  it('treats up to 10% missing AI text as zero and larger gaps as measured', async () => {
    const nearlyComplete = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 }, agent: { rawWords: 99, renderedWords: 100 } }),
    ]));
    expect(nearlyComplete.model.agentCost).toMatchObject({
      state: 'zero',
      headlineSub: 'only 99 of 100 words present',
      stakes: { kind: 'no-material-loss' },
    });
    expect(nearlyComplete.model.agentCost?.fix).toBeUndefined();
    expect(nearlyComplete.model.agentCost?.affectsProse).toContain('Visitor loss is counted once');

    const atThreshold = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 }, agent: { rawWords: 90, renderedWords: 100 } }),
    ]));
    expect(atThreshold.model.agentCost?.state).toBe('zero');

    const overThreshold = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 }, agent: { rawWords: 89, renderedWords: 100 } }),
    ]));
    expect(overThreshold.model.agentCost?.state).toBe('measured');

    const gap = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 }, agent: { rawWords: 65, renderedWords: 100 } }),
    ]));
    expect(gap.model.agentCost).toMatchObject({ state: 'measured', stakes: { kind: 'at-risk' } });
    expect(gap.model.agentCost?.calculator).toBeUndefined();
    expect(findBannedWords(JSON.stringify(gap.model.agentCost))).toEqual([]);
  });

  it('offers the optional llms.txt fix only after a completed negative probe', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const response = new Response('', { status: 404 });
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    });
    try {
      const result = await renderClientReport(writeResults([
        basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 }, agent: { rawWords: 99, renderedWords: 100 } }),
      ], 'https://example.com'));
      expect(result.model.agentCost?.fix).toMatchObject({ tone: 'secondary' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('adds the fixed 2.5-second cue without sending it to the caption rewriter', () => {
    const frames: Frame[] = [
      { timeMs: 0, imageFilename: '0.webp', imgW: 100, imgH: 200, shifts: [], isLcp: false },
      { timeMs: 4100, imageFilename: '4100.webp', imgW: 100, imgH: 200, shifts: [], isLcp: true },
    ];
    const slow = buildCaptionCues(frames, 4100, 1000, 5300);
    expect(slow).toContainEqual({ atMs: 2500, kind: 'google-good-line', text: "Google's good line passes here.", rewriteable: false });
    expect(captionCuesForRewrite(slow).some((cue) => cue.kind === 'google-good-line')).toBe(false);
    expect(buildCaptionCues(frames, 2000, 1000, 3200).some((cue) => cue.kind === 'google-good-line')).toBe(false);
  });

  it('does not add reframe extras to blocked or zero-performance states', async () => {
    const result = await renderClientReport(writeResults([
      basePage({
        metrics: {},
        a11y: { blocked: true, violations: [] },
        agent: { rawWords: 0, renderedWords: 100, blocked: true },
      }),
    ]));
    expect(result.model.perfCost).toBeUndefined();
    expect(result.model.a11yCost).toEqual({ tab: 'a11y', state: 'blocked', headline: '' });
    expect(result.model.agentCost).toEqual({ tab: 'ai', state: 'blocked' });
  });

  it('attaches the calculator only to a measured performance cost block', async () => {
    const result = await renderClientReport(writeResults([
      basePage({ metrics: { LCP: 1900, FCP: 900, CLS: 1, TBT: 50 } }),
    ]));
    expect(result.model.perfCost?.state).toBe('zero');
    expect(result.model.perfCost?.calculator).toBeUndefined();
    expect(BENCHMARK_LINES.lcpMs.good).toBe(2500);
  });
});
