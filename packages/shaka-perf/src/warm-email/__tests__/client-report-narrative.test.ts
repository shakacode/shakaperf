/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildDeterministicNarrative,
  buildNarrativePrompt,
  composeNarrative,
  OVERSELL_VERDICT_RE,
  OVERSELL_VERDICT_WORDS,
  type NarrativeFacts,
} from '../client-report-narrative';

const perfPoor: NonNullable<NarrativeFacts['perf']> = { status: 'poor', avgLabel: '5.3s', slowCount: 2, jumpyCount: 0, worst: [] };
const perfBlocked: NonNullable<NarrativeFacts['perf']> = { status: 'fair', slowCount: 0, jumpyCount: 0, worst: [], couldNotMeasure: true };
const blockedA11y: NonNullable<NarrativeFacts['a11y']> = { status: 'good', highImpact: 0, pagesWithBarriers: 0, topIssues: [], couldNotMeasure: true };
const blockedAgent: NonNullable<NarrativeFacts['agent']> = { status: 'good', score: 0, accessBlocked: false, couldNotMeasure: true };

describe('narrative: could not measure (bot wall)', () => {
  it('gives a "Could not measure" verdict for a blocked a11y or agent dimension', () => {
    const n = buildDeterministicNarrative({ domain: 'x.com', worstDim: 'perf', perf: perfPoor, a11y: blockedA11y, agent: blockedAgent });
    expect(n.a11y.verdictWord).toBe('Could not measure');
    expect(n.agent.verdictWord).toBe('Could not measure');
    expect(n.a11y.verdictPara.toLowerCase()).toContain('bot protection');
  });

  it('names the measured gap and notes the blocked checks, never the blocked dim as the gap', () => {
    const n = buildDeterministicNarrative({ domain: 'x.com', worstDim: 'perf', perf: perfPoor, a11y: blockedA11y, agent: blockedAgent });
    expect(n.bottomLineHtml).toContain('mobile speed');
    expect(n.bottomLineHtml.toLowerCase()).toContain('bot protection');
    expect(n.bottomLineHtml.toLowerCase()).not.toContain('accessibility');
  });

  it('keeps the blocked-check disclosure with a specific performance gap headline', () => {
    const n = buildDeterministicNarrative({
      domain: 'x.com',
      worstDim: 'perf',
      perf: { ...perfPoor, gapHeadline: 'Home shows its main content after 5.0s' },
      a11y: blockedA11y,
    });
    expect(n.bottomLineHtml).toContain('Home shows its main content after');
    expect(n.bottomLineHtml).toContain('5.0s');
    expect(n.bottomLineHtml.toLowerCase()).toContain('bot protection');
  });

  it('says the whole site could not be measured when every dimension is blocked', () => {
    const n = buildDeterministicNarrative({ domain: 'x.com', worstDim: 'a11y', a11y: blockedA11y, agent: blockedAgent });
    expect(n.bottomLineHtml.toLowerCase()).toContain('could not measure');
    // Never claim a "gap" or name a blocked dimension as the problem.
    expect(n.bottomLineHtml.toLowerCase()).not.toContain('real gap');
    expect(n.bottomLineHtml.toLowerCase()).not.toContain('accessibility');
    expect(n.a11y.verdictWord).toBe('Could not measure');
    expect(n.agent.verdictWord).toBe('Could not measure');
  });

  it('keeps the deterministic "Could not measure" verdict even when a stale AI overlay says otherwise', () => {
    const facts: NarrativeFacts = { domain: 'x.com', worstDim: 'perf', perf: perfPoor, a11y: blockedA11y };
    const n = composeNarrative(facts, {
      a11y: { verdictWord: 'Some visitors are blocked', verdictPara: 'stale wrong text' },
      bottomLine: 'The real gap is accessibility.',
    });
    expect(n.a11y.verdictWord).toBe('Could not measure');
    expect(n.bottomLineHtml.toLowerCase()).not.toContain('real gap is accessibility');
  });

  it('does not call performance slow when no speed page could be measured', () => {
    const n = buildDeterministicNarrative({ domain: 'x.com', worstDim: 'perf', perf: perfBlocked });
    expect(n.perf.verdictWord).toBe('Could not measure');
    expect(n.perf.verdictPara).toContain('mobile speed data');
    expect(n.bottomLineHtml.toLowerCase()).toContain('could not measure');
    expect(n.bottomLineHtml).toContain('mobile speed</span>');
    expect(n.bottomLineHtml).not.toContain('A bit slow on phones');
  });

  it('keeps a stale AI overlay from rewriting unmeasured performance', () => {
    const n = composeNarrative(
      { domain: 'x.com', worstDim: 'perf', perf: perfBlocked },
      { perf: { verdictWord: 'A bit slow on phones', verdictPara: 'stale wrong text' }, bottomLine: 'The real gap is mobile speed.' },
    );
    expect(n.perf.verdictWord).toBe('Could not measure');
    expect(n.bottomLineHtml.toLowerCase()).not.toContain('real gap');
  });
});

describe('narrative: verdict tiers', () => {
  it('rejects a reassuring fair verdict while retaining its overlay paragraph', () => {
    const facts: NarrativeFacts = {
      domain: 'x.com',
      worstDim: 'agent',
      agent: { status: 'fair', score: 68, accessBlocked: false },
    };
    const n = composeNarrative(facts, {
      agent: { verdictWord: 'Mostly AI-readable', verdictPara: 'The text coverage is intact, but structure still needs work.' },
    });

    expect(n.agent.verdictWord).toBe('Needs work');
    expect(n.agent.verdictPara).toBe('The text coverage is intact, but structure still needs work.');
  });

  it('allows a fair verdict that names remaining work', () => {
    const facts: NarrativeFacts = {
      domain: 'x.com',
      worstDim: 'agent',
      agent: { status: 'fair', score: 68, accessBlocked: false },
    };

    expect(composeNarrative(facts, { agent: { verdictWord: 'Needs attention' } }).agent.verdictWord).toBe('Needs attention');
  });

  it('allows a reassuring verdict for a good status', () => {
    const facts: NarrativeFacts = {
      domain: 'x.com',
      worstDim: 'agent',
      agent: { status: 'good', score: 92, accessBlocked: false },
    };

    expect(composeNarrative(facts, { agent: { verdictWord: 'Mostly AI-readable' } }).agent.verdictWord).toBe('Mostly AI-readable');
  });

  it('does not match deterministic fair or poor verdicts as overselling', () => {
    for (const verdict of ['Slow on phones', 'A bit slow on phones', 'Some visitors are blocked', 'Needs attention', 'Needs work', 'Hard for AI to read']) {
      expect(OVERSELL_VERDICT_RE.test(verdict)).toBe(false);
    }
  });

  it('asks the narrator to keep fair and poor verdicts from overselling', () => {
    const prompt = buildNarrativePrompt({ domain: 'x.com', worstDim: 'agent', agent: { status: 'fair', score: 68, accessBlocked: false } });
    expect(prompt).toContain('Each verdictWord must match its stated status. For fair and poor statuses');
    expect(prompt).toContain(OVERSELL_VERDICT_WORDS.join(', '));
  });
});
