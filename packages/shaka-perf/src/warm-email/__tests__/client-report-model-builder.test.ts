/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import {
  assembleClientReportModel,
  type ClientReportPerformanceSection,
  type ClientReportReportInput,
} from '../client-report-model/report';
import type { A11ySection } from '../client-report-model/a11y';
import type { AgentSection } from '../client-report-model/ai';

function perf(overrides: Partial<ClientReportPerformanceSection> = {}): ClientReportPerformanceSection {
  return {
    hasPerf: true,
    perfStatus: 'fair',
    perfCouldNotMeasure: false,
    perfCards: [],
    perfFine: [],
    rankedCarded: [],
    perfCost: { tab: 'perf', state: 'measured' },
    ...overrides,
  };
}

function a11y(overrides: Partial<A11ySection> = {}): A11ySection {
  return {
    hasA11y: true,
    a11yBlocked: [],
    a11yCouldNotMeasure: false,
    a11yMeasurable: [],
    cardedA11y: [],
    fineA11y: [],
    a11yCards: [],
    a11yFine: [],
    a11yStatus: 'good',
    highImpactTotal: 0,
    lowerImpactTotal: 0,
    a11yTopIssues: [],
    ...overrides,
  };
}

function agent(overrides: Partial<AgentSection> = {}): AgentSection {
  return {
    agentCards: [],
    agentFine: [],
    agentStatus: 'good',
    agentOverall: 96,
    agentAccessBlocked: false,
    agentBlocked: [],
    agentCouldNotMeasure: false,
    agentCost: { tab: 'ai', state: 'zero' },
    ...overrides,
  };
}

function input(overrides: Partial<ClientReportReportInput> = {}): ClientReportReportInput {
  return {
    domain: 'example.com',
    dateStr: 'July 10, 2026',
    faviconLinkTag: '',
    measuredCount: 3,
    avgMs: 3100,
    avgLabel: '3.1s',
    slowCount: 2,
    jumpyCount: 0,
    footnoteThrottle: 'Slow-4G',
    perf: perf(),
    a11y: a11y(),
    hasAgent: true,
    agent: agent(),
    ...overrides,
  };
}

describe('assembleClientReportModel', () => {
  it('assembles all measured dimensions from hand-built section outputs', () => {
    const result = assembleClientReportModel(input({
      a11y: a11y({
        a11yStatus: 'poor',
        highImpactTotal: 2,
        a11yCost: { tab: 'a11y', state: 'measured' },
        a11yStrongPageGroup: { label: 'Strong pages', pages: [{ name: 'Contact', score: 98 }] },
      }),
    }), null);

    expect(result.tiles.map((tile) => tile.target)).toEqual(['perf', 'a11y', 'agent']);
    expect(result.tabOrder).toEqual(['a11y', 'perf', 'agent']);
    expect(result.tiles).toContainEqual(expect.objectContaining({
      target: 'agent',
      metricSub: 'out of 100 - avg page readability for AI',
    }));
    expect(result).toMatchObject({
      perfCost: { state: 'measured' },
      a11yCost: { state: 'measured' },
      a11yStrongPageGroup: { label: 'Strong pages', pages: [{ name: 'Contact', score: 98 }] },
      agentCost: { state: 'zero' },
    });
  });

  it('omits optional agent presentation fields when the agent section is absent', () => {
    const result = assembleClientReportModel(input({ hasAgent: false }), null);

    expect(result.tiles.map((tile) => tile.target)).toEqual(['perf', 'a11y']);
    expect(result.agentScore).toBeUndefined();
  });

  it('keeps blocked dimensions after measured problem dimensions in tab order', () => {
    const result = assembleClientReportModel(input({
      perf: perf({ perfStatus: 'poor' }),
      a11y: a11y({ a11yCouldNotMeasure: true, a11yStatus: 'poor', a11yBlocked: [{ name: 'Home', path: '/' }] }),
      agent: agent({ agentCouldNotMeasure: true, agentStatus: 'poor', agentBlocked: [{ name: 'Home', path: '/' }] }),
    }), null);

    expect(result.tabOrder).toEqual(['perf', 'a11y', 'agent']);
    expect(result.tiles.filter((tile) => tile.blocked).map((tile) => tile.target)).toEqual(['a11y', 'agent']);
  });

  it('retains the material-loss footer guardrail when any cost block is measured', () => {
    const result = assembleClientReportModel(input(), null);

    expect(result.footnote).toContain('Measured on your site - every number links to its source.');
  });
});
