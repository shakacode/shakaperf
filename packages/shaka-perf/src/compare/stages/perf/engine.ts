/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  createWorkerLighthouseSamplingPool,
  createLighthouseBenchmark,
  generateHtmlDiffs,
  generateTimelineComparison,
  generateTimelinePreviewSvg,
  measureTest,
  type Benchmark,
  type LighthouseBenchmarkOptions,
  type NavigationSample,
} from '../../../bench/core';
import { lhConfigForViewport } from '../../../bench/core/lighthouse-config';
import { resolvePlaywrightOptions } from '../../../config';
import { ensureLighthousePatchRegistered } from '../../../bench/core/patched-lighthouse/register-patch';
import { durationInSec, secondsToTime, timestamp, chalkScheme } from '../../../bench/cli/helpers/utils';
import { runAnalyze } from '../../../bench/cli/commands/compare/analyze';
import { runReport } from '../../../bench/cli/commands/compare/report';
import { readPerfArtifact } from './artifacts';
import type { PerfConfig } from '../../../config';
import type { TestContext } from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { StageFailureError, findFailureMediaName } from '../../../stage/stage-failure';
import type { PerfStageConfig } from './stage';
import type { PerfLowNoiseResult, PerfResult, PerfWarmupResult } from '../perf';

export async function runPerfEngineStage(
  ctx: TestContext,
  workerPool: WorkerPool,
  config: PerfStageConfig,
): Promise<PerfResult | PerfLowNoiseResult | PerfWarmupResult> {
  // The engine measures at ctx.viewport, so config.viewports is unused.
  const perfConfig = config;
  const unitId = ctx.testAndViewportId;
  const artifactsDir = ctx.artifacts.dir;
  fs.mkdirSync(artifactsDir, { recursive: true });

  ensureLighthousePatchRegistered();
  // Per-test effective lighthouseConfig (config.perf.lighthouseConfig in an
  // abTest() applies to that test), not the file-level stage config.
  const lhConfig = lhConfigForViewport(ctx.viewport, ctx.config.perf.lighthouseConfig ?? perfConfig.lighthouseConfig);
  const pool = createWorkerLighthouseSamplingPool<NavigationSample>(workerPool, {
    samplingMode: perfConfig.samplingMode,
  });
  pool.onSampleStart = (_testKey, group, sampleIndex) => {
    console.log(
      chalk.dim('starting'),
      { group, sample: `sample-${sampleIndex}` },
    );
  };

  const benchmarkOptions: Omit<LighthouseBenchmarkOptions, 'targetUrl'> = {
    viewport: ctx.viewport,
    resultsFolder: artifactsDir,
    lhConfig,
    saveArtifacts: config.saveArtifacts,
    headed: ctx.runtime.headed,
    // Effective launch options (shared.playwrightOptions ← perf override ←
    // per-test config); the fork maps args/headless onto chrome flags.
    playwrightOptions: resolvePlaywrightOptions(ctx.config, 'perf'),
  };
  const benchmarks = [
    createLighthouseBenchmark('control', ctx.test, {
      ...benchmarkOptions,
      targetUrl: ctx.controlURL,
    }),
    createLighthouseBenchmark('experiment', ctx.test, {
      ...benchmarkOptions,
      targetUrl: ctx.experimentURL,
    }),
  ];
  try {
    await runPerfPhase(ctx, benchmarks, pool, artifactsDir, config);
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.error(chalk.red(`perf engine error: ${message}`));
    const mediaName = findFailureMediaName(err);
    if (mediaName) {
      // The Lighthouse worker wrote the media (a screenshot on the perf path)
      // directly into artifactsDir (== ctx.artifacts.dir). The stage exposes
      // only its report-relative path; self-contained report generation owns
      // inlining the bytes.
      throw new StageFailureError(err, {
        media: ctx.artifacts.pathFor(mediaName),
      });
    }
    throw err;
  }

  if (isWarmupConfig(config)) {
    return {};
  }

  if (config.statisticalAnalysis) {
    const reportPath = path.join(artifactsDir, 'report.json');
    if (!fs.existsSync(reportPath)) {
      throw new Error(`perf did not produce report.json for ${ctx.viewport.label}`);
    }
  }
  const artifact = readPerfArtifact({
    artifacts: ctx.artifacts,
    // Per-test effective thresholds (config.perf.* in an abTest() applies to
    // that test), same as lighthouseConfig above.
    regressionThreshold: ctx.config.perf.regressionThreshold,
    regressionThresholdStat: ctx.config.perf.regressionThresholdStat,
    saveArtifacts: config.saveArtifacts,
    statisticalAnalysis: config.statisticalAnalysis,
  });
  return artifact;
}

