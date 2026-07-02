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
import sharp from 'sharp';
import {
  a11yCropFrames,
  a11yFrameSummary,
  a11yIssuesHtml,
  compareA11yWorstFirst,
  enrichA11ySummaries,
  hasMajorA11yBarrier,
  pageHasCleanA11y,
  readA11yClient,
  scoreBucket,
  tallyByImpact,
} from '../client-report';
import type { A11ySummarizer, A11ySummaryRequest, A11ySummaryResult } from '../client-report';
import { a11yIssueLabel, isStructuralA11yRule } from '../../audit/stages/accessibility/report-utils';
import type { PagePerf } from '../synthesis';
import type {
  AccessibilityResult,
  AccessibilityScan,
  AccessibilityViolation,
} from '../../audit/stages/accessibility/types';

function viol(impact: AccessibilityViolation['impact']): AccessibilityViolation {
  // One node so `places` (nodes.length) is a realistic 1, not 0, in enrich requests.
  return { ruleId: 'rule', impact, help: 'Some help', helpUrl: '', tags: [], nodes: [{ target: ['button'], html: '<button></button>', failureSummary: '' }] };
}

function scan(violations: AccessibilityViolation[]): AccessibilityScan {
  return {
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 412, height: 823, formFactor: 'mobile', deviceScaleFactor: 1.75 } as AccessibilityScan['viewport'],
    url: 'https://example.com/',
    violations,
  };
}

function result(scans: AccessibilityScan[]): AccessibilityResult {
  return { scans, totalViolations: 0, failOnViolation: true, effectiveConfig: { tags: [], disableRules: [], includeRules: null } };
}

function page(a11y?: AccessibilityResult): PagePerf {
  return { id: 'p', name: 'P', startingPath: '/', chips: [], metrics: {}, ...(a11y ? { a11y } : {}) };
}

describe('tallyByImpact', () => {
  it('counts each impact bucket', () => {
    expect(tallyByImpact([viol('critical'), viol('serious'), viol('moderate'), viol('minor')]))
      .toEqual({ critical: 1, serious: 1, moderate: 1, minor: 1 });
  });

  it('folds null/unknown impact into minor so the tallies match the rendered list', () => {
    // axe can emit impact: null; it must still be counted somewhere, or the
    // rollup/pill (tally-based) and the per-card list (all violations) disagree.
    const c = tallyByImpact([viol('critical'), viol(null), viol(null)]);
    expect(c).toEqual({ critical: 1, serious: 0, moderate: 0, minor: 2 });
    expect(c.critical + c.serious + c.moderate + c.minor).toBe(3);
  });
});

describe('hasMajorA11yBarrier', () => {
  it('is true only when a page has a serious or critical issue (gets a card)', () => {
    expect(hasMajorA11yBarrier(tallyByImpact([viol('critical')]))).toBe(true);
    expect(hasMajorA11yBarrier(tallyByImpact([viol('serious')]))).toBe(true);
    expect(hasMajorA11yBarrier(tallyByImpact([viol('serious'), viol('moderate')]))).toBe(true);
  });

  it('is false for moderate/minor-only pages (folded into the no-major-barriers line, no card)', () => {
    expect(hasMajorA11yBarrier(tallyByImpact([viol('moderate')]))).toBe(false);
    expect(hasMajorA11yBarrier(tallyByImpact([viol('minor')]))).toBe(false);
    expect(hasMajorA11yBarrier(tallyByImpact([viol('moderate'), viol('minor')]))).toBe(false);
    expect(hasMajorA11yBarrier(tallyByImpact([]))).toBe(false);
  });
});

describe('scoreBucket', () => {
  it('maps Lighthouse-style thresholds (>=90 good, 50-89 fair, <50 poor)', () => {
    expect(scoreBucket(100)).toBe('good');
    expect(scoreBucket(90)).toBe('good');
    expect(scoreBucket(89)).toBe('fair');
    expect(scoreBucket(50)).toBe('fair');
    expect(scoreBucket(49)).toBe('poor');
    expect(scoreBucket(0)).toBe('poor');
  });
});

