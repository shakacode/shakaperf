/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import { discoverTargets, observeTargets } from '../analyze';
import type { BisectTarget, TargetObservation } from '../types';
import type { TestResult } from '../../../pipeline/report';

function testResult(viewport = DESKTOP_VIEWPORT, includeVisualAndPerf = true): TestResult {
  return {
    id: 'homepage',
    name: 'Homepage',
    filePath: 'tests/homepage.abtest.ts',
    startingPath: '/',
    controlUrl: 'http://control.test/',
    experimentUrl: 'http://experiment.test/',
    code: null,
    chips: [],
    sorts: [],
    durationMs: 0,
    measuredAt: null,
    runId: null,
    viewportArtifactPaths: [],
    outcomes: [
      ...(includeVisualAndPerf ? [
        {
          kind: 'ok' as const,
          stage: 'visreg',
          viewport,
          measurement: [{
            selector: '[data-cy="hero-section"]',
            controlImage: 'control.png',
            experimentImage: 'experiment.png',
            diffImage: 'diff.png',
            misMatchPercentage: 2.5,
            diffPixels: 24,
            threshold: 0.1,
            diffBbox: null,
            savedByRetries: false,
          }],
        },
        {
          kind: 'ok' as const,
          stage: 'perf',
          viewport,
          measurement: {
            metrics: [{
              label: 'TBT',
              group: 'vitals',
              controlValue: 100,
              experimentValue: 120,
              deltaValue: 20,
              controlDisplay: '100ms',
              experimentDisplay: '120ms',
              deltaDisplay: '+20ms',
              percentDisplay: '+20%',
              deltaPercent: 20,
              pValue: 0.01,
              direction: 'regression',
            }],
          },
        },
      ] : []),
      {
        kind: 'ok' as const,
        stage: 'accessibility',
        viewport,
        measurement: accessibilityResult(),
      },
    ],
  };
}

function accessibilityResult() {
  return {
    control: {
      side: 'control' as const,
      url: 'http://control.test/',
      violations: [],
      rawArtifactHref: 'control-accessibility.json',
    },
    experiment: {
      side: 'experiment' as const,
      url: 'http://experiment.test/',
      violations: [],
      rawArtifactHref: 'experiment-accessibility.json',
    },
    effectiveConfig: { tags: [], disableRules: [], includeRules: null },
    failOnViolation: true,
    findings: [
      finding('button-name', '[data-cy="primary-button"]'),
      finding('button-name', '[data-cy="secondary-button"]'),
    ],
    summary: {
      new: 2,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 0,
      blocked: 0,
      newByImpact: { critical: 2 },
      fixedByImpact: {},
      changedByImpact: {},
    },
    comparisonArtifactHref: 'accessibility-comparison.html',
  };
}

function finding(ruleId: string, target: string) {
  return {
    status: 'new' as const,
    signature: `${ruleId}|${target}`,
    ruleId,
    impact: 'critical' as const,
    tags: ['wcag2a'],
    experiment: {
      impact: 'critical' as const,
      help: 'Buttons must have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/button-name',
      tags: ['wcag2a'],
      nodes: [{ target: [target], html: '<button></button>', failureSummary: 'Fix this button' }],
    },
  };
}

function observationFor(
  observations: readonly TargetObservation[],
  category: string,
  subject: string,
  viewport: string,
) {
  return observations.find((observation: TargetObservation) => observation.targetId === targetId(category, subject, viewport))!;
}

function targetId(category: string, subject: string, viewport: string) {
  return JSON.stringify([category, 'tests/homepage.abtest.ts', 'Homepage', viewport, subject]);
}

describe('bisect regression analysis', () => {
  it('discovers stable typed targets and observations across all categories', () => {
    const results = [testResult()];
    const targets = discoverTargets(results, ['good', 'candidate', 'bad'], 'bad');
    const observations = observeTargets(results, targets, 'bad');

    expect(targets.map((item: BisectTarget) => [item.category, item.subject])).toEqual([
      ['accessibility', 'button-name'],
      ['perf', 'TBT'],
      ['visreg', '[data-cy="hero-section"]'],
    ]);
    expect(targets.filter((item: BisectTarget) => item.category === 'accessibility')).toMatchObject([
      { viewport: 'desktop', goodIndex: 0, badIndex: 2, status: 'active' },
    ]);
    expect(observationFor(observations, 'accessibility', 'button-name', 'desktop')).toMatchObject({
      commitSha: 'bad',
      present: true,
      values: {
        controlViolationCount: 0,
        controlNodeCount: 0,
        experimentViolationCount: 2,
        experimentNodeCount: 2,
      },
      artifacts: [
        'accessibility-comparison.html',
        'control-accessibility.json',
        'experiment-accessibility.json',
      ],
    });
    expect(observationFor(observations, 'perf', 'TBT', 'desktop')).toMatchObject({
      commitSha: 'bad',
      present: true,
      values: {
        controlValue: 100,
        experimentValue: 120,
        deltaValue: 20,
        deltaPercent: 20,
        pValue: 0.01,
        direction: 'regression',
      },
    });
    expect(observationFor(observations, 'visreg', '[data-cy="hero-section"]', 'desktop')).toMatchObject({
      commitSha: 'bad',
      present: true,
      values: {
        misMatchPercentage: 2.5,
        diffPixels: 24,
        threshold: 0.1,
        savedByRetries: false,
      },
      artifacts: ['control.png', 'experiment.png', 'diff.png'],
    });
  });

  it('collapses accessibility findings by rule per test and viewport', () => {
    const targets = discoverTargets([
      testResult(),
      testResult(PHONE_VIEWPORT, false),
    ], ['good', 'candidate', 'bad'], 'bad');

    expect(targets.filter((item: BisectTarget) => item.category === 'accessibility')).toMatchObject([
      { subject: 'button-name', viewport: 'desktop' },
      { subject: 'button-name', viewport: 'phone' },
    ]);
  });
});
