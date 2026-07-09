/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildNarrativePrompt,
  buildDeterministicNarrative,
  composeNarrative,
  highlightBottomLine,
  NARRATIVE_OVERLAY_SCHEMA_VERSION,
  parseNarrativeResponse,
  type NarrativeFacts,
  type NarrativeSummarizer,
} from '../client-report-narrative';
import {
  AI_INDUSTRY_DATA_STATS,
  BANNED_WORDS,
  BOT_WALL_COPY,
  NOTHING_TO_FIX,
  findBannedWords,
} from '../cost-strings';
import {
  perfProblemPhrase,
  perfProblemTileCopy,
  renderClientReport,
  reportClsStatus,
  reportFcpStatus,
  reportLcpStatus,
  reportPagePerfStatus,
  reportPerfStatus,
  reportTbtStatus,
  type Problem,
  type ClientReportPagePerfStatusInput,
} from '../client-report';
import { renderClientReportHtml, clientReportStatusWord, type ClientReportModel } from '../client-report-renderer';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';
import type { PagePerf } from '../synthesis';

function facts(over: Partial<NarrativeFacts> = {}): NarrativeFacts {
  return {
    domain: 'www.example.com',
    worstDim: 'perf',
    perf: { status: 'poor', avgLabel: '5.3s', slowCount: 4, jumpyCount: 1, worst: [{ name: 'Home', problem: 'blank for 8s' }, { name: 'Pricing', problem: 'slow' }] },
    a11y: { status: 'fair', highImpact: 11, pagesWithBarriers: 4, topIssues: ['low-contrast text', 'unlabeled controls'], worstPage: 'Products' },
    agent: { status: 'good', score: 85, coveragePct: 88, accessBlocked: false, topGap: 'social preview tags', worstPage: 'Classic cards' },
    ...over,
  };
}

describe('buildDeterministicNarrative', () => {
  it('writes a verdict word and paragraph per present dimension', () => {
    const n = buildDeterministicNarrative(facts());
    expect(n.perf.verdictWord).toBe('Slow on phones');
    expect(n.perf.verdictPara).toContain('5.3s');
    expect(n.a11y.verdictPara).toContain('screen reader');
    expect(n.a11y.verdictPara).toContain('Products');
    expect(n.a11y.verdictPara).toContain('4 pages');
    expect(n.agent.verdictWord).toBe('Good');
  });

  it('highlights the worst dimension in the bottom line, colored by its severity', () => {
    const n = buildDeterministicNarrative(facts({ worstDim: 'perf' }));
    // default facts() has perf status 'poor' -> red highlight
    expect(n.bottomLineHtml).toContain('<span style="color:#ec8f7f; font-weight:700">mobile speed</span>');
  });

  it('names the good dimensions in the bottom line', () => {
    const n = buildDeterministicNarrative(facts({ worstDim: 'perf' }));
    // agent is good and not the worst dim -> mentioned as readable by AI
    expect(n.bottomLineHtml).toContain('readable by AI');
  });

  it('leans on the accessBlocked wording when robots blocks crawlers', () => {
    const n = buildDeterministicNarrative(
      facts({ worstDim: 'agent', agent: { status: 'poor', score: 30, accessBlocked: true } }),
    );
    expect(n.agent.verdictPara.toLowerCase()).toContain('robots.txt');
  });

  it('writes the all-clear verdict word for a dimension with no barriers', () => {
    const n = buildDeterministicNarrative(
      facts({ a11y: { status: 'good', highImpact: 0, pagesWithBarriers: 0, topIssues: [] } }),
    );
    expect(n.a11y.verdictWord).toBe('Usable by everyone');
  });

  it('does NOT claim a gap when every dimension is good (no contradiction with the tiles)', () => {
    const allGood = facts({
      worstDim: 'perf',
      perf: { status: 'good', avgLabel: '1.9s', slowCount: 0, jumpyCount: 0, worst: [] },
      a11y: { status: 'good', highImpact: 0, pagesWithBarriers: 0, topIssues: [] },
      agent: { status: 'good', score: 95, accessBlocked: false },
    });
    const n = buildDeterministicNarrative(allGood);
    expect(n.bottomLineHtml).toContain('healthy');
    expect(n.bottomLineHtml).not.toContain('The real gap');
    expect(n.bottomLineHtml).not.toContain('<span'); // nothing highlighted
  });

  it('does not call relaxed LCP page warnings fully healthy in the bottom line', () => {
    const n = buildDeterministicNarrative(facts({
      worstDim: 'perf',
      perf: {
        status: 'good',
        avgLabel: '3.7s',
        slowCount: 0,
        jumpyCount: 0,
        worst: [{ name: 'Home', problem: 'The biggest piece of the page takes 3.7s to appear' }],
      },
      a11y: { status: 'good', highImpact: 0, pagesWithBarriers: 0, topIssues: [] },
      agent: { status: 'good', score: 95, accessBlocked: false },
    }));

    expect(n.bottomLineHtml).toContain('looks fine overall');
    expect(n.bottomLineHtml).toContain('page cards still show');
    expect(n.bottomLineHtml).not.toContain('Every check we could run looks healthy');
    expect(n.bottomLineHtml).not.toContain('costing you customers');
  });

  it('does not call relaxed LCP performance quickly loaded when another dimension is worse', () => {
    const n = buildDeterministicNarrative(facts({
      worstDim: 'a11y',
      perf: {
        status: 'good',
        avgLabel: '3.7s',
        slowCount: 0,
        jumpyCount: 0,
        worst: [{ name: 'Home', problem: 'The biggest piece of the page takes 3.7s to appear' }],
      },
      a11y: { status: 'fair', highImpact: 3, pagesWithBarriers: 1, topIssues: ['low-contrast text'] },
      agent: { status: 'good', score: 95, accessBlocked: false },
    }));

    expect(n.bottomLineHtml).toContain('loads fine overall on a phone');
    expect(n.bottomLineHtml).not.toContain('loads quickly on a phone');
  });

  it('says it could not measure the site when no dimension is present', () => {
    const n = buildDeterministicNarrative({ domain: 'x.com', worstDim: 'perf' });
    expect(n.bottomLineHtml).toContain('could not measure');
    expect(n.bottomLineHtml).not.toContain('The real gap');
  });
});

describe('highlightBottomLine', () => {
  it('wraps the first occurrence of the worst-dimension label (amber by default)', () => {
    expect(highlightBottomLine('The gap is mobile speed today.', 'perf')).toContain('<span style="color:#e8a36b; font-weight:700">mobile speed</span>');
  });
  it('colors the highlight by severity', () => {
    expect(highlightBottomLine('The gap is mobile speed.', 'perf', 'poor')).toContain('color:#ec8f7f');
    expect(highlightBottomLine('The gap is mobile speed.', 'perf', 'fair')).toContain('color:#e8a36b');
    expect(highlightBottomLine('mobile speed is great.', 'perf', 'good')).toContain('color:#86c79b');
  });
  it('prefers the concrete wait time / count over the vague subject phrase', () => {
    expect(highlightBottomLine('Mobile loading is slow - visitors wait 6 to 10 seconds.', 'perf', 'poor'))
      .toContain('<span style="color:#ec8f7f; font-weight:700">6 to 10 seconds</span>');
    expect(highlightBottomLine('Pages keep visitors waiting 5.3s on a phone.', 'perf', 'fair')).toContain('>5.3s</span>');
    expect(highlightBottomLine('There are 11 high-impact issues across the site.', 'a11y', 'poor')).toContain('>11 high-impact issues</span>');
  });
  it('escapes html and leaves it un-highlighted when the label is absent', () => {
    const out = highlightBottomLine('A <b>clean</b> site overall.', 'perf');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<span');
  });
});

describe('parseNarrativeResponse', () => {
  it('parses a clean JSON object', () => {
    const raw = JSON.stringify({ schemaVersion: NARRATIVE_OVERLAY_SCHEMA_VERSION, bottomLine: 'x', perf: { verdictWord: 'Slow', verdictPara: 'p' } });
    const o = parseNarrativeResponse(raw);
    expect(o?.schemaVersion).toBe(NARRATIVE_OVERLAY_SCHEMA_VERSION);
    expect(o?.bottomLine).toBe('x');
    expect(o?.perf?.verdictWord).toBe('Slow');
  });
  it('tolerates a code fence around the JSON', () => {
    const o = parseNarrativeResponse(`\`\`\`json\n{"schemaVersion":${NARRATIVE_OVERLAY_SCHEMA_VERSION},"bottomLine":"hi"}\n\`\`\``);
    expect(o?.bottomLine).toBe('hi');
  });
  it('accepts a live response without schemaVersion and stamps it for cache writes', () => {
    const o = parseNarrativeResponse(JSON.stringify({ bottomLine: 'The clear gap is mobile speed.' }));
    expect(o?.schemaVersion).toBe(NARRATIVE_OVERLAY_SCHEMA_VERSION);
    expect(o?.bottomLine).toBe('The clear gap is mobile speed.');
  });
  it('returns null on junk', () => {
    expect(parseNarrativeResponse('not json at all')).toBeNull();
    expect(parseNarrativeResponse('{}')).toBeNull();
  });
  it('rejects old cache-shaped JSON when cache schema is required', () => {
    expect(parseNarrativeResponse(JSON.stringify({ bottomLine: 'The clear gap is mobile speed.' }), { requireSchemaVersion: true })).toBeNull();
    expect(parseNarrativeResponse(JSON.stringify({ schemaVersion: NARRATIVE_OVERLAY_SCHEMA_VERSION - 1, bottomLine: 'The clear gap is mobile speed.' }), { requireSchemaVersion: true })).toBeNull();
  });
});