describe('compareA11yWorstFirst', () => {
  const counts = (critical: number, serious: number, moderate = 0, minor = 0) => ({ critical, serious, moderate, minor });
  const rank = (c: ReturnType<typeof counts>, score?: number, startingPath = '/x/') => ({ counts: c, score, startingPath });
  const order = (rows: ReturnType<typeof rank>[]) => [...rows].sort(compareA11yWorstFirst).map((r) => r.startingPath);

  it('ranks by the worst Lighthouse score first - the number shown on the card', () => {
    // saylesteam.com: Homepage (80, 2 high-impact) leads Honolulu (89, 4); About
    // (96, only critical) sorts last - score leads, not high-impact count.
    const home = rank(counts(0, 2, 2), 80, '/');
    const honolulu = rank(counts(0, 4, 1), 89, '/oahu/honolulu-condos/');
    const about = rank(counts(1, 1, 1), 96, '/about/');
    expect(order([about, honolulu, home])).toEqual(['/', '/oahu/honolulu-condos/', '/about/']);
  });

  it('breaks an equal-score tie by the breadth of high-impact barriers', () => {
    expect(order([rank(counts(0, 2), 90, '/a/'), rank(counts(0, 4), 90, '/b/')])).toEqual(['/b/', '/a/']);
  });

  it('within equal score and high-impact, a critical outranks a serious-only page', () => {
    expect(order([rank(counts(0, 2), 85, '/nocrit/'), rank(counts(1, 1), 85, '/crit/')])).toEqual(['/crit/', '/nocrit/']);
  });

  it('puts the homepage first on a full tie, then orders by path', () => {
    expect(order([rank(counts(0, 2), 80, '/about/'), rank(counts(0, 2), 80, '/')])).toEqual(['/', '/about/']);
  });

  it('sorts an unscored page (a11y run timed out) after scored ones, even if it has more issues', () => {
    expect(order([rank(counts(0, 9), undefined, '/unscored/'), rank(counts(0, 2), 70, '/scored/')])).toEqual(['/scored/', '/unscored/']);
  });

  it('orders two unscored pages by high-impact breadth, not path', () => {
    expect(order([rank(counts(0, 2), undefined, '/a/'), rank(counts(0, 4), undefined, '/z/')])).toEqual(['/z/', '/a/']);
  });

  it('breaks a score+high-impact+critical tie by more moderate issues', () => {
    expect(order([rank(counts(0, 2, 1), 85, '/a/'), rank(counts(0, 2, 3), 85, '/z/')])).toEqual(['/z/', '/a/']);
  });
});

describe('pageHasCleanA11y', () => {
  it('is true only for a real scan with zero violations', () => {
    expect(pageHasCleanA11y(page(result([scan([])])))).toBe(true);
  });

  it('is false for a page with violations', () => {
    expect(pageHasCleanA11y(page(result([scan([viol('minor')])])))).toBe(false);
  });

  it('is false for an UNMEASURED page (empty scans array) - never claim it clean', () => {
    // The bug this guards: scans: [] must not be reported as "no issues detected".
    expect(pageHasCleanA11y(page(result([])))).toBe(false);
  });

  it('is false when the page has no accessibility data at all', () => {
    expect(pageHasCleanA11y(page(undefined))).toBe(false);
  });
});

