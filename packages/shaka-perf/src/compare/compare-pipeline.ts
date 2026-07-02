/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AbTestDefinition } from 'shaka-shared';
import type { PerfLighthouseConfig } from '../bench/core/lighthouse-config';
import type { ChipDescriptor, SortDescriptor } from '../pipeline/report';
import {
  createPipeline,
  type ChipStageResults,
} from '../pipeline/pipeline';
import { emptyMachineReadableSummary } from '../stage/stage';
import {
  type PerfLowNoiseResult,
  type PerfMetric,
  type PerfResult,
  type PerfWarmupResult,
} from './stages/perf';
import { PerfEngineStage } from './stages/perf/stage';
import { createVisregStage, type VisregResult } from './stages/visreg';
import { hasSavedByRetries, hasVisualChange, visualChangeCount } from './stages/visreg/selectors';
import { comparePipelineReport } from './pipeline-report';

export const comparePipelineMetadata = {
  description: 'Run visreg + perf stages side-by-side and produce a unified A/B report.',
  categories: ['visreg', 'perf'],
  stages: ['visreg', 'perf-warmup', 'perf', 'perf-low-noise'],
} as const;

interface VisregEngineOptions {
  readonly browser?: string | undefined;
  readonly args?: string[] | undefined;
  readonly headless?: boolean | undefined;
  readonly waitTimeout?: number | undefined;
  readonly [key: string]: unknown;
}

interface VisregResembleOutputOptions {
  readonly transparency?: number | undefined;
  readonly ignoreAntialiasing?: boolean | undefined;
  readonly usePreciseMatching?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface ComparePipelineConfig {
  readonly parallelism: number;
  readonly testPathPattern?: string | undefined;
  readonly visregDefaultMisMatchThreshold: number;
  readonly visregMaxNumDiffPixels: number;
  readonly visregComparePixelmatchThreshold: number;
  readonly visregEngineOptions: VisregEngineOptions;
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
}

export function createComparePipeline(input: ComparePipelineConfig) {
  return createPipeline({
    name: 'compare',
    description: comparePipelineMetadata.description,
    pipelineConfig: input,
    report: comparePipelineReport,
  }, (pipeline) => {
    const parallelWorkerPool = pipeline.registerWorkerPool(input.parallelism);
    pipeline.runStage(parallelWorkerPool, createVisregStage({
      defaultMisMatchThreshold: input.visregDefaultMisMatchThreshold,
      maxNumDiffPixels: input.visregMaxNumDiffPixels,
      comparePixelmatchThreshold: input.visregComparePixelmatchThreshold,
      engineOptions: input.visregEngineOptions,
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
      machineReadableSummary: emptyMachineReadableSummary,
      applies(_test, _viewport, priorOutcomes) {
        return priorOutcomes.get('visreg')?.kind !== 'error' &&
          priorOutcomes.get('perf-warmup')?.kind !== 'error' &&
          priorOutcomes.get('perf')?.kind !== 'error';
      },
    }));
    pipeline.waitForAllTasksFinishAndDispose(singleThreadedWorkerPool);

    pipeline.buildChips<{
      visreg: VisregResult;
      'perf-warmup': PerfWarmupResult;
      perf: PerfResult;
      'perf-low-noise': PerfLowNoiseResult;
    }>({
      chipsForAllTests(perTest) {
        const out = new Map<AbTestDefinition, readonly ChipDescriptor[]>();
        for (const { test, results } of perTest) {
          const chips: ChipDescriptor[] = [];
          const regressedMetrics = collectPerfMetrics('regressedMetrics', results.perf, results['perf-low-noise']);
          if (regressedMetrics.length > 0) {
            chips.push({
              tag: 'regression',
              text: metricChipText('regressed', regressedMetrics),
              color: 'red',
              sortingWeight: 10,
              tooltip: metricChipTooltip('Regressed metrics', regressedMetrics),
            });
          }
          const visualChanges = totalVisualChanges(results.visreg);
          if (visualChanges > 0) {
            chips.push({
              tag: 'visual change',
              text: `visual change: ${visualChanges} diff${visualChanges === 1 ? '' : 's'}`,
              color: 'yellow',
              sortingWeight: 20,
            });
          }
          const improvedMetrics = collectPerfMetrics('improvedMetrics', results.perf, results['perf-low-noise']);
          if (improvedMetrics.length > 0) {
            chips.push({
              tag: 'improvement',
              text: metricChipText('improved', improvedMetrics),
              color: 'blue',
              sortingWeight: 30,
              tooltip: metricChipTooltip('Improved metrics', improvedMetrics),
            });
          }
          // A visual comparison that initially mismatched but matched on a
          // later retry — the screenshots are unstable. Informational warning
          // chip (doesn't drive card order); filterable to isolate them.
          if (entriesHave(results.visreg, hasSavedByRetries)) {
            chips.push({
              tag: 'visreg unstable',
              text: 'visreg unstable (matched after retries)',
              color: 'yellow',
              sortingWeight: 15,
              affectsCardOrder: false,
              tooltip: 'A visual comparison initially mismatched but matched on a later retry — the screenshots are unstable.',
            });
          }
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

function entriesHave<M>(
  entries: ChipStageResults<M>,
  predicate: (measurement: M) => boolean,
): boolean {
  return entries.some((entry) => predicate(entry.measurement));
}

type PerfMetricListKey = 'regressedMetrics' | 'improvedMetrics';
type PerfChipResult = PerfResult | PerfLowNoiseResult;

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

function metricChipTooltip(label: string, metrics: readonly string[]): string {
  return `${label}: ${metrics.join(', ')}`;
}

function totalVisualChanges(entries: ChipStageResults<VisregResult>): number {
  if (!entriesHave(entries, hasVisualChange)) return 0;
  return entries.reduce((sum, entry) => sum + visualChangeCount(entry.measurement), 0);
}