describe('composeNarrative', () => {
  it('keeps deterministic copy when there is no overlay', () => {
    const base = buildDeterministicNarrative(facts());
    expect(composeNarrative(facts(), null)).toEqual(base);
  });
  it('overlays usable AI fields and re-highlights the bottom line', () => {
    const n = composeNarrative(facts({ worstDim: 'perf' }), {
      bottomLine: 'The clear gap is mobile speed right now.',
      perf: { verdictWord: 'Painfully slow' },
    });
    expect(n.perf.verdictWord).toBe('Painfully slow');
    expect(n.bottomLineHtml).toContain('<span style="color:#ec8f7f; font-weight:700">mobile speed</span>');
    // unspecified fields fall back to deterministic
    expect(n.perf.verdictPara).toContain('5.3s');
  });
  it('preserves clean AI prose that uses nonbreaking hyphenation', () => {
    const n = composeNarrative(facts({ worstDim: 'perf' }), {
      perf: { verdictPara: 'A well\u2011known mobile issue remains.' },
    });
    expect(n.perf.verdictPara).toBe('A well\u2011known mobile issue remains.');
  });
  it('rejects an over-long AI field and keeps the deterministic one', () => {
    const huge = 'x'.repeat(5000);
    const n = composeNarrative(facts(), { perf: { verdictPara: huge } });
    expect(n.perf.verdictPara).not.toBe(huge);
    expect(n.perf.verdictPara).toContain('5.3s');
  });
  it('rejects AI dollar amounts while keeping clean overlay prose', () => {
    const f = facts({ worstDim: 'perf' });
    const base = buildDeterministicNarrative(f);
    const n = composeNarrative(f, {
      bottomLine: 'The speed fix saves you $4,000 this month.',
      perf: { verdictWord: 'Painfully slow', verdictPara: 'Fixing this saves you $4,000 this month.' },
      a11y: { verdictPara: 'Screen reader and keyboard visitors still hit barriers on 4 pages.' },
    });

    expect(n.bottomLineHtml).toBe(base.bottomLineHtml);
    expect(n.perf.verdictWord).toBe('Painfully slow');
    expect(n.perf.verdictPara).toBe(base.perf.verdictPara);
    expect(n.a11y.verdictPara).toBe('Screen reader and keyboard visitors still hit barriers on 4 pages.');
  });
  it('rejects common dollar-denominated AI variants', () => {
    const f = facts({ worstDim: 'perf' });
    const base = buildDeterministicNarrative(f);

    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves USD 4,000 each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 4,000 USD each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 1 dollar per visit.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves \uff044,000 each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves thousands of dollars each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves \u20ac4,000 each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 20 bucks each order.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 5 grand each month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 4k a month.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
    expect(composeNarrative(f, { perf: { verdictPara: 'Fixing this saves 99 cents each visit.' } }).perf.verdictPara).toBe(base.perf.verdictPara);
  });
  it('rejects banned words in AI overlay fields', () => {
    const f = facts({ worstDim: 'agent' });
    const base = buildDeterministicNarrative(f);
    const n = composeNarrative(f, {
      bottomLine: 'The zero-click gap is AI visibility.',
      agent: { verdictWord: 'AI assistants', verdictPara: 'AI crawlers can read most of your content.' },
    });

    expect(n.bottomLineHtml).toBe(base.bottomLineHtml);
    expect(n.agent.verdictWord).toBe(base.agent.verdictWord);
    expect(n.agent.verdictPara).toBe('AI crawlers can read most of your content.');
    expect(composeNarrative(f, { bottomLine: 'The zero\u2013click gap is AI visibility.' }).bottomLineHtml).toBe(base.bottomLineHtml);
    expect(composeNarrative(f, { bottomLine: 'The zero\u2011click gap is AI visibility.' }).bottomLineHtml).toBe(base.bottomLineHtml);
  });
  it('rejects banned words hidden by format characters', () => {
    const f = facts({ worstDim: 'agent' });
    const base = buildDeterministicNarrative(f);
    const n = composeNarrative(f, { agent: { verdictWord: 'AI assis\u200btants' } });

    expect(n.agent.verdictWord).toBe(base.agent.verdictWord);
    expect(composeNarrative(f, { agent: { verdictWord: 'AI assis\u00adtants' } }).agent.verdictWord).toBe(base.agent.verdictWord);
  });
});

describe('buildNarrativePrompt', () => {
  it('forbids invented dollars and the shared banned-word list', () => {
    const prompt = buildNarrativePrompt(facts());
    expect(prompt).toContain('Never state or invent a dollar amount or price.');
    expect(prompt).toContain(`Never use these words: ${BANNED_WORDS.join(', ')}.`);
  });
});

describe('clientReportStatusWord', () => {
  it('maps the three statuses', () => {
    expect(clientReportStatusWord('good')).toBe('Good');
    expect(clientReportStatusWord('fair')).toBe('Needs work');
    expect(clientReportStatusWord('poor')).toBe('Poor');
  });
});

function perfPage(metrics: Record<string, number>): PagePerf {
  return {
    id: 'home',
    name: 'Home',
    startingPath: '/',
    chips: [],
    metrics: Object.fromEntries(Object.entries(metrics).map(([label, value]) => [label, { value, display: String(value) }])),
  };
}

function problem(kind: Problem['kind'], status: Problem['status'] = 'poor'): Problem {
  return { kind, severity: 1, status, headline: '', chip: '' };
}

function reportPerfInput(kind: Problem['kind'], status: Problem['status'], metrics: Record<string, number>): ClientReportPagePerfStatusInput {
  return { page: perfPage(metrics), lead: problem(kind, status) };
}

const tempResultDirs: string[] = [];

afterEach(() => {
  for (const dir of tempResultDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function displayMetric(label: string, value: number): string {
  if (label === 'LCP' || label === 'FCP' || label === 'TBT') return `${(value / 1000).toFixed(1)}s`;
  if (label === 'LH Score') return `${Math.round(value)}/100`;
  if (label === 'CLS') return (value / 100).toFixed(2);
  return String(value);
}

function pageSignals(over: Partial<PageSignals> = {}): PageSignals {
  const textWords = over.textWords ?? 400;
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
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['Product'], microdataItems: 0 },
    headings: { h1Count: 1, total: 3, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 6, nondescriptive: 0 },
    images: { total: 2, withAlt: 2 },
    textChars: textWords * 6,
    textWords,
    ...over,
  };
}

interface AgentFixture {
  rawWords: number;
  renderedWords: number;
  textSample?: string;
  rawOk?: boolean;
  rawBlocked?: boolean;
}

function agentReadinessFixture(url: string, agent: AgentFixture): AgentReadinessResult {
  const rendered = pageSignals({
    textWords: agent.renderedWords,
    ...(agent.textSample ? { textSample: agent.textSample } : {}),
  });
  const rawOk = agent.rawOk ?? true;
  const rawBlocked = agent.rawBlocked ?? false;
  const rawSignals = rawOk ? pageSignals({ textWords: agent.rawWords }) : null;
  return {
    url,
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 2 },
    fetchedAt: '2026-06-24T00:00:00.000Z',
    raw: {
      ok: rawOk,
      status: rawOk ? 200 : 500,
      contentType: rawOk ? 'text/html' : undefined,
      bytes: rawOk ? 1000 : undefined,
      likelyBlocked: rawBlocked,
      signals: rawSignals,
    },
    rendered,
    rawHtmlBytes: 1000,
    renderedHtmlBytes: 5000,
    ...(rawBlocked ? { blocked: true } : {}),
  };
}

interface PerfResultsOptions {
  throttleProfile?: string;
}

function writePerfResults(metrics: Record<string, number>, opts: PerfResultsOptions = {}): string {
  return writePerfResultsForPages([
    {
      id: 'home',
      name: 'Home',
      startingPath: '/',
      metrics,
    },
  ], opts);
}

function writePerfResultsForPages(
  pages: { id: string; name: string; startingPath: string; metrics: Record<string, number>; agent?: AgentFixture }[],
  opts: PerfResultsOptions = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-cr-report-'));
  tempResultDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({
    meta: {
      experimentUrl: 'http://localhost',
      generatedAt: '2026-06-24T00:00:00.000Z',
      ...(opts.throttleProfile ? { throttleProfile: opts.throttleProfile } : {}),
    },
    tests: pages.map((page) => ({
      id: page.id,
      name: page.name,
      startingPath: page.startingPath,
      viewport: { label: 'phone', width: 390, height: 844 },
    })),
  }, null, 2)}\n`);
  for (const page of pages) {
    fs.mkdirSync(path.join(dir, page.id), { recursive: true });
    fs.writeFileSync(path.join(dir, page.id, 'audit.json'), `${JSON.stringify({
      stage: 'audit',
      measurement: {
        metrics: Object.entries(page.metrics).map(([label, value]) => ({
          label,
          value,
          display: displayMetric(label, value),
        })),
      },
    }, null, 2)}\n`);
    if (page.agent) {
      const url = `http://localhost${page.startingPath || '/'}`;
      fs.writeFileSync(path.join(dir, page.id, 'agent-readiness.json'), `${JSON.stringify({
        kind: 'ok',
        stage: 'agent-readiness',
        measurement: agentReadinessFixture(url, page.agent),
      }, null, 2)}\n`);
    }
  }
  return dir;
}

describe('perfProblemPhrase', () => {
  it.each([
    ['slow-lcp', { LCP: 15400 }, 'biggest piece takes 15.4s to load'],
    ['layout-shift', {}, 'the layout jumps around'],
    ['blank', { FCP: 8200 }, 'screen stays blank for 8.2s'],
    ['late-paint', { FCP: 4100 }, 'nothing appears for 4.1s'],
    ['sluggish', {}, 'slow to react to taps'],
  ] as const)('maps %s to the exact exec-tile phrase', (kind, metrics, expected) => {
    expect(perfProblemPhrase(problem(kind), perfPage(metrics))).toBe(expected);
  });
});