describe('readA11yClient', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-client-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSidecar(pageId: string, body: string): void {
    const pageDir = path.join(dir, pageId);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'accessibility-client.json'), body);
  }

  it('reads score, summary and fixes', () => {
    writeSidecar('page1', JSON.stringify({ score: 84, summary: 'plain', fixes: ['a', 'b'] }));
    expect(readA11yClient(dir, 'page1')).toEqual({ score: 84, summary: 'plain', fixes: ['a', 'b'] });
  });

  it('returns undefined when the sidecar is missing', () => {
    expect(readA11yClient(dir, 'nope')).toBeUndefined();
  });

  it('returns undefined (does not throw) on malformed JSON', () => {
    writeSidecar('page1', 'not json at all');
    expect(readA11yClient(dir, 'page1')).toBeUndefined();
  });

  it('ignores wrong-typed fields and drops non-string fixes', () => {
    writeSidecar('page1', JSON.stringify({ score: 'high', summary: 5, fixes: ['ok', 1, 'two'] }));
    expect(readA11yClient(dir, 'page1')).toEqual({ score: undefined, summary: undefined, fixes: ['ok', 'two'] });
  });

  it('treats an empty fixes array as absent', () => {
    writeSidecar('page1', JSON.stringify({ summary: 'x', fixes: [] }));
    expect(readA11yClient(dir, 'page1')).toEqual({ score: undefined, summary: 'x', fixes: undefined });
  });

  it('does not read outside the results dir (path traversal contained)', () => {
    expect(readA11yClient(dir, '../../etc')).toBeUndefined();
  });
});

describe('a11yIssueLabel', () => {
  it('maps the common axe rules to short plain labels', () => {
    expect(a11yIssueLabel('color-contrast')).toBe('low-contrast text');
    expect(a11yIssueLabel('button-name')).toBe('unlabeled buttons');
    expect(a11yIssueLabel('svg-img-alt')).toBe('images without text');
    expect(a11yIssueLabel('label')).toBe('unlabeled form fields');
    expect(a11yIssueLabel('nested-interactive')).toBe('nested controls');
    expect(a11yIssueLabel('region')).toBe('page section labels');
    expect(a11yIssueLabel('heading-order')).toBe('heading structure');
  });

  it('folds the whole aria-* family into one screen-reader label', () => {
    expect(a11yIssueLabel('aria-allowed-attr')).toBe("controls screen readers can't read");
    expect(a11yIssueLabel('aria-valid-attr-value')).toBe("controls screen readers can't read");
    expect(a11yIssueLabel('aria-required-children')).toBe("controls screen readers can't read");
  });

  it('treats aria-input-field-name as a form-field label, not the aria bucket', () => {
    expect(a11yIssueLabel('aria-input-field-name')).toBe('unlabeled form fields');
  });

  it('falls back for an unknown rule', () => {
    expect(a11yIssueLabel('some-future-rule')).toBe('other issues');
  });
});

describe('isStructuralA11yRule', () => {
  it('marks document-structure rules as structural (no client crop)', () => {
    for (const rule of [
      'heading-order',
      'heading-skipped', // covers the startsWith('heading') branch beyond heading-order
      'page-has-heading-one',
      'empty-heading',
      'landmark-one-main',
      'landmark-unique',
      'landmark-no-duplicate-banner',
      'region',
      'list',
      'listitem',
      'definition-list',
      'dlitem',
      'aria-required-children',
      'aria-required-parent',
      'duplicate-id',
      'duplicate-id-active',
      'duplicate-id-aria',
      'bypass',
      'aria-hidden-body',
      'html-has-lang',
      'html-lang-valid',
      'html-xml-lang-mismatch',
      'valid-lang',
      'document-title',
    ]) {
      expect(isStructuralA11yRule(rule)).toBe(true);
    }
  });

  it('marks spatial rules (something to point at on screen) as not structural', () => {
    for (const rule of [
      'color-contrast',
      'button-name',
      'link-name',
      'image-alt',
      'svg-img-alt',
      'label',
      'frame-title',
      'nested-interactive',
      'scrollable-region-focusable',
    ]) {
      expect(isStructuralA11yRule(rule)).toBe(false);
    }
  });

  it('treats an unknown rule as spatial so a useful crop is not dropped', () => {
    expect(isStructuralA11yRule('some-future-rule')).toBe(false);
  });
});

