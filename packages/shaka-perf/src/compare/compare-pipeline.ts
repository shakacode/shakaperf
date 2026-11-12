/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { PerfLighthouseConfig } from '../bench/core/lighthouse-config';
import type { ChipDescriptor, SortDescriptor } from '../pipeline/report';
import { retryCountText } from '../pipeline/outcome-chips';
import { retryUsageTooltip } from '../pipeline/retry-usage-tooltip';
import {
  createPipeline,
  type ChipStageResults,
} from '../pipeline/pipeline';
import { emptyMachineReadableSummary, type JsonValue } from '../stage/stage';
import {
  type PerfLowNoiseResult,
  type PerfMetric,
  type PerfResult,
  type PerfWarmupResult,
} from './stages/perf';
import {
  AccessibilityCompareStage,
  type AccessibilityCompareResult,
  type AccessibilityCompareSummary,
} from './stages/accessibility';
import { PerfEngineStage } from './stages/perf/stage';
import { createVisregStage, type VisregResult, type VisregArtifact } from './stages/visreg';
import type { AccessibilityStageConfig } from '../audit/stages/accessibility';
import { comparePipelineReport } from './pipeline-report';
import type { AbTestsConfig } from '../config';
// From the type-only-imports leaf module, NOT '../config': this file is part
// of the report-shell browser bundle, and a value import of config.ts would
// pull the zod schemas and their node-side imports into the bundle.
import { resolvePlaywrightOptions } from '../playwright-options';
import { pairedBenchmarkParallelism } from './stages/shared/runtime';

export const comparePipelineMetadata = {
  description: 'Run visreg + perf + accessibility stages side-by-side and produce a unified A/B report.',
  categories: ['visreg', 'perf', 'accessibility'],
  stages: ['visreg', 'perf-warmup', 'perf', 'perf-low-noise', 'accessibility'],
} as const;