describe('perfProblemTileCopy', () => {
  it.each([
    [
      'slow-lcp',
      {
        kicker: 'Mobile loading',
        wordTx: 'Main content is late',
        metricSub: 'worst page LCP; average LCP is 5.3s',
        conseq: 'The page starts, but the main content lands late enough that visitors may give up.',
      },
    ],
    [
      'layout-shift',
      {
        kicker: 'Mobile stability',
        wordTx: 'Layout jumps',
        metricSub: 'worst page layout-shift score; average LCP is 5.3s',
        conseq: 'Content moves while the page loads, so visitors can lose their place or tap the wrong thing.',
      },
    ],
    [
      'blank',
      {
        kicker: 'Mobile loading',
        wordTx: 'Blank screen first',
        metricSub: 'worst page first paint; average LCP is 5.3s',
        conseq: 'A visitor sees nothing at first, which can read as a broken page.',
      },
    ],
    [
      'late-paint',
      {
        kicker: 'Mobile loading',
        wordTx: 'Slow first paint',
        metricSub: 'worst page first paint; average LCP is 5.3s',
        conseq: 'The first pixels arrive late, so the page feels stalled before it starts.',
      },
    ],
    [
      'sluggish',
      {
        kicker: 'Mobile response',
        wordTx: 'Slow to react',
        metricSub: 'worst page blocking time; average LCP is 5.3s',
        conseq: 'The page may look loaded, but taps and scrolls can lag behind the visitor.',
      },
    ],
  ] as const)('maps %s to coherent exec-tile copy', (kind, expected) => {
    const copy = perfProblemTileCopy(problem(kind));
    expect(copy).toBeDefined();
    expect(copy && { ...copy, metricSub: copy.metricSub('5.3s') }).toEqual(expected);
  });

  it('does not create problem copy for clean pages', () => {
    expect(perfProblemTileCopy(problem('clean'))).toBeUndefined();
  });
});

describe('client report mobile-speed verdict calibration', () => {
  it.each([
    [2400, 'good'],
    [2600, 'good'],
    [3900, 'good'],
    [4500, 'fair'],
    [9000, 'fair'],
    [11000, 'poor'],
  ] as const)('classifies %dms LCP as %s for the client report site verdict', (ms, expected) => {
    expect(reportLcpStatus(ms)).toBe(expected);
  });

  it.each([
    [1200, 'good'],
    [2200, 'fair'],
    [3100, 'poor'],
    [4100, 'poor'],
  ] as const)('classifies %dms FCP as %s for the client report site verdict', (ms, expected) => {
    expect(reportFcpStatus(ms)).toBe(expected);
  });

  it.each([
    [9, 'good'],
    [15, 'fair'],
    [30, 'poor'],
  ] as const)('classifies %d/100 CLS as %s for the client report site verdict', (value, expected) => {
    expect(reportClsStatus(value)).toBe(expected);
  });

  it.each([
    [150, 'good'],
    [300, 'fair'],
    [700, 'poor'],
  ] as const)('classifies %dms TBT as %s for the client report site verdict', (ms, expected) => {
    expect(reportTbtStatus(ms)).toBe(expected);
  });

  it('relaxes LCP-bound pages up to 4.0s when aggregating the client report site perf status', () => {
    const page = reportPerfInput('slow-lcp', 'fair', { LCP: 3000 });
    const status = reportPerfStatus([page]);

    expect(reportPagePerfStatus(page)).toBe('good');
    expect(status).toBe('good');
    expect(buildDeterministicNarrative(facts({
      perf: { status, avgLabel: '3.0s', slowCount: 0, jumpyCount: 0, worst: [] },
    })).perf.verdictWord).toBe('Fine on phones');
  });

  it('keeps slower LCP-bound pages amber until the existing red cutoff', () => {
    const page = reportPerfInput('slow-lcp', 'fair', { LCP: 5000 });

    expect(reportPagePerfStatus(page)).toBe('fair');
    expect(reportPerfStatus([page])).toBe('fair');
  });

  it('does not relax non-LCP lead problems through the LCP band', () => {
    expect(reportPerfStatus([
      reportPerfInput('layout-shift', 'fair', { LCP: 3000, CLS: 15 }),
    ])).toBe('fair');
    expect(reportPerfStatus([
      reportPerfInput('slow-lcp', 'fair', { LCP: 3000 }),
      reportPerfInput('layout-shift', 'poor', { LCP: 3000, CLS: 30 }),
    ])).toBe('poor');
  });

  it('does not relax a late first paint through the LCP band', () => {
    const page = reportPerfInput('late-paint', 'fair', { LCP: 3700, FCP: 3600 });

    expect(reportPagePerfStatus(page)).toBe('poor');
    expect(reportPerfStatus([page])).toBe('poor');
  });

  it('treats a Lighthouse-red blocking-time problem as poor in the client report site verdict', () => {
    const page = reportPerfInput('sluggish', 'fair', { LCP: 1900, FCP: 900, TBT: 700 });

    expect(reportPagePerfStatus(page)).toBe('poor');
    expect(reportPerfStatus([page])).toBe('poor');
  });

  it('blocks the relaxed LCP verdict when raw first paint is not healthy', () => {
    const fair = reportPerfInput('slow-lcp', 'fair', { LCP: 3900, FCP: 2200, TBT: 50 });
    const poor = reportPerfInput('slow-lcp', 'fair', { LCP: 3900, FCP: 3400, TBT: 50 });

    expect(reportPagePerfStatus(fair)).toBe('fair');
    expect(reportPagePerfStatus(poor)).toBe('poor');
  });

  it('blocks the relaxed LCP verdict when raw blocking time is not healthy', () => {
    const fair = reportPerfInput('slow-lcp', 'fair', { LCP: 3500, FCP: 1200, TBT: 300 });
    const poor = reportPerfInput('slow-lcp', 'fair', { LCP: 3500, FCP: 1200, TBT: 650 });

    expect(reportPagePerfStatus(fair)).toBe('fair');
    expect(reportPagePerfStatus(poor)).toBe('poor');
  });

  it('lets a poor secondary problem outrank a relaxed LCP lead', () => {
    const page: ClientReportPagePerfStatusInput = {
      ...reportPerfInput('slow-lcp', 'fair', { LCP: 3000, CLS: 30 }),
      rest: [problem('layout-shift', 'poor')],
    };

    expect(reportPagePerfStatus(page)).toBe('poor');
    expect(reportPerfStatus([page])).toBe('poor');
  });

  it('lets a red TBT secondary problem outrank a relaxed LCP lead', () => {
    const page: ClientReportPagePerfStatusInput = {
      ...reportPerfInput('slow-lcp', 'fair', { LCP: 3500, FCP: 1200, TBT: 650 }),
      rest: [problem('sluggish', 'fair')],
    };

    expect(reportPagePerfStatus(page)).toBe('poor');
    expect(reportPerfStatus([page])).toBe('poor');
  });
});

function model(over: Partial<ClientReportModel> = {}): ClientReportModel {
  const n = buildDeterministicNarrative(facts());
  return {
    domain: 'www.example.com',
    dateStr: 'June 24, 2026',
    faviconLinkTag: '',
    lede: 'We loaded 6 pages.',
    tiles: [
      { target: 'perf', kicker: 'Mobile speed', status: 'poor', wordTx: 'Slow on phones', metric: '5.3s', metricSub: 'typical wait', conseq: 'They leave.' },
      { target: 'agent', kicker: 'AI visibility', status: 'good', wordTx: 'Good', metric: '85', metricSub: 'out of 100', conseq: 'Ahead.' },
    ],
    hasPerf: true,
    perfStatus: 'poor',
    perfCouldNotMeasure: false,
    perfCards: [
      {
        id: 'insights',
        name: 'Insights index',
        path: '/insights',
        liveUrl: 'https://www.example.com/insights',
        status: 'poor',
        headlineHtml: 'The screen stays <strong>blank for 8.2s</strong>',
        sub: 'It can read as broken.',
        videoUri: 'data:video/mp4;base64,AAAA',
        posterUri: 'data:image/avif;base64,BBBB',
        videoCap: 'Press play.',
        cues: [{ t: 0, x: 'Blank' }],
        frames: [
          { key: false, blank: true, label: 'Blank', time: '0.0s', imgUri: 'data:image/avif;base64,C', boxes: [] },
          { key: true, blank: false, beat: 'shift', label: 'Biggest piece', time: '8.2s', imgUri: 'data:image/avif;base64,D', boxes: [{ left: '10%', top: '20%', width: '30%', height: '5%' }] },
        ],
        totalFrames: 10,
        facts: [{ val: '1.3 MB', label: 'downloaded first', status: 'poor' }, { val: '42/100', label: 'speed score', status: 'poor' }],
        plain: 'Loads extremely slowly.',
      },
    ],
    perfFine: [{ name: 'Home', path: '/', status: 'good', note: 'Loads cleanly in 2.1s' }],
    hasA11y: false,
    a11yStatus: 'good',
    a11yCards: [],
    a11yFine: [],
    a11yBlocked: [],
    a11yCouldNotMeasure: false,
    hasAgent: true,
    agentStatus: 'good',
    agentSite: { score: 92, status: 'good', checks: [{ ok: 'ok', tx: 'AI crawlers allowed' }, { ok: 'na', tx: 'No llms.txt' }] },
    agentCards: [
      {
        name: 'Classic cards',
        path: '/cards',
        score: 75,
        status: 'fair',
        capped: false,
        headlineHtml: 'Social preview tags are missing',
        sub: 'Add them.',
        factors: [
          { name: 'Readable without running code', score: 79, status: 'fair' },
          { name: 'Clear structure & enough text', score: 53, status: 'fair' },
        ],
        fixes: ['Add social preview tags.'],
      },
    ],
    agentFine: [{ name: 'Insights', path: '/insights', score: 91, status: 'good' }],
    agentBlocked: [],
    agentCouldNotMeasure: false,
    narrative: n,
    outro: 'Outro text.',
    footnote: 'Footnote text.',
    ...over,
  };
}