describe('a11yCropFrames structural filter (integration)', () => {
  // A real (tiny) screenshot so sharp can decode and extract a crop window.
  async function shotDataUri(width: number, height: number): Promise<string> {
    const buf = await sharp({ create: { width, height, channels: 3, background: { r: 210, g: 210, b: 210 } } })
      .png()
      .toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
  }

  function scanWith(ruleId: string, impact: AccessibilityViolation['impact'], imageDataUri: string): AccessibilityScan {
    return {
      viewportLabel: 'phone',
      viewport: { label: 'phone', width: 400, height: 800, formFactor: 'mobile', deviceScaleFactor: 1 } as AccessibilityScan['viewport'],
      url: 'https://example.com/',
      screenshot: { width: 400, height: 800, imageHref: 'a11y.png', imageDataUri },
      violations: [
        {
          ruleId,
          impact,
          help: 'h',
          helpUrl: '',
          tags: [],
          nodes: [{ target: ['#x'], html: '<x>', failureSummary: '', bounds: { x: 20, y: 120, width: 200, height: 24 } }],
        },
      ],
    };
  }

  // This is the regression guard for the reported bug: a structural-only page
  // (heading-order) must NOT render a screenshot crop. The classifier being
  // correct is not enough - this locks the actual filter wiring + banding.
  it('produces no crop for a structural-only scan (heading-order)', async () => {
    const frames = await a11yCropFrames(scanWith('heading-order', 'moderate', await shotDataUri(400, 800)));
    expect(frames).toEqual([]);
  }, 20000);

  it('still produces a crop for a spatial violation (color-contrast)', async () => {
    const frames = await a11yCropFrames(scanWith('color-contrast', 'serious', await shotDataUri(400, 800)));
    expect(frames.length).toBeGreaterThanOrEqual(1);
  }, 20000);

  it('v2 blank-skip keeps the color-contrast band and skips a flat non-contrast band', async () => {
    // Both bands are flat grey; color-contrast is exempt from blank-skip, so it (not the link-name fallback) survives.
    const img = await shotDataUri(400, 800);
    const scan: AccessibilityScan = {
      viewportLabel: 'phone',
      viewport: { label: 'phone', width: 400, height: 800, formFactor: 'mobile', deviceScaleFactor: 1 } as AccessibilityScan['viewport'],
      url: 'https://example.com/',
      screenshot: { width: 400, height: 800, imageHref: 'a11y.png', imageDataUri: img },
      violations: [
        { ruleId: 'link-name', impact: 'serious', help: 'h', helpUrl: '', tags: [], nodes: [{ target: ['#a'], html: '<a>', failureSummary: '', bounds: { x: 20, y: 80, width: 200, height: 24 } }] },
        { ruleId: 'color-contrast', impact: 'serious', help: 'h', helpUrl: '', tags: [], nodes: [{ target: ['#b'], html: '<b>', failureSummary: '', bounds: { x: 20, y: 420, width: 200, height: 24 } }] },
      ],
    };
    const frames = await a11yCropFrames(scan, true); // v2 (dropEngulfing=true)
    expect(frames).toHaveLength(1);
    expect(frames[0].summary).toMatch(/contrast/i);
  }, 20000);
});

describe('a11yFrameSummary', () => {
  it('leads with the single dominant issue, capitalized', () => {
    const rules = [
      { rule: 'color-contrast', hi: true },
      { rule: 'color-contrast', hi: true },
      { rule: 'button-name', hi: true },
    ];
    expect(a11yFrameSummary(rules)).toBe('Low-contrast text and unlabeled buttons');
  });

  it('weights high-impact rules above more-numerous minor ones', () => {
    // 1 high-impact button issue (weight 3) outranks 2 minor contrast issues (weight 2).
    const rules = [
      { rule: 'color-contrast', hi: false },
      { rule: 'color-contrast', hi: false },
      { rule: 'button-name', hi: true },
    ];
    expect(a11yFrameSummary(rules).startsWith('Unlabeled buttons')).toBe(true);
  });

  it('shows just one issue type when only one is present', () => {
    expect(a11yFrameSummary([{ rule: 'color-contrast', hi: true }])).toBe('Low-contrast text');
  });

  it('merges rules that share a label into one phrase (no "X and X")', () => {
    // `label` and `select-name` both map to 'unlabeled form fields'.
    expect(a11yFrameSummary([{ rule: 'label', hi: true }, { rule: 'select-name', hi: false }])).toBe('Unlabeled form fields');
  });

  it('falls back gracefully on no rules', () => {
    expect(a11yFrameSummary([])).toBe('Accessibility issues');
  });
});

