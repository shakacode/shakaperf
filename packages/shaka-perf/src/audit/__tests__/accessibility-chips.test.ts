/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import { createAuditPipeline } from '../pipeline';
import type { AccessibilityResult } from '../stages/accessibility';

function testDef(name: string): AbTestDefinition {
  return {
    name,
    startingPath: '/',
    file: null,
    line: null,
    testTypes: null,
    testFn: async () => {},
  };
}

function accessibilityResult(totalViolations: number, failOnViolation: boolean): AccessibilityResult {
  return {
    totalViolations,
    failOnViolation,
    effectiveConfig: {
      tags: ['wcag2aa'],
      disableRules: [],
      includeRules: null,
    },
    scans: [{
      viewportLabel: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      url: 'http://localhost:3030/',
      violations: Array.from({ length: totalViolations }, (_, index) => ({
        ruleId: `rule-${index}`,
        impact: 'serious',
        help: 'Fix it',
        helpUrl: 'https://example.test/rule',
        tags: ['wcag2aa'],
        nodes: [],
      })),
    }],
  };
}

function chipsFor(result: AccessibilityResult) {
  const test = testDef('Checkout');
  const pipeline = createAuditPipeline({
    parallelism: 1,
    accessibility: {
      tags: ['wcag2aa'],
      disableRules: [],
      includeRules: undefined,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
      failOnViolation: result.failOnViolation,
    },
    agentReadiness: {
      enabled: false,
      playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
    },
  });
  const chips = pipeline.chipsForAllTests([{
    test,
    results: {
      audit: [],
      accessibility: [{
        stage: 'accessibility',
        viewport: DESKTOP_VIEWPORT,
        measurement: result,
        outcome: {
          kind: 'ok',
          stage: 'accessibility',
          measurement: result,
        },
      }],
    },
  }]);
  return chips.get(test) ?? [];
}

describe('audit accessibility chips', () => {
  it('emits no accessibility chip for clean scans', () => {
    expect(chipsFor(accessibilityResult(0, true)).map((chip) => chip.tag))
      .not.toContain('accessibility violation');
  });

  it('emits a failing accessibility violation chip', () => {
    const chip = chipsFor(accessibilityResult(2, true))
      .find((candidate) => candidate.tag === 'accessibility violation');

    expect(chip).toMatchObject({
      text: 'accessibility: 2 violations',
      color: 'red',
    });
  });

  it('emits a non-failing accessibility finding chip', () => {
    const chip = chipsFor(accessibilityResult(1, false))
      .find((candidate) => candidate.tag === 'accessibility finding');

    expect(chip).toMatchObject({
      text: 'accessibility: 1 violation',
      color: 'purple',
    });
  });
});
