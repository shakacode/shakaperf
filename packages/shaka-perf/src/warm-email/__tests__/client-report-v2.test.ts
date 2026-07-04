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
  buildDeterministicNarrative,
  composeNarrative,
  highlightBottomLine,
  parseNarrativeResponse,
  type NarrativeFacts,
} from '../client-report-narrative';
import { perfProblemPhrase, perfProblemTileCopy, renderClientReport, type Problem } from '../client-report';
import { renderClientReportV2, v2StatusWord, type ClientReportV2Model } from '../client-report-v2';
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
    const raw = JSON.stringify({ bottomLine: 'x', perf: { verdictWord: 'Slow', verdictPara: 'p' } });
    const o = parseNarrativeResponse(raw);
    expect(o?.bottomLine).toBe('x');
    expect(o?.perf?.verdictWord).toBe('Slow');
  });
  it('tolerates a code fence around the JSON', () => {
    const o = parseNarrativeResponse('```json\n{"bottomLine":"hi"}\n```');
    expect(o?.bottomLine).toBe('hi');
  });
  it('returns null on junk', () => {
    expect(parseNarrativeResponse('not json at all')).toBeNull();
    expect(parseNarrativeResponse('{}')).toBeNull();
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
  it('rejects an over-long AI field and keeps the deterministic one', () => {
    const huge = 'x'.repeat(5000);
    const n = composeNarrative(facts(), { perf: { verdictPara: huge } });
    expect(n.perf.verdictPara).not.toBe(huge);
    expect(n.perf.verdictPara).toContain('5.3s');
  });
});