describe('a11yIssuesHtml (no-AI fallback)', () => {
  // axe ships jargon-laden `help` sentences; the fallback must never surface them.
  const vRule = (ruleId: string, impact: AccessibilityViolation['impact'], nodes: number): AccessibilityViolation => ({
    ruleId,
    impact,
    help: `axe says: ${ruleId} - ensures ARIA attributes conform to WCAG`,
    helpUrl: '',
    tags: [],
    nodes: Array.from({ length: nodes }, () => ({ target: ['x'], html: '<x>', failureSummary: '' })),
  });

  it('renders plain labels, never the raw axe help text / jargon', () => {
    const html = a11yIssuesHtml([vRule('color-contrast', 'serious', 4), vRule('link-name', 'serious', 3)]);
    expect(html).toContain('Low-contrast text');
    expect(html).toContain('Unlabeled links');
    // no jargon from the original report
    expect(html).not.toMatch(/ARIA|WCAG|axe says|color-contrast|link-name/);
  });

  it('merges rules that share a label and sums the affected spots', () => {
    // two aria-* rules both map to one screen-reader label; 2 + 3 = 5 places.
    const html = a11yIssuesHtml([vRule('aria-required-attr', 'critical', 2), vRule('aria-valid-attr', 'serious', 3)]);
    const lines = html.match(/<li class="a11y-issue">/g) ?? [];
    expect(lines).toHaveLength(1);
    // the apostrophe is HTML-escaped by esc()
    expect(html).toContain('Controls screen readers can&#39;t read');
    expect(html).toContain('5 places affected');
  });

  it('marks the line high-impact when any merged rule is serious/critical', () => {
    expect(a11yIssuesHtml([vRule('color-contrast', 'critical', 1)])).toContain('a11y-dot--hi');
    expect(a11yIssuesHtml([vRule('color-contrast', 'minor', 1)])).toContain('a11y-dot--lo');
  });
});