interface VisregResembleOutputOptions {
  readonly transparency?: number | undefined;
  readonly ignoreAntialiasing?: boolean | undefined;
  readonly usePreciseMatching?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface ComparePipelineConfig {
  readonly artifactRoot?: string | undefined;
  readonly parallelism: number;
  readonly testPathPattern?: string | undefined;
  readonly visregMismatchThreshold: number;
  readonly visregMaxNumDiffPixels: number;
  readonly visregComparePixelmatchThreshold: number;
  readonly visregResembleOutputOptions?: VisregResembleOutputOptions;
  readonly visregCompareRetries: number;
  readonly visregCompareRetryDelay: number;
  readonly perfNumberOfMeasurements: number;
  readonly perfRegressionThreshold: number;
  readonly perfPValueThreshold: number;
  readonly perfRegressionThresholdStat: 'estimator' | 'ci-lower' | 'ci-upper';
  readonly perfSamplingMode: 'sequential' | 'simultaneous';
  readonly perfLighthouseConfig?: PerfLighthouseConfig;
  readonly perfPlotTitle?: string;
  readonly accessibility: AccessibilityStageConfig;
}

export function comparePipelineConfigFromAbTests(
  config: AbTestsConfig,
  overrides: Pick<ComparePipelineConfig, 'artifactRoot' | 'testPathPattern'> = {},
): ComparePipelineConfig {
  return {
    artifactRoot: overrides.artifactRoot,
    parallelism: pairedBenchmarkParallelism(config.shared.parallelism),
    testPathPattern: overrides.testPathPattern ?? config.shared.testPathPattern,
    visregMismatchThreshold: config.visreg.mismatchThreshold,
    visregMaxNumDiffPixels: config.visreg.maxNumDiffPixels,
    visregComparePixelmatchThreshold: config.visreg.comparePixelmatchThreshold,
    visregResembleOutputOptions: config.visreg.resembleOutputOptions,
    visregCompareRetries: config.visreg.compareRetries,
    visregCompareRetryDelay: config.visreg.compareRetryDelay,
    perfNumberOfMeasurements: config.perf.numberOfMeasurements,
    perfRegressionThreshold: config.perf.regressionThreshold,
    perfPValueThreshold: config.perf.pValueThreshold,
    perfRegressionThresholdStat: config.perf.regressionThresholdStat,
    perfSamplingMode: config.perf.samplingMode,
    perfLighthouseConfig: config.perf.lighthouseConfig,
    perfPlotTitle: config.perf.plotTitle,
    accessibility: {
      ...config.accessibility,
      playwrightOptions: resolvePlaywrightOptions(config, 'accessibility'),
    },
  };
}

export function createComparePipeline(input: ComparePipelineConfig) {
  return createPipeline({
    measurementSides: ['control', 'experiment'],
    name: 'compare',
    description: comparePipelineMetadata.description,
    artifactRoot: input.artifactRoot,
    pipelineConfig: input,
    report: comparePipelineReport,
  }, (pipeline) => {
    const parallelWorkerPool = pipeline.registerWorkerPool(input.parallelism);
    pipeline.runStage(parallelWorkerPool, createVisregStage({
      mismatchThreshold: input.visregMismatchThreshold,
      maxNumDiffPixels: input.visregMaxNumDiffPixels,
      comparePixelmatchThreshold: input.visregComparePixelmatchThreshold,
      resembleOutputOptions: input.visregResembleOutputOptions,
      compareRetries: input.visregCompareRetries,
      compareRetryDelay: input.visregCompareRetryDelay,
      testPathPattern: input.testPathPattern,
    }));

    const perfBaseConfig = {
      regressionThreshold: input.perfRegressionThreshold,
      pValueThreshold: input.perfPValueThreshold,
      regressionThresholdStat: input.perfRegressionThresholdStat,
      lighthouseConfig: input.perfLighthouseConfig,
      plotTitle: input.perfPlotTitle,
    };
    pipeline.runStage(parallelWorkerPool, new PerfEngineStage<PerfWarmupResult>({
      name: 'perf-warmup',
      description: 'Warm pages before statistical Lighthouse sampling.',
      label: 'Perf warmup',
      artifactTitle: 'Perf warmup',
      config: {
        ...perfBaseConfig,
        numberOfMeasurements: 1,
        samplingMode: 'simultaneous',
        saveArtifacts: false,
        statisticalAnalysis: false,
      },
      machineReadableSummary: emptyMachineReadableSummary,
      applies(_test, _viewport, priorOutcomes) {
        const visreg = priorOutcomes.get('visreg');
        return visreg == null || visreg.kind === 'skipped';
      },
    }));
    pipeline.runStage(parallelWorkerPool, new PerfEngineStage<PerfResult>({
      name: 'perf',
      description: 'Run statistical Lighthouse sampling and classify perf changes.',
      label: 'Performance',
      artifactTitle: 'Performance',
      config: {
        ...perfBaseConfig,
        numberOfMeasurements: input.perfNumberOfMeasurements,
        samplingMode: input.perfSamplingMode,
        saveArtifacts: false,
        statisticalAnalysis: true,
      },
      machineReadableSummary: emptyMachineReadableSummary,
      applies(_test, _viewport, priorOutcomes) {
        return priorOutcomes.get('visreg')?.kind !== 'error' &&
          priorOutcomes.get('perf-warmup')?.kind !== 'error';
      },
    }));
    pipeline.waitForAllTasksFinishAndDispose(parallelWorkerPool);

    const singleThreadedWorkerPool = pipeline.registerWorkerPool(1);
    pipeline.runStage(singleThreadedWorkerPool, new PerfEngineStage<PerfLowNoiseResult>({
      name: 'perf-low-noise',
      description: 'Capture final serial low-noise Lighthouse reports and traces.',
      label: 'Low-noise perf',
      artifactTitle: 'Low-noise perf comparison (results are random!)',
      config: {
        ...perfBaseConfig,
        numberOfMeasurements: 1,
        samplingMode: 'simultaneous',
        saveArtifacts: true,
        statisticalAnalysis: false,
      },
      machineReadableSummary: lowNoisePerfSummary,
      applies(_test, _viewport, priorOutcomes) {
        return priorOutcomes.get('visreg')?.kind !== 'error' &&
          priorOutcomes.get('perf-warmup')?.kind !== 'error' &&
          priorOutcomes.get('perf')?.kind !== 'error';
      },
    }));
    pipeline.waitForAllTasksFinishAndDispose(singleThreadedWorkerPool);

    const accessibilityWorkerPool = pipeline.registerWorkerPool(input.parallelism);
    pipeline.runStage(accessibilityWorkerPool, new AccessibilityCompareStage(input.accessibility));
    pipeline.waitForAllTasksFinishAndDispose(accessibilityWorkerPool);

    pipeline.buildChips<{
      visreg: VisregResult;
      accessibility: AccessibilityCompareResult;
      'perf-warmup': PerfWarmupResult;
      perf: PerfResult;
      'perf-low-noise': PerfLowNoiseResult;
    }>({
      chipsForAllTests(perTest) {
        const out = new Map<AbTestDefinition, readonly ChipDescriptor[]>();
        for (const { test, results } of perTest) {
          const chips: ChipDescriptor[] = [];
          chips.push(...accessibilityChips(results.accessibility ?? []));
          const regressedMetrics = collectPerfMetrics('regressedMetrics', results.perf, results['perf-low-noise']);
          if (regressedMetrics.length > 0) {
            chips.push({
              tag: 'regression',
              text: metricChipText('regressed', regressedMetrics),
              color: 'red',
              sortingWeight: 10,
            });
          }
          const visualChange = visualChangeChip(results.visreg);
          if (visualChange) chips.push(visualChange);
          const improvedMetrics = collectPerfMetrics('improvedMetrics', results.perf, results['perf-low-noise']);
          if (improvedMetrics.length > 0) {
            chips.push({
              tag: 'improvement',
              text: metricChipText('improved', improvedMetrics),
              color: 'blue',
              sortingWeight: 30,
            });
          }
          const unstable = unstableVisregChip(results.visreg);
          if (unstable) chips.push(unstable);
          out.set(test, chips.length > 0
            ? chips
            : [{
              tag: 'no difference',
              text: 'no difference',
              color: 'gray',
              sortingWeight: 40,
              tagHiddenByDefault: true,
            }]);
        }
        return out;
      },
    });

    // Sort chips — registered the same polymorphic way as chips, but ONLY for
    // diffing metrics (those that regressed or improved). The sort value is the
    // signed percent change (regression positive, improvement negative) so the
    // worst-first default surfaces the biggest regressions.
    pipeline.buildSorts<{
      visreg: VisregResult;
      accessibility: AccessibilityCompareResult;
      'perf-warmup': PerfWarmupResult;
      perf: PerfResult;
      'perf-low-noise': PerfLowNoiseResult;
    }>({
      sortsForAllTests(perTest) {
        const out = new Map<AbTestDefinition, readonly SortDescriptor[]>();
        for (const { test, results } of perTest) {
          // Collapse each diffing metric to its largest-magnitude appearance
          // across perf + low-noise so a dimension has one value per test.
          const worstByLabel = new Map<string, PerfMetric>();
          for (const metric of collectDiffingPerfMetrics(results.perf, results['perf-low-noise'])) {
            const prev = worstByLabel.get(metric.label);
            if (!prev || Math.abs(metric.deltaPercent) > Math.abs(prev.deltaPercent)) {
              worstByLabel.set(metric.label, metric);
            }
          }
          const sorts: SortDescriptor[] = [...worstByLabel.values()].map((metric) => ({
            tag: metric.label,
            label: metric.label,
            value: metric.direction === 'improvement'
              ? -Math.abs(metric.deltaPercent)
              : Math.abs(metric.deltaPercent),
            display: metric.percentDisplay,
            higherIsWorse: true,
            color: metric.direction === 'regression' ? 'red' : 'blue',
          }));
          sorts.push(...accessibilitySorts(results.accessibility ?? []));
          if (sorts.length > 0) out.set(test, sorts);
        }
        return out;
      },
    });
  });
}

// Flatten the regressed/improved (direction !== 'none') perf metrics across the
// given result groups — the only metrics the compare report offers for sorting.
function collectDiffingPerfMetrics(
  ...entryGroups: readonly (ChipStageResults<PerfChipResult> | undefined)[]
): PerfMetric[] {
  const out: PerfMetric[] = [];
  for (const entries of entryGroups) {
    for (const entry of entries ?? []) {
      for (const metric of entry.measurement.metrics ?? []) {
        if (metric.direction !== 'none') out.push(metric);
      }
    }
  }
  return out;
}

type PerfMetricListKey = 'regressedMetrics' | 'improvedMetrics';
// report.json points an AI reviewer at the one artifact it should read: the
// plain-text diff of the two performance profile summaries.
function lowNoisePerfSummary(measurement: PerfLowNoiseResult): JsonValue {
  if (!measurement.aiAnalysisDiffHref) return {};
  return {
    aiAnalysisDiffHref: measurement.aiAnalysisDiffHref,
    instructions: 'Read this plain-text diff of the control and experiment performance profile summaries for the details behind the numbers. Its last section lists the screenshot pairs to look at; open them before drawing conclusions.',
  };
}

type PerfChipResult = PerfResult | PerfLowNoiseResult;
type AccessibilityChipResult = AccessibilityCompareResult;

function accessibilityChips(entries: ChipStageResults<AccessibilityChipResult>): ChipDescriptor[] {
  const summary = combineAccessibilitySummaries(entries);
  const chips: ChipDescriptor[] = [];
  if (summary.blocked > 0) {
    chips.push({
      tag: 'accessibility blocked',
      text: `accessibility blocked: ${summary.blocked}`,
      color: 'red',
      sortingWeight: 6,
      tooltip: 'Bot protection served a challenge page, so no control-vs-experiment accessibility comparison was produced.',
    });
  }
  if (summary.new > 0) {
    const failOnViolation = entries.some((entry) => entry.measurement.failOnViolation);
    chips.push({
      tag: failOnViolation ? 'accessibility regression' : 'accessibility finding',
      text: `accessibility: ${summary.new} new in experiment`,
      color: failOnViolation ? 'red' : 'purple',
      sortingWeight: failOnViolation ? 12 : 24,
      tooltip: impactTooltip('New accessibility findings', summary.newByImpact),
    });
  }
  if (summary.changed > 0) {
    chips.push({
      tag: 'accessibility changed',
      text: `accessibility: ${summary.changed} changed`,
      color: 'yellow',
      sortingWeight: 22,
      tooltip: impactTooltip('Changed accessibility findings', summary.changedByImpact),
    });
  }
  if (summary.fixed > 0) {
    chips.push({
      tag: 'accessibility fixed',
      text: `accessibility: ${summary.fixed} fixed in experiment`,
      color: 'blue',
      sortingWeight: 32,
      tooltip: impactTooltip('Fixed accessibility findings', summary.fixedByImpact),
    });
  }
  return chips;
}

function accessibilitySorts(entries: ChipStageResults<AccessibilityChipResult>): SortDescriptor[] {
  const summary = combineAccessibilitySummaries(entries);
  const sorts: SortDescriptor[] = [];
  const seriousNew = (summary.newByImpact.critical ?? 0) + (summary.newByImpact.serious ?? 0);
  if (seriousNew > 0) {
    sorts.push({
      tag: 'a11y-new-critical-serious',
      label: 'a11y new critical/serious',
      value: seriousNew,
      display: `${seriousNew}`,
      higherIsWorse: true,
      color: 'red',
    });
  }
  if (summary.new > 0) {
    sorts.push({
      tag: 'a11y-new',
      label: 'a11y new',
      value: summary.new,
      display: `${summary.new}`,
      higherIsWorse: true,
      color: 'red',
    });
  }
  if (summary.blocked > 0) {
    sorts.push({
      tag: 'a11y-blocked',
      label: 'a11y blocked',
      value: summary.blocked,
      display: `${summary.blocked}`,
      higherIsWorse: true,
      color: 'red',
    });
  }
  if (summary.fixed > 0) {
    sorts.push({
      tag: 'a11y-fixed',
      label: 'a11y fixed',
      value: summary.fixed,
      display: `${summary.fixed}`,
      higherIsWorse: false,
      color: 'blue',
    });
  }
  return sorts;
}

function combineAccessibilitySummaries(
  entries: ChipStageResults<AccessibilityChipResult>,
): AccessibilityCompareSummary {
  const out: AccessibilityCompareSummary = {
    new: 0,
    fixed: 0,
    changed: 0,
    unchanged: 0,
    blocked: 0,
    newByImpact: {},
    fixedByImpact: {},
    changedByImpact: {},
  };
  for (const entry of entries) {
    const summary = entry.measurement.summary;
    out.new += summary.new;
    out.fixed += summary.fixed;
    out.changed += summary.changed;
    out.unchanged += summary.unchanged;
    out.blocked += summary.blocked ?? 0;
    mergeImpactCounts(out.newByImpact, summary.newByImpact);
    mergeImpactCounts(out.fixedByImpact, summary.fixedByImpact);
    mergeImpactCounts(out.changedByImpact, summary.changedByImpact);
  }
  return out;
}

function mergeImpactCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [impact, count] of Object.entries(source)) {
    target[impact] = (target[impact] ?? 0) + count;
  }
}

