/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { describeAccessibility, describeAgentReadiness } from '../engine';
import type { AccessibilityResult, AccessibilityViolation } from '../../accessibility/types';
import type { AgentReadinessResult, PageSignals } from '../../agent_readiness/types';

// --- accessibility fixtures ---

function violation(impact: AccessibilityViolation['impact']): AccessibilityViolation {
  return { ruleId: 'rule', impact, help: '', helpUrl: '', tags: [], nodes: [] };
}

// Only the fields describeAccessibility reads (scans[].violations[].impact +
// totalViolations); cast through unknown so the test doesn't have to spell out
// the full result shape (Viewport, effectiveConfig, etc.).
function a11y(violations: AccessibilityViolation[], total = violations.length): AccessibilityResult {
  return {
    scans: [{ violations }],
    totalViolations: total,
  } as unknown as AccessibilityResult;
}

// --- agent-readiness fixtures ---

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    title: 'Title',
    titlePresent: true,
    metaDescription: 'Description',
    metaDescriptionPresent: true,
    canonical: true,
    lang: 'en',
    robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['Organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 5, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 10, nondescriptive: 0 },
    images: { total: 4, withAlt: 4 },
    textChars: 1200,
    textWords: 200,
    ...overrides,
  };
}

function agent(raw: AgentReadinessResult['raw'], rendered: PageSignals): AgentReadinessResult {
  return { url: 'https://x', raw, rendered } as unknown as AgentReadinessResult;
}

describe('describeAccessibility', () => {
  it('returns null when accessibility did not run', () => {
    expect(describeAccessibility(undefined)).toBeNull();
  });

  it('reports a clean bill when there are no violations', () => {
    expect(describeAccessibility(a11y([], 0))).toBe('No accessibility problems were found.');
  });

  it('shows the moderate/minor split only when it reconciles with the total', () => {
    const out = describeAccessibility(a11y([violation('moderate'), violation('minor')], 2));
    expect(out).toBe('2 smaller accessibility issues (1 moderate, 1 minor) but no major barriers.');
  });

  it('drops the split when null-impact violations make it not add up (no contradictory copy)', () => {
    // total counts the null-impact violation; moderate+minor (1) != total (2),
    // so the parenthetical must be omitted rather than print "(1 moderate, 0 minor)".
    const out = describeAccessibility(a11y([violation('moderate'), violation(null)], 2));
    expect(out).toBe('2 smaller accessibility issues but no major barriers.');
    expect(out).not.toContain('(');
  });

  it('leads with major barriers and the honest total when serious/critical exist', () => {
    const out = describeAccessibility(a11y([violation('critical'), violation('serious'), violation('minor')], 3));
    expect(out).toBe(
      '2 major accessibility barriers that can block people using assistive technology, out of 3 issues total.',
    );
  });

  it('singularises a lone major barrier', () => {
    const out = describeAccessibility(a11y([violation('serious')], 1));
    expect(out).toBe(
      '1 major accessibility barrier that can block people using assistive technology, out of 1 issue total.',
    );
  });
});

describe('describeAgentReadiness', () => {
  it('returns null when agent-readiness did not run', () => {
    expect(describeAgentReadiness(undefined)).toBeNull();
  });

  it('calls out a bot block only when the raw fetch actually looked blocked', () => {
    const out = describeAgentReadiness(agent({ ok: false, likelyBlocked: true, signals: null }, signals()));
    expect(out).toContain('bot-blocked');
  });

  it('does not claim a bot block for a plain fetch failure', () => {
    const out = describeAgentReadiness(agent({ ok: false, likelyBlocked: false, signals: null }, signals()));
    expect(out).not.toContain('bot-blocked');
    expect(out).toContain('could not be read');
  });

  it('states the band alone (no percentage) when the rendered page has almost no text', () => {
    const out = describeAgentReadiness(
      agent({ ok: true, likelyBlocked: false, signals: signals({ textWords: 5 }) }, signals({ textWords: 5 })),
    );
    expect(out).toContain('very little text');
    expect(out).not.toContain('%');
  });

  it('reports the coverage percentage for a well-server-rendered page', () => {
    const out = describeAgentReadiness(
      agent({ ok: true, likelyBlocked: false, signals: signals({ textWords: 200 }) }, signals({ textWords: 200 })),
    );
    expect(out).toContain('100% of its text is already present before JavaScript runs');
    expect(out).toContain('reads well');
  });
});
