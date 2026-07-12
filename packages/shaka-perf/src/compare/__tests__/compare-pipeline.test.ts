/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import {
  comparePipelineConfigFromAbTests,
  comparePipelineMetadata,
  createComparePipeline,
} from '../compare-pipeline';
import type { AccessibilityCompareResult, AccessibilityCompareSummary } from '../stages/accessibility';
import { runPipeline } from '../../pipeline/runner';
import type { AbTestsConfig } from '../../config';

describe('compare accessibility pipeline integration', () => {
  it('derives reusable pipeline construction options from parsed config', () => {
    const parsed = {
      shared: { parallelism: 6, testPathPattern: 'checkout' },
      visreg: {
        defaultMisMatchThreshold: 0.2,
        maxNumDiffPixels: 12,
        comparePixelmatchThreshold: 0.3,
        engineOptions: { browser: 'chromium' },
        resembleOutputOptions: { transparency: 0.4 },
        compareRetries: 4,
        compareRetryDelay: 50,
      },
      perf: {
        numberOfMeasurements: 7,
        regressionThreshold: 8,
        pValueThreshold: 0.04,
        regressionThresholdStat: 'ci-lower',
        samplingMode: 'simultaneous',
        lighthouseConfig: { maxWaitForLoad: 1000 },
        plotTitle: 'Shared config',
      },
      accessibility: { tags: ['wcag2a'] },
    } as AbTestsConfig;

    expect(comparePipelineConfigFromAbTests(parsed, { artifactRoot: 'commits/abc' }))
      .toMatchObject({
        artifactRoot: 'commits/abc',
        parallelism: 3,
        testPathPattern: 'checkout',
        visregDefaultMisMatchThreshold: 0.2,
        perfNumberOfMeasurements: 7,
        accessibility: { tags: ['wcag2a'] },
      });
  });

  it('registers accessibility as a first-class compare category and stage', () => {
    expect(comparePipelineMetadata.categories).toEqual(['visreg', 'perf', 'accessibility']);
    expect(comparePipelineMetadata.stages).toEqual([
      'visreg',
      'perf-warmup',
      'perf',
      'perf-low-noise',
      'accessibility',
    ]);

    const pipeline = createComparePipeline(baseConfig());
    expect(pipeline.stages.map((stage) => stage.name)).toEqual(comparePipelineMetadata.stages);
  });

  it('uses the configured artifact root for compare results', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-compare-pipeline-test-'));
    const pipeline = createComparePipeline({
      ...baseConfig(),
      artifactRoot: 'candidate-artifacts',
    });

    try {
      const result = await runPipeline(pipeline, {
        cwd,
        controlURL: 'http://control.test',
        experimentURL: 'http://experiment.test',
        skipReport: true,
        retries: 0,
        retryDelay: 0,
        timeoutMs: 1_000,
        viewports: {
          visreg: [],
          perf: [],
          accessibility: [],
          audit: [],
        },
        tests: [testDefinition()],
      });

      expect(result.resultsRoot).toBe(path.join(cwd, 'candidate-artifacts', 'compare-results'));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('emits failing accessibility regression chips and sort dimensions for new violations', () => {
    const pipeline = createComparePipeline(baseConfig());
    const test = testDefinition();
    const result = accessibilityResult({
      new: 2,
      fixed: 1,
      changed: 1,
      unchanged: 3,
      errors: 0,
      blocked: 0,
      newByImpact: { critical: 1, serious: 1 },
      fixedByImpact: { moderate: 1 },
      changedByImpact: { serious: 1 },
    });
    const actualChips = pipeline.chipsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];

    expect(actualChips.map((chip) => chip.tag)).toEqual([
      'accessibility regression',
      'accessibility changed',
      'accessibility fixed',
    ]);
    expect(actualChips.map((chip) => chip.text)).toEqual([
      'accessibility: 2 new in experiment',
      'accessibility: 1 changed',
      'accessibility: 1 fixed in experiment',
    ]);
    expect(actualChips[0]).toMatchObject({
      text: 'accessibility: 2 new in experiment',
      color: 'red',
    });

    const sorts = pipeline.sortsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];
    expect(sorts.map((sort) => [sort.tag, sort.value])).toEqual([
      ['a11y-new-critical-serious', 2],
      ['a11y-new', 2],
      ['a11y-fixed', 1],
    ]);
  });

  it('keeps new accessibility findings non-failing when failOnViolation is false', () => {
    const pipeline = createComparePipeline(baseConfig());
    const test = testDefinition();
    const chips = pipeline.chipsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(accessibilityResult({
          new: 1,
          fixed: 0,
          changed: 0,
          unchanged: 0,
          errors: 0,
          blocked: 0,
          newByImpact: { serious: 1 },
          fixedByImpact: {},
          changedByImpact: {},
        }, false))],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];

    expect(chips[0]).toMatchObject({
      tag: 'accessibility finding',
      color: 'purple',
      text: 'accessibility: 1 new in experiment',
    });
  });

  it('emits accessibility error chips and sort dimensions for incomplete scans', () => {
    const pipeline = createComparePipeline(baseConfig());
    const test = testDefinition();
    const result = accessibilityResult({
      new: 0,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 1,
      blocked: 0,
      newByImpact: {},
      fixedByImpact: {},
      changedByImpact: {},
    });

    const chips = pipeline.chipsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];
    expect(chips[0]).toMatchObject({
      tag: 'accessibility error',
      color: 'red',
      text: 'accessibility error: 1',
    });

    const sorts = pipeline.sortsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];
    expect(sorts.map((sort) => [sort.tag, sort.value])).toEqual([
      ['a11y-errors', 1],
    ]);
  });

  it('emits accessibility blocked chips and sort dimensions for bot-protected scans', () => {
    const pipeline = createComparePipeline(baseConfig());
    const test = testDefinition();
    const result = accessibilityResult({
      new: 0,
      fixed: 0,
      changed: 0,
      unchanged: 0,
      errors: 0,
      blocked: 1,
      newByImpact: {},
      fixedByImpact: {},
      changedByImpact: {},
    });

    const chips = pipeline.chipsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];
    expect(chips[0]).toMatchObject({
      tag: 'accessibility blocked',
      color: 'red',
      text: 'accessibility blocked: 1',
    });

    const sorts = pipeline.sortsForAllTests([{
      test,
      results: {
        visreg: [],
        accessibility: [entry(result)],
        'perf-warmup': [],
        perf: [],
        'perf-low-noise': [],
      },
    }]).get(test) ?? [];
    expect(sorts.map((sort) => [sort.tag, sort.value])).toEqual([
      ['a11y-blocked', 1],
    ]);
  });
});