function impactTooltip(label: string, counts: Record<string, number>): string {
  const parts = ['critical', 'serious', 'moderate', 'minor', 'unknown']
    .flatMap((impact) => counts[impact] ? [`${impact}: ${counts[impact]}`] : []);
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : label;
}

function collectPerfMetrics(
  key: PerfMetricListKey,
  ...entryGroups: readonly ChipStageResults<PerfChipResult>[]
): string[] {
  const metrics = new Set<string>();
  for (const entries of entryGroups) {
    for (const entry of entries) {
      for (const metric of entry.measurement[key] ?? []) {
        metrics.add(metric);
      }
    }
  }
  return Array.from(metrics).sort((a, b) => a.localeCompare(b));
}

function metricChipText(prefix: string, metrics: readonly string[]): string {
  return `${prefix}: ${metrics.join(', ')}`;
}

export function visualChangeChip(entries: ChipStageResults<VisregResult>): ChipDescriptor | null {
  const changed = entries.flatMap(({ measurement, outcome: { executionDetails: { viewport } } }) => measurement
    .filter((artifact) => artifact.diffImage !== null)
    .map((artifact) => ({
      stage: 'Visual comparison',
      viewport: measurement.length > 1 ? `${viewport.label} · ${artifact.selector}` : viewport.label,
      count: artifact.compareAttempts,
      limit: artifact.compareRetries === undefined ? undefined : artifact.compareRetries + 1,
    })));
  if (changed.length === 0) return null;

  return {
    tag: 'visual change',
    text: `visual change: ${changed.length} diff${changed.length === 1 ? '' : 's'}`,
    color: 'red',
    sortingWeight: 10,
    tooltip: retryUsageTooltip('Screenshots still differ', 'comparisons', changed),
  };
}

/** Selectors share capture attempts within a viewport; count those retries once. */
function recoveredRetryCount(viewports: readonly VisregArtifact[][]): number | undefined {
  let total = 0;
  for (const selectors of viewports) {
    let viewportRetries = 0;
    for (const artifact of selectors) {
      const attempts = artifact.compareAttempts;
      if (attempts === undefined || attempts < 2) return undefined;
      viewportRetries = Math.max(viewportRetries, attempts - 1);
    }
    total += viewportRetries;
  }
  return total;
}

export function unstableVisregChip(entries: ChipStageResults<VisregResult>): ChipDescriptor | null {
  const recovered = entries
    .map(({ measurement }) => measurement.filter((artifact) => artifact.savedByRetries))
    .filter((selectors) => selectors.length > 0);
  if (recovered.length === 0) return null;

  return {
    tag: 'visreg unstable',
    text: `visreg unstable (matched after ${retryCountText(recoveredRetryCount(recovered))})`,
    color: 'red',
    sortingWeight: 12,
    tooltip: 'Screenshots differed initially, then matched on retry.',
  };
}