function renderedTile(html: string, target: 'perf' | 'a11y' | 'agent'): string {
  const start = html.indexOf(`<button type="button" data-jump="${target}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const close = '      </button>';
  const end = html.indexOf(close, start);
  expect(end).toBeGreaterThanOrEqual(0);
  return html.slice(start, end + close.length);
}

function renderedPanel(html: string, target: 'perf' | 'a11y' | 'agent'): string {
  const start = html.indexOf(`<div class="cr-panel" id="cr-panel-${target}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextPanel = html.indexOf('\n\n  <div class="cr-panel"', start + 1);
  const outro = html.indexOf('\n\n  <div style="margin-top:46px;', start + 1);
  const end = nextPanel >= 0 ? nextPanel : outro;
  expect(end).toBeGreaterThanOrEqual(0);
  return html.slice(start, end);
}

function threeTabHeaderModel(over: Partial<ClientReportModel> = {}): ClientReportModel {
  return model({
    hasA11y: true,
    perfCards: [],
    perfFine: [],
    a11yCards: [],
    a11yFine: [],
    a11yBlocked: [],
    a11yCouldNotMeasure: false,
    agentSite: undefined,
    agentCards: [],
    agentFine: [],
    agentBlocked: [],
    agentCouldNotMeasure: false,
    tiles: [
      { target: 'perf', kicker: 'Mobile speed', status: 'poor', wordTx: 'Slow on phones', metric: '5.3s', metricSub: 'typical wait', conseq: 'They leave.' },
      { target: 'a11y', kicker: 'Accessibility', status: 'fair', wordTx: 'Needs work', metric: '2', metricSub: 'high-impact issues', conseq: 'Some visitors struggle.' },
      { target: 'agent', kicker: 'AI visibility', status: 'good', wordTx: 'Good', metric: '85', metricSub: 'out of 100', conseq: 'Ahead.' },
    ],
    ...over,
  });
}

describe('renderClientReport perf tile assembly', () => {
  it('writes and reuses a versioned narrative overlay cache', async () => {
    const dir = writePerfResults({ LCP: 8200, FCP: 1200, 'LH Score': 55 });
    let calls = 0;
    const narrate: NarrativeSummarizer = async () => {
      calls += 1;
      return {
        bottomLine: 'The clear gap is mobile speed right now.',
        perf: { verdictWord: 'Painfully slow' },
      };
    };

    const first = await renderClientReport(dir, { narrate });
    expect(first.html).toContain('Painfully slow');
    expect(calls).toBe(1);

    const cache = JSON.parse(fs.readFileSync(path.join(dir, 'client-narrative.json'), 'utf8')) as Record<string, unknown>;
    expect(cache.schemaVersion).toBe(NARRATIVE_OVERLAY_SCHEMA_VERSION);
    expect(cache.bottomLine).toBe('The clear gap is mobile speed right now.');

    const second = await renderClientReport(dir, { narrate });
    expect(second.html).toContain('Painfully slow');
    expect(calls).toBe(1);
  });

  it('reuses the legacy narrative overlay cache filename', async () => {
    const dir = writePerfResults({ LCP: 8200, FCP: 1200, 'LH Score': 55 });
    fs.writeFileSync(path.join(dir, 'client-narrative-v2.json'), `${JSON.stringify({
      schemaVersion: NARRATIVE_OVERLAY_SCHEMA_VERSION,
      perf: { verdictWord: 'Legacy cache' },
    })}\n`);
    const narrate: NarrativeSummarizer = async () => {
      throw new Error('should not regenerate');
    };

    const rendered = await renderClientReport(dir, { narrate });

    expect(rendered.html).toContain('Legacy cache');
    expect(fs.existsSync(path.join(dir, 'client-narrative.json'))).toBe(false);
  });

  it.each([
    [
      'slow-lcp',
      { LCP: 15400, FCP: 1500, 'LH Score': 35 },
      {
        kicker: 'Mobile loading',
        wordTx: 'Main content is late',
        metric: '15.4s',
        problemTx: 'biggest piece takes 15.4s to load',
        metricSub: 'worst page LCP; average LCP is 15.4s',
        absent: 'Slow on phones',
      },
    ],
    [
      'layout-shift',
      { LCP: 1800, FCP: 900, CLS: 45, 'LH Score': 91 },
      {
        kicker: 'Mobile stability',
        wordTx: 'Layout jumps',
        metric: '0.45',
        problemTx: 'the layout jumps around',
        metricSub: 'worst page layout-shift score; average LCP is 1.8s',
        absent: 'Slow on phones',
      },
    ],
    [
      'blank',
      { LCP: 9800, FCP: 9200, 'LH Score': 30 },
      {
        kicker: 'Mobile loading',
        wordTx: 'Blank screen first',
        metric: '9.2s',
        problemTx: 'screen stays blank for 9.2s',
        metricSub: 'worst page first paint; average LCP is 9.8s',
        absent: 'Slow on phones',
      },
    ],
    [
      'late-paint',
      { LCP: 4300, FCP: 4100, 'LH Score': 55 },
      {
        kicker: 'Mobile loading',
        wordTx: 'Slow first paint',
        metric: '4.1s',
        problemTx: 'nothing appears for 4.1s',
        metricSub: 'worst page first paint; average LCP is 4.3s',
        absent: 'A bit slow on phones',
      },
    ],
    [
      'sluggish',
      { LCP: 1900, FCP: 900, TBT: 2000, 'LH Score': 88 },
      {
        kicker: 'Mobile response',
        wordTx: 'Slow to react',
        metric: '2.0s',
        problemTx: 'slow to react to taps',
        metricSub: 'worst page blocking time; average LCP is 1.9s',
        absent: 'A bit slow on phones',
      },
    ],
  ] as const)('renders the %s dominant problem through the final perf tile', async (_kind, metrics, expected) => {
    const { html } = await renderClientReport(writePerfResults(metrics));
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain(expected.kicker);
    expect(perfTile).toContain(expected.wordTx);
    expect(perfTile).toContain(`>${expected.metric}</div>`);
    expect(perfTile).toContain(expected.problemTx);
    expect(perfTile).toContain(expected.metricSub);
    expect(perfTile).not.toContain(expected.absent);
  });

  it('keeps a clean assembled perf tile generic and without a problem line', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 1900, FCP: 800, CLS: 1, TBT: 50, 'LH Score': 98 }));
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('Mobile speed');
    expect(perfTile).toContain('Fine on phones');
    expect(perfTile).toContain('>1.9s</div>');
    expect(perfTile).toContain('typical wait before a page is usable');
    expect(perfTile).not.toContain('font-size:13px; line-height:1.35; font-weight:700;');
    expect(perfTile).not.toContain('jumps around');
  });

  it('keeps the 3.7s LCP page card honest while the narrative verdict reads fine', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 3700, FCP: 1200, 'LH Score': 76 }));
    const perfTile = renderedTile(html, 'perf');

    expect(html).toContain('Fine on phones');
    expect(html).toContain('The biggest piece of the page takes <strong>3.7s</strong> to appear');
    expect(html).toContain('page cards still show');
    expect(html).not.toContain('Every check we could run looks healthy');
    expect(perfTile).toContain('Mobile speed');
    expect(perfTile).toContain('Fine on phones');
    expect(perfTile).toContain('Pages load fine on a phone');
    expect(perfTile).not.toContain('Main content is late');
    expect(perfTile).not.toContain('biggest piece takes 3.7s to load');
    expect(perfTile).not.toContain('visitors may give up');
  });

  it('does not let the relaxed LCP band hide a late first paint in the rendered report', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 3700, FCP: 3600, 'LH Score': 76 }));

    expect(html).toContain('Slow on phones');
    expect(html).toContain('Nothing appears for the first <strong>3.6s</strong>');
  });

  it('uses the non-relaxed problem for the exec tile when a relaxed LCP page is mixed with another issue', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 3000, FCP: 1200, CLS: 1, TBT: 50, 'LH Score': 82 } },
      { id: 'products', name: 'Products', startingPath: '/products', metrics: { LCP: 1900, FCP: 900, CLS: 15, TBT: 50, 'LH Score': 90 } },
    ]));
    const perfTile = renderedTile(html, 'perf');

    expect(perfTile).toContain('Layout jumps');
    expect(perfTile).toContain('the layout jumps around');
    expect(perfTile).not.toContain('Main content is late');
    expect(perfTile).not.toContain('biggest piece takes 3.0s to load');
  });

  it('uses the TBT rest problem for the exec tile when it drives a relaxed-LCP page status', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 3500, FCP: 1200, TBT: 650, 'LH Score': 76 }));
    const perfTile = renderedTile(html, 'perf');

    expect(perfTile).toContain('Slow to react');
    expect(perfTile).toContain('>0.7s</div>');
    expect(perfTile).toContain('slow to react to taps');
    expect(perfTile).not.toContain('Main content is late');
    expect(perfTile).not.toContain('biggest piece takes 3.5s to load');
    expect(html).toContain('laggy to tap');
    expect(html).not.toContain('biggest piece at 3.5s');
  });

  it('renders a relaxed LCP more-row as good in the compact fine list', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 3000, FCP: 1200, CLS: 1, TBT: 50, 'LH Score': 82 } },
      { id: 'home-scroll', name: 'Home scroll', startingPath: '/', metrics: { LCP: 3020, FCP: 1200, CLS: 1, TBT: 50, 'LH Score': 82 } },
    ]));

    expect(html).toContain('Loading fine &middot; 1 page');
    expect(html).not.toContain('The rest of the pages we checked &middot; 1 page');
  });

  it('keeps an unmeasured assembled perf tile neutral and without a problem line', async () => {
    const { html } = await renderClientReport(writePerfResults({}));
    const perfTile = renderedTile(html, 'perf');
    const perfPanelHtml = renderedPanel(html, 'perf');
    expect(perfTile).toContain('Mobile speed');
    expect(perfTile).toContain('Could not measure');
    expect(perfTile).toContain('>n/a</div>');
    expect(perfTile).toContain('no usable mobile speed data');
    expect(perfTile).not.toContain('font-size:13px; line-height:1.35; font-weight:700;');
    expect(perfPanelHtml).not.toContain('challenge page instead of the real page, so this could not be measured');
    expect(perfPanelHtml).not.toContain('>not measured</span>');
    expect(html).not.toContain('A bit slow on phones');
    expect(html).toContain('The audit did not return enough mobile speed data to make a speed claim.');
  });

  it('keeps a zero performance score in the tab header', async () => {
    const { html } = await renderClientReport(writePerfResults({ 'LH Score': 0 }));
    expect(renderedPanel(html, 'perf')).toContain('<div style="font-size:24px; font-weight:800; color:#a85f00; line-height:1">0</div>');
  });

  it('uses the worst page metric on the tile and labels the site average separately', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 2000, FCP: 900, 'LH Score': 95 } },
      { id: 'products', name: 'Products', startingPath: '/products', metrics: { LCP: 15400, FCP: 1200, 'LH Score': 35 } },
    ]));
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('>15.4s</div>');
    expect(perfTile).toContain('biggest piece takes 15.4s to load');
    expect(perfTile).toContain('worst page LCP; average LCP is 8.7s');
  });

  it('builds perf cost from the dominant perf problem and the page download metrics', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 2000, FCP: 900, 'LH Score': 95, downloads: 5120, js: 120, 'js-count': 2 } },
      { id: 'products', name: 'Products', startingPath: '/products', metrics: { LCP: 15400, FCP: 1200, 'LH Score': 35, downloads: 12800, 'downloads-before-LCP': 4096, js: 640, 'js-count': 9 } },
    ], { throttleProfile: 'Slow-4G' }));
    const perfTile = renderedTile(html, 'perf');
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfTile).toContain('>15.4s</div>');
    expect(perfTile).toContain('biggest piece takes 15.4s to load');
    expect(perfPanelHtml).toContain('15.4s before your main content appears on a mid-range phone');
    expect(perfPanelHtml).toContain('>measured</span>');
    expect(perfPanelHtml).toContain('https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%2Fproducts');
    expect(perfPanelHtml).toContain('same phone and network profile we used');
    expect(perfPanelHtml).toContain('What this affects');
    expect(perfPanelHtml).toContain('data-copy-prompt="cr-perf-site-prompt"');
    expect(perfPanelHtml).toContain('each visit to this page downloads 12.5 MB');
    expect(perfPanelHtml).toContain('~= $0.03-0.08 of mobile data per visit');
    expect(perfPanelHtml).not.toContain('$0.10-0.30');
    expect(perfPanelHtml).not.toContain('~= $0.00');
    expect(perfPanelHtml).toMatch(/>measured<\/span><span>each visit to this page downloads 12\.5 MB<\/span>/);
    expect(perfPanelHtml).toMatch(/>estimated<\/span><span>~= \$0\.03-0\.08 of mobile data per visit<\/span><button type="button" data-disclose="cr-perf-data-cost-estimate"/);
    expect(perfPanelHtml).toContain('how we estimated this');
    expect(perfPanelHtml).toContain('Main content time: 15.4s.');
    expect(perfPanelHtml).toContain('JavaScript: 640 KB across 9 files.');
    expect(perfPanelHtml).toContain('Total transferred before LCP: 4096 KB.');
    expect(perfPanelHtml).toContain('data-copy-prompt="cr-perf-card-0-products"');
    expect(findBannedWords(perfPanelHtml)).toEqual([]);
  });

  it('does not claim PageSpeed uses the same profile when the audit did not record one', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 15400, FCP: 1200, 'LH Score': 35 }));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain('Google&#39;s standard phone profile');
    expect(perfPanelHtml).toContain('we used a profile not recorded in this audit, so numbers may differ');
    expect(perfPanelHtml).not.toContain('same phone and network profile we used');
  });

  it('derives zero perf cost for a good report and does not render perf copy buttons', async () => {
    const { html } = await renderClientReport(writePerfResults({
      LCP: 1900,
      FCP: 800,
      CLS: 1,
      TBT: 50,
      'LH Score': 98,
      downloads: 12800,
      js: 120,
      'js-count': 2,
    }));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain(NOTHING_TO_FIX);
    expect(perfPanelHtml).toContain('>measured</span>');
    expect(perfPanelHtml).not.toContain('cr-perf-site-prompt');
    expect(perfPanelHtml).not.toContain('cr-perf-card');
    expect(perfPanelHtml).not.toContain('how we estimated this');
  });

  it('does not attach LCP fix prompts to non-LCP perf cards or good relaxed-LCP reports', async () => {
    const layoutShift = await renderClientReport(writePerfResults({
      LCP: 1900,
      FCP: 900,
      CLS: 45,
      TBT: 50,
      'LH Score': 91,
      downloads: 12800,
      js: 120,
      'js-count': 2,
    }));
    const layoutShiftPanel = renderedPanel(layoutShift.html, 'perf');
    expect(layoutShiftPanel).toContain('The page <strong>jumps around</strong> as it loads');
    expect(layoutShiftPanel).toContain('Layout shifts make the page feel unstable');
    expect(layoutShiftPanel).toContain('each visit to this page downloads 12.5 MB');
    expect(layoutShiftPanel).not.toContain('cr-perf-site-prompt');
    expect(layoutShiftPanel).not.toContain('cr-perf-card');

    const relaxedLcp = await renderClientReport(writePerfResults({
      LCP: 3700,
      FCP: 1200,
      CLS: 1,
      TBT: 50,
      'LH Score': 76,
      downloads: 12800,
      js: 120,
      'js-count': 2,
    }));
    expect(renderedPanel(relaxedLcp.html, 'perf')).toContain(NOTHING_TO_FIX);
    expect(renderedPanel(relaxedLcp.html, 'perf')).not.toContain('cr-perf-card');
  });

  it('does not attach an LCP fix prompt to a good relaxed-LCP card in a poor site report', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 3700, FCP: 1200, CLS: 1, TBT: 50, 'LH Score': 76, js: 120, 'js-count': 2 } },
      { id: 'products', name: 'Products', startingPath: '/products', metrics: { LCP: 15400, FCP: 1200, 'LH Score': 35, js: 640, 'js-count': 9 } },
    ], { throttleProfile: 'Slow-4G' }));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain('data-copy-prompt="cr-perf-card-0-products"');
    expect(perfPanelHtml).not.toContain('data-copy-prompt="cr-perf-card-1-home"');
  });

  it('does not borrow another page download metric for the perf data-cost row', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'slow', name: 'Slow page', startingPath: '/slow', metrics: { LCP: 15400, FCP: 1200, 'LH Score': 35, js: 640, 'js-count': 9 } },
      { id: 'heavy', name: 'Heavy page', startingPath: '/heavy', metrics: { LCP: 1900, FCP: 900, 'LH Score': 95, downloads: 12800, js: 120, 'js-count': 2 } },
    ]));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain('15.4s before your main content appears on a mid-range phone');
    expect(perfPanelHtml).toContain('https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%2Fslow');
    expect(perfPanelHtml).not.toContain('each visit to this page downloads 12.5 MB');
    expect(perfPanelHtml).not.toContain('~= $0.03-0.08 of mobile data per visit');
  });

  it('keeps the perf cost banner on a page that has a visible card', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'tbt-1', name: 'TBT 1', startingPath: '/tbt-1', metrics: { LCP: 1900, FCP: 900, TBT: 1700, 'LH Score': 72 } },
      { id: 'tbt-2', name: 'TBT 2', startingPath: '/tbt-2', metrics: { LCP: 1900, FCP: 900, TBT: 1690, 'LH Score': 72 } },
      { id: 'tbt-3', name: 'TBT 3', startingPath: '/tbt-3', metrics: { LCP: 1900, FCP: 900, TBT: 1680, 'LH Score': 72 } },
      { id: 'tbt-4', name: 'TBT 4', startingPath: '/tbt-4', metrics: { LCP: 1900, FCP: 900, TBT: 1670, 'LH Score': 72 } },
      { id: 'tbt-5', name: 'TBT 5', startingPath: '/tbt-5', metrics: { LCP: 1900, FCP: 900, TBT: 1660, 'LH Score': 72 } },
      { id: 'hidden-cls', name: 'Hidden CLS', startingPath: '/hidden-cls', metrics: { LCP: 1900, FCP: 900, CLS: 26, 'LH Score': 91 } },
    ], { throttleProfile: 'Slow-4G' }));
    const perfTile = renderedTile(html, 'perf');
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfTile).toContain('Slow to react');
    expect(perfTile).toContain('slow to react to taps');
    expect(perfTile).not.toContain('Layout jumps');
    expect(perfTile).not.toContain('the layout jumps around');
    expect(perfPanelHtml).toContain('TBT 1');
    expect(perfPanelHtml).toContain('slow to react to taps on a mid-range phone');
    expect(perfPanelHtml).toContain('https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%2Ftbt-1');
    expect(perfPanelHtml).not.toContain('https://pagespeed.web.dev/analysis?url=http%3A%2F%2Flocalhost%2Fhidden-cls');
    expect(perfPanelHtml).not.toContain('the layout jumps around on a mid-range phone');
  });

  it('prioritizes a poor-status problem over a higher-severity fair problem', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 8200, FCP: 1200, 'LH Score': 55 } },
      { id: 'details', name: 'Details', startingPath: '/details', metrics: { LCP: 1800, FCP: 900, CLS: 26, 'LH Score': 91 } },
    ]));
    const perfTile = renderedTile(html, 'perf');
    const perfPanelHtml = renderedPanel(html, 'perf');
    expect(perfTile).toContain('Layout jumps');
    expect(perfTile).toContain('>0.26</div>');
    expect(perfTile).toContain('the layout jumps around');
    expect(perfTile).not.toContain('biggest piece takes 8.2s to load');
    expect(perfPanelHtml).toContain('the layout jumps around on a mid-range phone');
    expect(perfPanelHtml).not.toContain('0.26 before your main content appears');
    expect(perfPanelHtml).not.toContain('cr-perf-site-prompt');
  });

  it('uses the worst reachable page for the AI cost headline, check line, and prompt', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'shell',
        name: 'Shell page',
        startingPath: '/shell',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 100, textSample: 'Important product details appear after browser code runs' },
      },
      {
        id: 'ssr',
        name: 'SSR page',
        startingPath: '/ssr',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 900, renderedWords: 100, textSample: 'Server rendered content is already present' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('100% of your page&#39;s text is missing');
    expect(agentPanelHtml).toContain('only 0 of 100 words present');
    expect(agentPanelHtml).not.toContain(NOTHING_TO_FIX);
    expect(agentPanelHtml).toContain('check it yourself: open view-source:http://localhost/shell');
    expect(agentPanelHtml).toContain('0% content coverage: 0 raw HTML words vs 100 rendered words');
  });

  it('keeps a measured AI cost block when the overall agent score is good but page text is missing', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'mostly-readable',
        name: 'Mostly readable',
        startingPath: '/mostly-readable',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 80, renderedWords: 100, textSample: 'A sentence that appears after browser code runs' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('20% of your page&#39;s text is missing');
    expect(agentPanelHtml).toContain('only 80 of 100 words present');
    expect(agentPanelHtml).toContain('Copy prompt for your agent');
    expect(agentPanelHtml).not.toContain(NOTHING_TO_FIX);
  });

  it('derives zero AI cost through the client report model only when reachable page text is fully present', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'ssr',
        name: 'SSR page',
        startingPath: '/ssr',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 120, renderedWords: 120, textSample: 'Server rendered content is already present' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain(NOTHING_TO_FIX);
    expect(agentPanelHtml).toContain('>measured</span>');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
    expect(agentPanelHtml).not.toContain('industry data');
  });

  it('derives no-claim AI cost through the client report model when reachable rendered text is too small', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'tiny',
        name: 'Tiny page',
        startingPath: '/tiny',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 12, textSample: 'Tiny page' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('almost no text to compare');
    expect(agentPanelHtml).toContain('>measured</span>');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
    expect(agentPanelHtml).not.toContain('industry data');
  });

  it('does not let a sub-20-word page become the measured AI cost headline', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'ssr',
        name: 'SSR page',
        startingPath: '/ssr',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 1000, renderedWords: 1000, textSample: 'Server rendered content is already present' },
      },
      {
        id: 'thin',
        name: 'Thin page',
        startingPath: '/thin',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 2, renderedWords: 15, textSample: 'Tiny rendered page' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain(NOTHING_TO_FIX);
    expect(agentPanelHtml).not.toContain('87% of your page&#39;s text is missing');
    expect(agentPanelHtml).not.toContain('only 2 of 15 words present');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
  });

  it('keeps AI cost no-claim when all reachable pages are thin even if their aggregate word count is above the floor', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'thin-a',
        name: 'Thin A',
        startingPath: '/thin-a',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 15, textSample: 'Tiny rendered page A' },
      },
      {
        id: 'thin-b',
        name: 'Thin B',
        startingPath: '/thin-b',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 10, textSample: 'Tiny rendered page B' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('almost no text to compare');
    expect(agentPanelHtml).not.toContain('100% of your page&#39;s text is missing');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
  });

  it('does not render copy prompts or no-claim text when raw HTML could not be read', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'raw-failed',
        name: 'Raw failed page',
        startingPath: '/raw-failed',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 220, rawOk: false, textSample: 'Rendered text exists but the raw fetch failed' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('We could not read the page the server sends, so this text gap was not measured.');
    expect(agentPanelHtml).toContain('>not measured</span>');
    expect(agentPanelHtml).not.toContain('almost no text to compare');
    expect(agentPanelHtml).not.toContain('Copy prompt');
    expect(agentPanelHtml).not.toContain('0 raw HTML words vs 220 rendered words');
  });

  it('keeps the bot-wall intro when blocked pages are listed beside a raw-fetch failure', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      {
        id: 'blocked',
        name: 'Blocked page',
        startingPath: '/blocked',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 220, rawBlocked: true, textSample: 'Challenge page' },
      },
      {
        id: 'raw-failed',
        name: 'Raw failed page',
        startingPath: '/raw-failed',
        metrics: { LCP: 1900, FCP: 900, 'LH Score': 95 },
        agent: { rawWords: 0, renderedWords: 220, rawOk: false, textSample: 'Rendered text exists but the raw fetch failed' },
      },
    ]));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('We could not read the page the server sends, so this text gap was not measured.');
    expect(agentPanelHtml).toContain('bot protection served our checker a challenge page instead of the real page');
    expect(agentPanelHtml).toContain('Blocked page');
  });
});