function baseConfig(): Parameters<typeof createComparePipeline>[0] {
  return {
    parallelism: 1,
    visregDefaultMisMatchThreshold: 0.1,
    visregMaxNumDiffPixels: 50,
    visregComparePixelmatchThreshold: 0.1,
    visregEngineOptions: {},
    visregCompareRetries: 0,
    visregCompareRetryDelay: 0,
    perfNumberOfMeasurements: 1,
    perfRegressionThreshold: 0.1,
    perfPValueThreshold: 0.05,
    perfRegressionThresholdStat: 'estimator',
    perfSamplingMode: 'simultaneous',
  };
}

function entry(result: AccessibilityCompareResult) {
  return {
    stage: 'accessibility',
    viewport: DESKTOP_VIEWPORT,
    measurement: result,
    outcome: {
      kind: 'ok' as const,
      stage: 'accessibility',
      measurement: result,
    },
  };
}

function accessibilityResult(
  summary: AccessibilityCompareSummary,
  failOnViolation = true,
): AccessibilityCompareResult {
  return {
    control: {
      side: 'control',
      url: 'http://localhost:3000/',
      violations: [],
    },
    experiment: {
      side: 'experiment',
      url: 'http://localhost:3001/',
      violations: [],
    },
    effectiveConfig: {
      tags: ['wcag2a', 'wcag2aa'],
      disableRules: [],
      includeRules: null,
    },
    failOnViolation,
    findings: [],
    summary,
  };
}

function testDefinition(): AbTestDefinition {
  return {
    name: 'Homepage',
    startingPath: '/',
    file: null,
    line: null,
    options: {},
    testTypes: null,
    testFn: async () => {},
  };
}