describe('v2StatusWord', () => {
  it('maps the three statuses', () => {
    expect(v2StatusWord('good')).toBe('Good');
    expect(v2StatusWord('fair')).toBe('Needs work');
    expect(v2StatusWord('poor')).toBe('Poor');
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

function problem(kind: Problem['kind']): Problem {
  return { kind, severity: 1, status: 'poor', headline: '', chip: '' };
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

function writePerfResults(metrics: Record<string, number>): string {
  return writePerfResultsForPages([
    {
      id: 'home',
      name: 'Home',
      startingPath: '/',
      metrics,
    },
  ]);
}

function writePerfResultsForPages(pages: { id: string; name: string; startingPath: string; metrics: Record<string, number> }[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-v2-report-'));
  tempResultDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({
    meta: { experimentUrl: 'http://localhost', generatedAt: '2026-06-24T00:00:00.000Z' },
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

function model(over: Partial<ClientReportV2Model> = {}): ClientReportV2Model {
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
          { key: true, blank: false, label: 'Biggest piece', time: '8.2s', imgUri: 'data:image/avif;base64,D', boxes: [{ left: '10%', top: '20%', width: '30%', height: '5%' }] },
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

describe('renderClientReport v2 perf tile assembly', () => {
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
    const { html } = await renderClientReport(writePerfResults(metrics), { design: 'v2' });
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain(expected.kicker);
    expect(perfTile).toContain(expected.wordTx);
    expect(perfTile).toContain(`>${expected.metric}</div>`);
    expect(perfTile).toContain(expected.problemTx);
    expect(perfTile).toContain(expected.metricSub);
    expect(perfTile).not.toContain(expected.absent);
  });

  it('keeps a clean assembled perf tile generic and without a problem line', async () => {
    const { html } = await renderClientReport(writePerfResults({ LCP: 1900, FCP: 800, CLS: 1, TBT: 50, 'LH Score': 98 }), { design: 'v2' });
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('Mobile speed');
    expect(perfTile).toContain('Fast on phones');
    expect(perfTile).toContain('>1.9s</div>');
    expect(perfTile).toContain('typical wait before a page is usable');
    expect(perfTile).not.toContain('font-size:13px; line-height:1.35; font-weight:700;');
    expect(perfTile).not.toContain('jumps around');
  });

  it('keeps an unmeasured assembled perf tile neutral and without a problem line', async () => {
    const { html } = await renderClientReport(writePerfResults({}), { design: 'v2' });
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('Mobile speed');
    expect(perfTile).toContain('Could not measure');
    expect(perfTile).toContain('>n/a</div>');
    expect(perfTile).toContain('no usable mobile speed data');
    expect(perfTile).not.toContain('font-size:13px; line-height:1.35; font-weight:700;');
    expect(html).not.toContain('A bit slow on phones');
    expect(html).toContain('The audit did not return enough mobile speed data to make a speed claim.');
  });

  it('uses the worst page metric on the tile and labels the site average separately', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 2000, FCP: 900, 'LH Score': 95 } },
      { id: 'products', name: 'Products', startingPath: '/products', metrics: { LCP: 15400, FCP: 1200, 'LH Score': 35 } },
    ]), { design: 'v2' });
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('>15.4s</div>');
    expect(perfTile).toContain('biggest piece takes 15.4s to load');
    expect(perfTile).toContain('worst page LCP; average LCP is 8.7s');
  });

  it('prioritizes a poor-status problem over a higher-severity fair problem', async () => {
    const { html } = await renderClientReport(writePerfResultsForPages([
      { id: 'home', name: 'Home', startingPath: '/', metrics: { LCP: 8200, FCP: 7999, 'LH Score': 55 } },
      { id: 'details', name: 'Details', startingPath: '/details', metrics: { LCP: 1800, FCP: 900, CLS: 26, 'LH Score': 91 } },
    ]), { design: 'v2' });
    const perfTile = renderedTile(html, 'perf');
    expect(perfTile).toContain('Layout jumps');
    expect(perfTile).toContain('>0.26</div>');
    expect(perfTile).toContain('the layout jumps around');
    expect(perfTile).not.toContain('nothing appears for 8.0s');
  });
});

describe('renderClientReportV2', () => {
  it('renders a self-contained document with the masthead, bottom line and tiles', () => {
    const html = renderClientReportV2(model());
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
    const perfTile = renderedTile(renderClientReportV2(m), 'perf');
    expect(perfTile).toContain('biggest piece takes 15.4s to load');
    expect(perfTile).toContain(`<div style="font-size:30px; font-weight:800; letter-spacing:-.02em; color:#26221d; line-height:1; margin-bottom:4px">5.3s</div>
        <div style="font-size:13px; line-height:1.35; font-weight:700; color:#b14a3c; margin:2px 0 4px">biggest piece takes 15.4s to load</div>
        <div style="font-size:12.5px; color:#9b9286; margin-bottom:13px">typical wait</div>`);
  });

  it('leaves the perf tile byte-identical when no problem phrase is present', () => {
    const perfTile = renderedTile(renderClientReportV2(model()), 'perf');
    expect(perfTile).not.toContain('biggest piece takes');
    expect(perfTile).toBe(`<button type="button" data-jump="perf" class="v2-tile" style="--soft:#fbeeeb; text-align:left; cursor:pointer; appearance:none; font-family:inherit; background:#ffffff; border:1px solid #eccbc2; border-top:3px solid #b14a3c; border-radius:14px; padding:18px 18px 16px; display:flex; flex-direction:column; gap:0">
        <div style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#9b9286; margin-bottom:11px">Mobile speed</div>
        <div style="font-size:23px; font-weight:800; letter-spacing:-.02em; color:#b14a3c; line-height:1.05; margin-bottom:13px">Slow on phones</div>
        <div style="font-size:30px; font-weight:800; letter-spacing:-.02em; color:#26221d; line-height:1; margin-bottom:4px">5.3s</div>
        <div style="font-size:12.5px; color:#9b9286; margin-bottom:13px">typical wait</div>
        <div style="font-size:13.5px; line-height:1.5; color:#4a443c">They leave.</div>
      </button>`);
  });

  it('shows a tab bar with one button per present section', () => {
    const html = renderClientReportV2(model());
    expect(html).toContain('data-tab="perf"');
    expect(html).toContain('data-tab="agent"');
    expect(html).not.toContain('data-tab="a11y"'); // a11y absent in this model
  });

  it('switches report tabs without forcing the viewport to scroll', () => {
    const html = renderClientReportV2(model());
    expect(html).toContain('function show(id)');
    expect(html).toContain("p.hidden = (p.id !== 'v2-panel-' + id)");
    expect(html).not.toContain('window.scrollTo');
  });

  it('renders a neutral "could not measure" accessibility tab (no frames, no findings) when a bot wall blocked the scan', () => {
    const html = renderClientReportV2(model({
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
    const html = renderClientReportV2(model({
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
    const html = renderClientReportV2(model({ hasAgent: false, tiles: [] }));
    expect(html).not.toContain('class="v2-tabs"');
  });

  it('opens on the first PRESENT section even when Performance is absent', () => {
    const html = renderClientReportV2(
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
    expect(html).toContain('id="v2-panel-a11y" role="tabpanel">');
    expect(html).toContain('id="v2-panel-agent" role="tabpanel" hidden>');
    expect(html).not.toContain('id="v2-panel-perf"');
  });

  it('injects the real video into the .loadvid-screen and carries the cue track', () => {
    const html = renderClientReportV2(model());
    expect(html).toContain('class="loadvid-screen"');
    expect(html).toContain('data:video/mp4;base64,AAAA');
    expect(html).toContain('data-cues=');
  });

  it('renders perf facts colored by status and the filmstrip frames', () => {
    const html = renderClientReportV2(model());
    expect(html).toContain('1.3 MB');
    expect(html).toContain('Biggest piece');
    expect(html).toContain('Frame by frame');
  });

  it('renders agent factor bars and the site-access checks', () => {
    const html = renderClientReportV2(model());
    expect(html).toContain('Readable without running code');
    expect(html).toContain('width:79%');
    expect(html).toContain('Can AI reach your site at all?');
    expect(html).toContain('AI crawlers allowed');
  });

  it('escapes page names so markup in data cannot break out', () => {
    const m = model();
    m.perfCards[0].name = '<script>alert(1)</script>';
    const html = renderClientReportV2(m);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the a11y panel with score badge, sev chips and shots when present', () => {
    const html = renderClientReportV2(
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
    const html = renderClientReportV2(
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