async function runPerfPhase(
  ctx: TestContext,
  benchmarks: Benchmark<NavigationSample>[],
  pool: ReturnType<typeof createWorkerLighthouseSamplingPool<NavigationSample>>,
  artifactsDir: string,
  config: PerfStageConfig,
): Promise<void> {
  const startTime = config.statisticalAnalysis ? timestamp() : null;
  // The statistical stage samples the per-test effective count
  // (config.perf.numberOfMeasurements in an abTest() applies to that test);
  // warmup / low-noise stages keep their fixed stage-defined count (1).
  const numberOfMeasurements = config.statisticalAnalysis
    ? ctx.config.perf.numberOfMeasurements
    : config.numberOfMeasurements;
  const sampleGroups = await measureTest(
    benchmarks,
    numberOfMeasurements,
    pool,
    { testKey: perfSamplerKey(ctx.testAndViewportId, config) },
  );
  const results = sampleGroups.map(({ group, samples }) => ({
    group,
    set: group,
    samples,
    meta: samples.length > 0 ? samples[0].metadata : {},
  }));

  if (config.statisticalAnalysis && !results[0]?.samples[0]) {
    throw new Error(
      `No measurements were collected.\nCONTROL: ${ctx.controlURL}\nEXPERIMENT: ${ctx.experimentURL}`,
    );
  }

  if (config.saveArtifacts) {
    generateHtmlDiffs({ testResultsFolder: artifactsDir });
    writeTimelineArtifacts(artifactsDir);
  }

  if (config.statisticalAnalysis) {
    const abMeasurementsPath = path.join(artifactsDir, 'ab-measurements.json');
    fs.writeFileSync(abMeasurementsPath, JSON.stringify(results));
    const actualMeasurements = results[0]?.samples.length ?? 0;
    await runAnalyze(abMeasurementsPath, {
      numberOfMeasurements: actualMeasurements,
      // Per-test effective thresholds, same as the sampling count above.
      regressionThreshold: ctx.config.perf.regressionThreshold,
      regressionThresholdStat: ctx.config.perf.regressionThresholdStat,
      pValueThreshold: ctx.config.perf.pValueThreshold,
      jsonReport: true,
      summaryMetadata: {
        testName: ctx.test.name,
        testFile: ctx.test.file ?? null,
        testLine: ctx.test.line,
        viewportLabel: ctx.viewport.label,
      },
    });
    if (config.saveArtifacts) {
      try {
        await runReport({
          resultsFolder: artifactsDir,
          pValueThreshold: ctx.config.perf.pValueThreshold,
        });
      } catch (err) {
        console.error(chalk.red(`Failed to generate bench HTML report for ${ctx.test.name}:`), err);
      }
    }
    if (startTime != null) {
      const duration = secondsToTime(durationInSec(timestamp(), startTime));
      console.log(
        `\n${chalkScheme.blackBgGreen(`    ${chalkScheme.white('SUCCESS')}    `)} ${actualMeasurements} measurements took ${duration}`,
      );
    }
  }
}

function isWarmupConfig(config: Pick<PerfStageConfig, 'saveArtifacts' | 'statisticalAnalysis'>): boolean {
  return !config.saveArtifacts && !config.statisticalAnalysis;
}

function perfSamplerKey(
  unitId: string,
  config: Pick<PerfStageConfig, 'saveArtifacts' | 'statisticalAnalysis'>,
): string {
  if (config.statisticalAnalysis) return `${unitId}:measurement`;
  if (config.saveArtifacts) return `${unitId}:artifacts`;
  return `${unitId}:warmup`;
}

function writeTimelineArtifacts(artifactsDir: string): void {
  const controlProfile = path.join(artifactsDir, 'control_performance_profile.json');
  const experimentProfile = path.join(artifactsDir, 'experiment_performance_profile.json');
  if (!fs.existsSync(controlProfile) || !fs.existsSync(experimentProfile)) return;
  generateTimelineComparison({
    controlProfilePath: controlProfile,
    experimentProfilePath: experimentProfile,
    outputPath: path.join(artifactsDir, 'timeline_comparison.html'),
  });
  generateTimelinePreviewSvg({
    controlProfilePath: controlProfile,
    experimentProfilePath: experimentProfile,
    outputPath: path.join(artifactsDir, 'timeline_preview.svg'),
  });
}
