/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';
import { assertNoPipelineErrors, discoverTargets, evaluateTargetsAtCommitFromTestResults } from '../analyze';
import type { BisectTarget, TargetEvaluationAtCommit } from '../types';
import type { AccessibilityFindingStatus } from '../../stages/accessibility';
import type { PerfArtifact } from '../../stages/perf';
import type { VisregResult } from '../../stages/visreg';
import type { TestResult } from '../../../pipeline/report';

function testResult(
  viewport = DESKTOP_VIEWPORT,
  includeVisualAndPerf = true,
  accessibilityStatus: AccessibilityFindingStatus = 'new',
): TestResult {
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
        measurement: accessibilityResult(accessibilityStatus),
      },
    ],
  };
}

function accessibilityResult(status: AccessibilityFindingStatus = 'new') {
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
      finding('button-name', '[data-cy="primary-button"]', status),
      finding('button-name', '[data-cy="secondary-button"]', status),
    ],
    summary: {
      new: status === 'new' ? 2 : 0,
      fixed: 0,
      changed: status === 'changed' ? 2 : 0,
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

function finding(ruleId: string, target: string, status: AccessibilityFindingStatus) {
  const side = {
    impact: 'critical' as const,
    help: 'Buttons must have discernible text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/button-name',
    tags: ['wcag2a'],
    nodes: [{ target: [target], html: '<button></button>', failureSummary: 'Fix this button' }],
  };
  return {
    status,
    signature: `${ruleId}|${target}`,
    ruleId,
    impact: 'critical' as const,
    tags: ['wcag2a'],
    ...(status === 'changed' ? { control: side } : {}),
    experiment: side,
  };
}

function evaluationFor(
  targetEvaluations: readonly TargetEvaluationAtCommit[],
  category: string,
  subject: string,
  viewport: string,
) {
  return targetEvaluations.find((evaluation: TargetEvaluationAtCommit) => evaluation.targetId === targetId(category, subject, viewport))!;
}

function targetId(category: string, subject: string, viewport: string) {
  return JSON.stringify([category, 'tests/homepage.abtest.ts', 'Homepage', viewport, subject]);
}

describe('bisect regression analysis', () => {
  it('discovers stable typed targets and evaluates them across all categories', () => {
    const results = [testResult()];
    const targets = discoverTargets(results);
    const targetEvaluations = evaluateTargetsAtCommitFromTestResults(results, targets, 'bad');

    expect(targets.map((item: BisectTarget) => [item.category, item.subject])).toEqual([
      ['accessibility', 'button-name'],
      ['perf', 'TBT'],
      ['visreg', '[data-cy="hero-section"]'],
    ]);
    expect(targets.filter((item: BisectTarget) => item.category === 'accessibility')).toMatchObject([
      { viewport: 'desktop', status: 'active' },
    ]);
    expect(evaluationFor(targetEvaluations, 'accessibility', 'button-name', 'desktop')).toMatchObject({
      commitSha: 'bad',
      regressionDetected: true,
      evidence: {
        controlViolationCount: 0,
        controlNodeCount: 0,
        experimentViolationCount: 2,
        experimentNodeCount: 2,
      },
      evidenceArtifacts: [
        'accessibility-comparison.html',
        'control-accessibility.json',
        'experiment-accessibility.json',
      ],
    });
    expect(evaluationFor(targetEvaluations, 'perf', 'TBT', 'desktop')).toMatchObject({
      commitSha: 'bad',
      regressionDetected: true,
      evidence: {
        controlValue: 100,
        experimentValue: 120,
        deltaValue: 20,
        deltaPercent: 20,
        pValue: 0.01,
        direction: 'regression',
      },
    });
    expect(evaluationFor(targetEvaluations, 'visreg', '[data-cy="hero-section"]', 'desktop')).toMatchObject({
      commitSha: 'bad',
      regressionDetected: true,
      evidence: {
        misMatchPercentage: 2.5,
        diffPixels: 24,
        threshold: 0.1,
        savedByRetries: false,
      },
      evidenceArtifacts: ['control.png', 'experiment.png', 'diff.png'],
    });
  });

  it('discovers targets only for selected bisect categories', () => {
    const targets = discoverTargets(
      [testResult()],
      ['accessibility'],
    );

    expect(targets.map((target) => [target.category, target.subject])).toEqual([
      ['accessibility', 'button-name'],
    ]);
  });

  it('collapses accessibility findings by rule per test and viewport', () => {
    const targets = discoverTargets([
      testResult(),
      testResult(PHONE_VIEWPORT, false),
    ]);

    expect(targets.filter((item: BisectTarget) => item.category === 'accessibility')).toMatchObject([
      { subject: 'button-name', viewport: 'desktop' },
      { subject: 'button-name', viewport: 'phone' },
    ]);
  });

  it('does not discover changed-only accessibility findings', () => {
    const changedOnlyResults = [testResult(DESKTOP_VIEWPORT, false, 'changed')];

    expect(discoverTargets(changedOnlyResults)).toEqual([]);
  });

  it('evaluates an existing accessibility target as regression-free for changed-only findings', () => {
    const existingTarget = discoverTargets([
      testResult(DESKTOP_VIEWPORT, false),
    ])[0]!;
    const changedOnlyResults = [testResult(DESKTOP_VIEWPORT, false, 'changed')];

    expect(evaluateTargetsAtCommitFromTestResults(changedOnlyResults, [existingTarget], 'candidate')).toMatchObject([
      { targetId: existingTarget.id, commitSha: 'candidate', regressionDetected: false },
    ]);
  });

  it('throws when a requested target has no matching measurement', () => {
    const existingTarget = discoverTargets([
      testResult(),
    ])
      .find((target) => target.category === 'visreg')!;

    expect(() => evaluateTargetsAtCommitFromTestResults([testResult(PHONE_VIEWPORT)], [existingTarget], 'candidate'))
      .toThrow(/missing visreg measurement/i);
  });

  it('rejects mixed valid and error outcomes before analysis', () => {
    const result = testResult();
    result.outcomes.push({
      kind: 'error',
      stage: 'visreg',
      viewport: PHONE_VIEWPORT,
      error: { message: 'phone capture failed' },
    });

    expect(() => assertNoPipelineErrors([result], 'candidate'))
      .toThrow(/candidate.*visreg.*phone capture failed/i);
  });

  it('does not discover visreg artifacts without a diff image', () => {
    const result = testResult();
    const visreg = result.outcomes.find((outcome) => outcome.stage === 'visreg')
      ?.measurement as VisregResult;
    visreg[0]!.diffImage = null;

    expect(discoverTargets([result])
      .some((target) => target.category === 'visreg')).toBe(false);
  });

  it('does not discover perf metrics classified as none or improvement', () => {
    const result = testResult();
    const perf = result.outcomes.find((outcome) => outcome.stage === 'perf')
      ?.measurement as PerfArtifact;
    const metric = perf.metrics![0]!;
    perf.metrics = [
      { ...metric, direction: 'none' },
      { ...metric, label: 'LCP', direction: 'improvement' },
    ];

    expect(discoverTargets([result])
      .some((target) => target.category === 'perf')).toBe(false);
  });
});