describe('renderClientReportHtml', () => {
  it('renders a self-contained document with the masthead, bottom line and tiles', () => {
    const html = renderClientReportHtml(model());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('www.example.com');
    expect(html).toContain('The bottom line');
    expect(html).toContain(model().narrative.bottomLineHtml);
    expect(html).toContain('data-jump="perf"');
    expect(html).toContain('data-jump="agent"');
  });

  it('renders a perf tile problem phrase between the metric and sub-label', () => {
    const m = model();
    m.tiles[0] = { ...m.tiles[0], problemTx: 'biggest piece takes 15.4s to load' };
    const perfTile = renderedTile(renderClientReportHtml(m), 'perf');
    expect(perfTile).toContain('biggest piece takes 15.4s to load');
    expect(perfTile).toContain(`<div style="font-size:30px; font-weight:800; letter-spacing:-.02em; color:#26221d; line-height:1; margin-bottom:4px">5.3s</div>
        <div style="font-size:13px; line-height:1.35; font-weight:700; color:#c0271f; margin:2px 0 4px">biggest piece takes 15.4s to load</div>
        <div style="font-size:12.5px; color:#9b9286; margin-bottom:13px">typical wait</div>`);
  });

  it('leaves the perf tile byte-identical when no problem phrase is present', () => {
    const perfTile = renderedTile(renderClientReportHtml(model()), 'perf');
    expect(perfTile).not.toContain('biggest piece takes');
    expect(perfTile).toBe(`<button type="button" data-jump="perf" class="cr-tile" style="--soft:#fdf0ee; text-align:left; cursor:pointer; appearance:none; font-family:inherit; background:#ffffff; border:1px solid #f0c4bd; border-top:3px solid #c0271f; border-radius:14px; padding:18px 18px 16px; display:flex; flex-direction:column; gap:0">
        <div style="font-size:12px; font-weight:600; letter-spacing:.02em; color:#9b9286; margin-bottom:11px">Mobile speed</div>
        <div style="font-size:23px; font-weight:800; letter-spacing:-.02em; color:#c0271f; line-height:1.05; margin-bottom:13px">Slow on phones</div>
        <div style="font-size:30px; font-weight:800; letter-spacing:-.02em; color:#26221d; line-height:1; margin-bottom:4px">5.3s</div>
        <div style="font-size:12.5px; color:#9b9286; margin-bottom:13px">typical wait</div>
        <div style="font-size:13.5px; line-height:1.5; color:#4a443c">They leave.</div>
      </button>`);
  });

  it('shows a tab bar with one button per present section', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('data-tab="perf"');
    expect(html).toContain('data-tab="agent"');
    expect(html).not.toContain('data-tab="a11y"'); // a11y absent in this model
  });

  it('renders one score badge in each tab header when all three tab scores are present', () => {
    const html = renderClientReportHtml(threeTabHeaderModel({
      perfScore: 42,
      a11yStatus: 'fair',
      a11yScore: 88,
      agentScore: 85,
    }));
    expect(html.match(/>score<\/div>/g)).toHaveLength(3);

    expect(renderedPanel(html, 'perf')).toContain('display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:10px');
    expect(renderedPanel(html, 'perf')).toContain('<div style="font-size:24px; font-weight:800; color:#c0271f; line-height:1">42</div>');
    expect(renderedPanel(html, 'a11y')).toContain('<div style="font-size:24px; font-weight:800; color:#a85f00; line-height:1">88</div>');
    expect(renderedPanel(html, 'agent')).toContain('<div style="font-size:24px; font-weight:800; color:#2f7d4f; line-height:1">85</div>');
  });

  it('omits tab header score badges when the score is unavailable or the tab is blocked', () => {
    const html = renderClientReportHtml(threeTabHeaderModel({
      perfScore: undefined,
      a11yScore: 88,
      a11yCouldNotMeasure: true,
      a11yBlocked: [{ name: 'Products', path: '/products' }],
      agentScore: 85,
      agentCouldNotMeasure: true,
      agentBlocked: [{ name: 'Home', path: '/' }],
    }));
    expect(renderedPanel(html, 'perf')).not.toContain('>score</div>');
    expect(renderedPanel(html, 'a11y')).not.toContain('>score</div>');
    expect(renderedPanel(html, 'agent')).not.toContain('>score</div>');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('switches report tabs without forcing the viewport to scroll', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('function show(id)');
    expect(html).toContain("p.hidden = (p.id !== 'cr-panel-' + id)");
    expect(html).not.toContain('window.scrollTo');
  });

  it('ships shared disclosure toggle plumbing and print force-open CSS', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('[data-disclose]{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;color:#26221d}');
    expect(html).toContain('[data-disclosure][hidden]{display:block!important}');
    expect(html).toContain('Disclosure contract: button uses data-disclose="<target-id>"; target uses');
    expect(html).toContain("if(!target || !target.hasAttribute('data-disclosure')) return null;");
    expect(html).toContain("document.querySelectorAll('[data-disclose]').forEach(function(control){");
    expect(html).toContain("var control = e.target && e.target.closest && e.target.closest('[data-disclose]');");
    expect(html).toContain('target.hidden = !willOpen;');
    expect(html).toContain("control.setAttribute('aria-controls', target.id);");
    expect(html).toContain("control.setAttribute('aria-expanded', target.hidden ? 'false' : 'true');");
    expect(html).toContain("document.querySelectorAll('[data-copy-prompt]').forEach(function(btn){");
    expect(html).toContain('navigator.clipboard.writeText(text)');
    expect(html).toContain("document.execCommand('copy')");
    expect(html).toContain('document.body.appendChild(ta)');
    expect(html).toContain("label.textContent = ok ? 'Copied' : 'Copy failed'");
    expect(html).toContain("label.textContent = 'Copy failed'");
    expect(html).toContain('}).catch(function(){');
    expect(html).toContain('window.setTimeout(function(){ label.textContent = original; }, 2000)');
  });

  it('keeps rendered static copy free of banned cost wording', () => {
    const html = renderClientReportHtml(model({
      // Narrative copy is owned separately; this keeps the assertion on renderer
      // static strings and script/CSS text.
      narrative: {
        bottomLineHtml: 'Mobile speed is the main gap today.',
        perf: { verdictWord: 'Slow on phones', verdictPara: 'Pages are slow on phones.' },
        a11y: { verdictWord: '', verdictPara: '' },
        agent: { verdictWord: 'Good', verdictPara: 'AI crawlers can read the site.' },
      },
    }));

    expect(findBannedWords(html)).toEqual([]);
  });

  it('keeps rendered AI cost treatment free of banned cost wording', () => {
    const html = renderClientReportHtml(model({
      agentCost: {
        tab: 'ai',
        state: 'measured',
        headline: "72% of your page's text is missing from the page the server sends, before any JavaScript runs",
        headlineSub: 'only 180 of 642 words present',
        checkLine: 'check it yourself: open view-source:https://www.example.com/cards and search for a sentence from your page',
        affectsProse: 'AI search and answer tools usually read the HTML first.',
        sitePrompt: 'Fix the initial HTML for the site.',
        stats: [...AI_INDUSTRY_DATA_STATS],
      },
      narrative: {
        bottomLineHtml: 'AI visibility is the main gap today.',
        perf: { verdictWord: 'Slow on phones', verdictPara: 'Pages are slow on phones.' },
        a11y: { verdictWord: '', verdictPara: '' },
        agent: { verdictWord: 'Hard to read', verdictPara: 'AI crawlers miss important page text.' },
      },
    }));

    expect(findBannedWords(html)).toEqual([]);
  });

  it('leaves perf and a11y panels byte-identical when only agentCost is added', () => {
    const base = threeTabHeaderModel({
      a11yCards: [
        {
          name: 'Products',
          path: '/products',
          score: 88,
          status: 'fair',
          sev: [{ num: 3, label: 'high-impact', status: 'poor' }],
          summary: 'Hard to use by keyboard.',
          frames: [],
          fixes: ['Darken the light text.'],
        },
      ],
    });
    const withoutCost = renderClientReportHtml(base);
    const withCost = renderClientReportHtml({
      ...base,
      agentCost: {
        tab: 'ai',
        state: 'measured',
        headline: "72% of your page's text is missing from the page the server sends, before any JavaScript runs",
        headlineSub: 'only 180 of 642 words present',
        checkLine: 'check it yourself: open view-source:https://www.example.com/cards and search for a sentence from your page',
        affectsProse: 'AI search and answer tools usually read the HTML first.',
        sitePrompt: 'Fix the initial HTML for the site.',
        stats: [...AI_INDUSTRY_DATA_STATS],
      },
    });

    expect(renderedPanel(withCost, 'perf')).toBe(renderedPanel(withoutCost, 'perf'));
    expect(renderedPanel(withCost, 'a11y')).toBe(renderedPanel(withoutCost, 'a11y'));
  });

  it('renders a neutral "could not measure" accessibility tab (no frames, no findings) when a bot wall blocked the scan', () => {
    const html = renderClientReportHtml(model({
      hasA11y: true,
      a11yStatus: 'good',
      a11yCards: [],
      a11yFine: [],
      a11yBlocked: [{ name: 'Homepage', path: '/' }, { name: 'Album', path: '/albums/x' }],
      a11yCouldNotMeasure: true,
      tiles: [
        { target: 'perf', kicker: 'Mobile speed', status: 'poor', wordTx: 'Slow on phones', metric: '5.3s', metricSub: 'typical wait', conseq: 'They leave.' },
        { target: 'a11y', kicker: 'Accessibility', status: 'good', wordTx: 'Could not measure', metric: 'n/a', metricSub: '2 pages blocked by bot protection', conseq: 'Bot protection served a challenge page.', blocked: true },
      ],
      narrative: {
        bottomLineHtml: 'The real gap is mobile speed. Some checks could not run.',
        perf: { verdictWord: 'Slow on phones', verdictPara: 'Slow.' },
        a11y: { verdictWord: 'Could not measure', verdictPara: 'Your site bot protection served a challenge page.' },
        agent: { verdictWord: 'Good', verdictPara: 'Fine.' },
      },
    }));
    expect(html).toContain('data-tab="a11y"');
    expect(html).toContain('Could not measure');
    expect(html).toContain('blocked by bot protection');
    expect(html).toContain('Homepage');
    expect(html).toContain('Album');
    // A blocked dimension shows NO measurement frame (a frame is shown only for a real measure).
    expect(html).not.toContain('Screenshot of the page with accessibility issues');
  });

  it('renders a neutral "could not measure" AI visibility tab (no scorecard) when a bot wall blocked the agent scan', () => {
    const html = renderClientReportHtml(model({
      hasAgent: true,
      agentStatus: 'good',
      agentSite: undefined,
      agentCards: [],
      agentFine: [],
      agentBlocked: [{ name: 'Homepage', path: '/' }],
      agentCouldNotMeasure: true,
      tiles: [
        { target: 'perf', kicker: 'Mobile speed', status: 'poor', wordTx: 'Slow on phones', metric: '5.3s', metricSub: 'typical wait', conseq: 'They leave.' },
        { target: 'agent', kicker: 'AI visibility', status: 'good', wordTx: 'Could not measure', metric: 'n/a', metricSub: '1 page blocked by bot protection', conseq: 'Bot protection served a challenge page.', blocked: true },
      ],
      narrative: {
        bottomLineHtml: 'The real gap is mobile speed.',
        perf: { verdictWord: 'Slow on phones', verdictPara: 'Slow.' },
        a11y: { verdictWord: '', verdictPara: '' },
        agent: { verdictWord: 'Could not measure', verdictPara: 'Your site bot protection served a challenge page.' },
      },
    }));
    expect(html).toContain('data-tab="agent"');
    expect(html).toContain('Could not measure');
    expect(html).toContain('blocked by bot protection');
    expect(html).toContain('Homepage');
    // No agent scorecard when blocked.
    expect(html).not.toContain('Can AI reach your site at all?');
  });

  it('omits the tab bar when only one section is present', () => {
    const html = renderClientReportHtml(model({ hasAgent: false, tiles: [] }));
    expect(html).not.toContain('class="cr-tabs"');
  });

  it('opens on the first PRESENT section even when Performance is absent', () => {
    const html = renderClientReportHtml(
      model({
        hasPerf: false,
        perfCards: [],
        perfFine: [],
        hasA11y: true,
        a11yCards: [
          { name: 'Products', path: '/products', score: 88, status: 'fair', sev: [{ num: 3, label: 'high-impact', status: 'poor' }], summary: 's', frames: [], fixes: ['x'] },
        ],
        // hasAgent stays true (from base model)
      }),
    );
    // a11y is the first present section -> visible (no hidden); agent -> hidden.
    expect(html).toContain('id="cr-panel-a11y" role="tabpanel">');
    expect(html).toContain('id="cr-panel-agent" role="tabpanel" hidden>');
    expect(html).not.toContain('id="cr-panel-perf"');
  });

  it('injects the real video into the .loadvid-screen and carries the cue track', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('class="loadvid-screen"');
    expect(html).toContain('data:video/mp4;base64,AAAA');
    expect(html).toContain('data-cues=');
  });

  it('renders perf facts colored by status and the filmstrip frames', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('1.3 MB');
    expect(html).toContain('Biggest piece');
    expect(html).toContain('Frame by frame');
    expect(html).toContain('border:2px solid rgba(192,39,31,.9); background:rgba(192,39,31,.18)');
    expect(html).not.toContain('rgba(208,69,76,.18)');
  });

  it('renders agent factor bars and the site-access checks', () => {
    const html = renderClientReportHtml(model());
    expect(html).toContain('Readable without running code');
    expect(html).toContain('width:79%');
    expect(html).toContain('Can AI reach your site at all?');
    expect(html).toContain('AI crawlers allowed');
  });

  it('renders the measured AI cost block, copy prompt controls, and industry data expander', () => {
    const html = renderClientReportHtml(model({
      agentCost: {
        tab: 'ai',
        state: 'measured',
        headline: "72% of your page's text is missing from the page the server sends, before any JavaScript runs",
        headlineSub: 'only 180 of 642 words present',
        chip: 'measured',
        checkLine: 'check it yourself: open view-source:https://www.example.com/cards and search for a sentence from your page',
        affectsProse: 'AI search and answer tools usually read the HTML first.',
        sitePrompt: 'Fix the initial HTML for the site.',
        stats: [...AI_INDUSTRY_DATA_STATS],
      },
      agentCards: model().agentCards.map((card) => ({ ...card, copyPrompt: 'Fix this page card.' })),
    }));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('72% of your page&#39;s text is missing');
    expect(agentPanelHtml).toContain('only 180 of 642 words present');
    expect(agentPanelHtml).toContain('>measured</span>');
    expect(agentPanelHtml).toContain('check it yourself: open view-source:https://www.example.com/cards');
    expect(agentPanelHtml).toContain('What this affects');
    expect(agentPanelHtml).toContain('Copy prompt for your agent');
    expect(agentPanelHtml).toContain('data-copy-prompt="cr-ai-site-prompt"');
    expect(agentPanelHtml).toContain('width:190px');
    expect(agentPanelHtml).toContain('<pre id="cr-ai-site-prompt" data-disclosure hidden');
    expect(agentPanelHtml).toContain('industry data');
    expect(agentPanelHtml).toContain('Ahrefs, Dec 2025');
    expect(agentPanelHtml).toContain('GSQI, Aug 2025');
    expect(agentPanelHtml).toContain('data-copy-prompt="cr-agent-card-0-cards"');
    expect(agentPanelHtml).toContain('width:118px');
    expect(agentPanelHtml).toContain('Fix this page card.');
  });

  it('renders the measured perf cost block, data-cost chips, estimator toggle, and card prompt', () => {
    const html = renderClientReportHtml(model({
      perfCost: {
        tab: 'perf',
        state: 'measured',
        headline: '15.4s before your main content appears on a mid-range phone',
        chip: 'measured',
        checkLine: 'check it yourself: run PageSpeed Insights on this page - same phone and network profile we used: https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fwww.example.com%2Finsights',
        affectsProse: 'Slow main content and heavy downloads make mobile visitors wait.',
        sitePrompt: 'Fix the site speed.',
        dataCost: {
          measuredLine: 'each visit to this page downloads 12.5 MB',
          estimatedLine: '~= $0.03-0.08 of mobile data per visit',
          formula: '12.5 MB measured on this page x $0.0026-$0.0060 per MB',
        },
      },
      perfCards: model().perfCards.map((card) => ({ ...card, copyPrompt: 'Fix this performance card.' })),
    }));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain('15.4s before your main content appears on a mid-range phone');
    expect(perfPanelHtml).toContain('>measured</span>');
    expect(perfPanelHtml).toContain('https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fwww.example.com%2Finsights');
    expect(perfPanelHtml).toContain('What this affects');
    expect(perfPanelHtml).toContain('Copy prompt for your agent');
    expect(perfPanelHtml).toContain('data-copy-prompt="cr-perf-site-prompt"');
    expect(perfPanelHtml).toContain('width:190px');
    expect(perfPanelHtml).toMatch(/>measured<\/span><span>each visit to this page downloads 12\.5 MB<\/span>/);
    expect(perfPanelHtml).toMatch(/>estimated<\/span><span>~= \$0\.03-0\.08 of mobile data per visit<\/span><button type="button" data-disclose="cr-perf-data-cost-estimate"/);
    expect(perfPanelHtml).toContain('how we estimated this');
    expect(perfPanelHtml).toContain('<div id="cr-perf-data-cost-estimate" data-disclosure hidden');
    expect(perfPanelHtml).toContain('12.5 MB measured on this page x $0.0026-$0.0060 per MB');
    expect(perfPanelHtml).toContain('data-copy-prompt="cr-perf-card-0-insights"');
    expect(perfPanelHtml).toContain('width:118px');
    expect(perfPanelHtml.indexOf('data-copy-prompt="cr-perf-card-0-insights"')).toBeGreaterThan(perfPanelHtml.indexOf('Loads extremely slowly.'));
  });

  it('renders zero-state perf cost copy without prompt controls or data-cost rows', () => {
    const html = renderClientReportHtml(model({
      perfCost: {
        tab: 'perf',
        state: 'zero',
        sitePrompt: 'Do not show this prompt.',
        dataCost: {
          measuredLine: 'each visit to this page downloads 12.5 MB',
          estimatedLine: '~= $0.03-0.08 of mobile data per visit',
          formula: 'hidden',
        },
      },
    }));
    const perfPanelHtml = renderedPanel(html, 'perf');

    expect(perfPanelHtml).toContain(NOTHING_TO_FIX);
    expect(perfPanelHtml).toContain('>measured</span>');
    expect(perfPanelHtml).not.toContain('Do not show this prompt.');
    expect(perfPanelHtml).not.toContain('cr-perf-site-prompt');
    expect(perfPanelHtml).not.toContain('each visit to this page downloads');
    expect(perfPanelHtml).not.toContain('how we estimated this');
  });

  it('leaves AI and a11y panels byte-identical when only perfCost and perf card prompts are added', () => {
    const base = threeTabHeaderModel({
      perfCards: model().perfCards,
      perfFine: model().perfFine,
      a11yCards: [
        {
          name: 'Products',
          path: '/products',
          score: 88,
          status: 'fair',
          sev: [{ num: 3, label: 'high-impact', status: 'poor' }],
          summary: 'Hard to use by keyboard.',
          frames: [],
          fixes: ['Darken the light text.'],
        },
      ],
      agentSite: model().agentSite,
      agentCards: model().agentCards,
      agentFine: model().agentFine,
    });
    const withoutPerfCost = renderClientReportHtml(base);
    const withPerfCost = renderClientReportHtml({
      ...base,
      perfCost: {
        tab: 'perf',
        state: 'measured',
        headline: '15.4s before your main content appears on a mid-range phone',
        chip: 'measured',
        checkLine: 'check it yourself: run PageSpeed Insights on this page - same phone and network profile we used: https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fwww.example.com%2Finsights',
        affectsProse: 'Slow main content and heavy downloads make mobile visitors wait.',
        sitePrompt: 'Fix the site speed.',
      },
      perfCards: base.perfCards.map((card) => ({ ...card, copyPrompt: 'Fix this performance card.' })),
    });

    expect(renderedPanel(withPerfCost, 'agent')).toBe(renderedPanel(withoutPerfCost, 'agent'));
    expect(renderedPanel(withPerfCost, 'a11y')).toBe(renderedPanel(withoutPerfCost, 'a11y'));
  });

  it('renders zero-state AI cost copy without prompt controls or industry data', () => {
    const html = renderClientReportHtml(model({
      agentCost: {
        tab: 'ai',
        state: 'zero',
        sitePrompt: 'Do not show this prompt.',
        stats: [...AI_INDUSTRY_DATA_STATS],
      },
    }));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain(NOTHING_TO_FIX);
    expect(agentPanelHtml).toContain('>measured</span>');
    expect(agentPanelHtml).not.toContain('Do not show this prompt.');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
    expect(agentPanelHtml).not.toContain('industry data');
  });

  it('renders blocked-state AI cost copy as not measured and hides computed numbers', () => {
    const html = renderClientReportHtml(model({
      agentCost: {
        tab: 'ai',
        state: 'blocked',
        sitePrompt: 'Do not show this prompt.',
      },
    }));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(BOT_WALL_COPY).toContain('challenge page instead of the real page');
    expect(agentPanelHtml).toContain('challenge page instead of the real page, so this could not be measured');
    expect(agentPanelHtml).toContain('>not measured</span>');
    expect(agentPanelHtml).not.toContain('Do not show this prompt.');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
  });

  it('renders no-claim AI cost copy without prompt controls or industry data', () => {
    const html = renderClientReportHtml(model({
      agentCost: {
        tab: 'ai',
        state: 'noclaim',
        sitePrompt: 'Do not show this prompt.',
        stats: [...AI_INDUSTRY_DATA_STATS],
      },
    }));
    const agentPanelHtml = renderedPanel(html, 'agent');

    expect(agentPanelHtml).toContain('almost no text to compare');
    expect(agentPanelHtml).toContain('>measured</span>');
    expect(agentPanelHtml).not.toContain('Do not show this prompt.');
    expect(agentPanelHtml).not.toContain('Copy prompt for your agent');
    expect(agentPanelHtml).not.toContain('industry data');
  });

  it('escapes page names so markup in data cannot break out', () => {
    const m = model();
    m.perfCards[0].name = '<script>alert(1)</script>';
    const html = renderClientReportHtml(m);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the a11y panel with score badge, sev chips and shots when present', () => {
    const html = renderClientReportHtml(
      model({
        hasA11y: true,
        a11yCards: [
          {
            name: 'Products',
            path: '/products',
            score: 88,
            status: 'fair',
            sev: [{ num: 3, label: 'high-impact', status: 'poor' }],
            summary: 'Hard to use by keyboard.',
            frames: [{ imgUri: 'data:image/avif;base64,E', boxes: [{ left: '5%', top: '5%', width: '10%', height: '10%', hi: true }], cap: 'Low-contrast text', count: 4 }],
            fixes: ['Darken the light text.'],
          },
        ],
      }),
    );
    expect(html).toContain('data-tab="a11y"');
    expect(html).toContain('class="a11y-shot');
    expect(html).toContain('3 high-impact');
    expect(html).toContain('Darken the light text.');
  });

  it('renders the whole-page a11y fallback (count 0) with no spots suffix and a wider figure', () => {
    const html = renderClientReportHtml(
      model({
        hasA11y: true,
        a11yCards: [
          {
            name: 'Home',
            path: '/',
            score: 71,
            status: 'fair',
            sev: [{ num: 1, label: 'high-impact', status: 'poor' }],
            summary: 'The page structure has barriers.',
            frames: [{ imgUri: 'data:image/avif;base64,E', boxes: [], cap: 'No spot is highlighted because this problem lives in how the whole page is built.', count: 0 }],
            fixes: ['Fix the structure.'],
          },
        ],
      }),
    );
    expect(html).toContain('width:240px');
    expect(html).toContain('lives in how the whole page is built');
    expect(html).not.toContain('0 spot');
  });
});