describe('enrichA11ySummaries', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-enrich-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function pageWith(id: string, violations: AccessibilityViolation[]): PagePerf {
    return {
      id,
      name: id,
      startingPath: id === 'home' ? '/' : `/${id}`,
      chips: [],
      metrics: {},
      a11y: result([scan(violations)]),
    };
  }
  const seed = (id: string, obj: unknown) => {
    const d = path.join(dir, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'accessibility-client.json'), JSON.stringify(obj));
  };
  const readClient = (id: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, id, 'accessibility-client.json'), 'utf8'));
  const siteFile = () => path.join(dir, 'accessibility-site.json');

  // A summarizer that records its calls and returns a fixed result.
  function fakeSummarizer(result: A11ySummaryResult | null): A11ySummarizer & { calls: A11ySummaryRequest[][] } {
    const fn = ((reqs: A11ySummaryRequest[]) => {
      fn.calls.push(reqs);
      return Promise.resolve(result);
    }) as A11ySummarizer & { calls: A11ySummaryRequest[][] };
    fn.calls = [];
    return fn;
  }

  const home = () => pageWith('home', [viol('critical')]);
  const about = () => pageWith('about', [viol('serious')]);

  it('writes the missing page summary + site summary, but never overwrites a cached page', async () => {
    seed('home', { score: 80, summary: 'CACHED', fixes: ['keep'] });
    seed('about', { score: 90 }); // score only - needs a summary
    const sum = fakeSummarizer({
      pages: [
        { summary: 'NEW-home', fixes: ['nh'] },
        { summary: 'NEW-about', fixes: ['na'] },
      ],
      site: 'SITE SUMMARY',
    });

    await enrichA11ySummaries(dir, [home(), about()], sum);

    expect(sum.calls).toHaveLength(1);
    // ALL violation pages are sent (cached ones too) for site-summary context,
    // in target order - this is the index-alignment contract the write loop relies on.
    expect(sum.calls[0]).toHaveLength(2);
    expect(sum.calls[0].map((r) => r.pageName)).toEqual(['home', 'about']);
    // `places` is the per-rule node count, carried into the request for severity context.
    expect(sum.calls[0][0].issues[0].places).toBe(1);
    // home stays cached (not regenerated), score preserved
    expect(readClient('home')).toEqual({ score: 80, summary: 'CACHED', fixes: ['keep'] });
    // about gets the AI summary, audit-time score preserved
    expect(readClient('about')).toEqual({ score: 90, summary: 'NEW-about', fixes: ['na'] });
    expect(JSON.parse(fs.readFileSync(siteFile(), 'utf8'))).toEqual({ summary: 'SITE SUMMARY' });
  });

  it('makes no claude call when every page and the site summary are already cached', async () => {
    seed('home', { score: 80, summary: 'h', fixes: ['x'] });
    seed('about', { score: 90, summary: 'a', fixes: ['y'] });
    fs.writeFileSync(siteFile(), JSON.stringify({ summary: 'cached site' }));
    const sum = fakeSummarizer({ pages: [], site: null });

    await enrichA11ySummaries(dir, [home(), about()], sum);

    expect(sum.calls).toHaveLength(0);
  });

  it('still calls when pages are cached but the site summary is missing', async () => {
    seed('home', { score: 80, summary: 'h', fixes: ['x'] });
    seed('about', { score: 90, summary: 'a', fixes: ['y'] });
    const sum = fakeSummarizer({ pages: [null, null], site: 'NEW SITE' });

    await enrichA11ySummaries(dir, [home(), about()], sum);

    expect(sum.calls).toHaveLength(1);
    // Both cached pages still sent so the site summary has full context.
    expect(sum.calls[0].map((r) => r.pageName)).toEqual(['home', 'about']);
    expect(JSON.parse(fs.readFileSync(siteFile(), 'utf8'))).toEqual({ summary: 'NEW SITE' });
    // cached pages untouched
    expect(readClient('home')).toEqual({ score: 80, summary: 'h', fixes: ['x'] });
  });

  it('makes no claude call when no page has any a11y data at all (byte-identical perf-only report)', async () => {
    const noA11y: PagePerf = { id: 'p', name: 'P', startingPath: '/', chips: [], metrics: {} };
    const sum = fakeSummarizer({ pages: [], site: 'x' });

    await enrichA11ySummaries(dir, [noA11y], sum);

    expect(sum.calls).toHaveLength(0);
    expect(fs.existsSync(siteFile())).toBe(false);
  });

  it('writes nothing and does not throw when the summarizer returns null', async () => {
    seed('about', { score: 90 });
    const sum = fakeSummarizer(null);

    await expect(enrichA11ySummaries(dir, [about()], sum)).resolves.toBeUndefined();
    expect(sum.calls).toHaveLength(1);
    expect(readClient('about')).toEqual({ score: 90 }); // unchanged
    expect(fs.existsSync(siteFile())).toBe(false);
  });

  it('does not call the summarizer when no page has violations', async () => {
    const clean = pageWith('home', []); // zero violations -> not a target
    const sum = fakeSummarizer({ pages: [], site: 'x' });

    await enrichA11ySummaries(dir, [clean], sum);

    expect(sum.calls).toHaveLength(0);
  });
});
