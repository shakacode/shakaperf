/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { buildDeterministicNarrative, composeNarrative, type NarrativeFacts } from '../client-report-narrative';

const perfPoor: NonNullable<NarrativeFacts['perf']> = { status: 'poor', avgLabel: '5.3s', slowCount: 2, jumpyCount: 0, worst: [] };
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
});
