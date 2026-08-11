/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createPipeline, type PipelineReport } from '../pipeline/pipeline';
import { emptyMachineReadableSummary } from '../stage/stage';
import { PerfEngineStage } from '../compare/stages/perf/stage';
import { createVisregStage } from '../compare/stages/visreg';
import type { PerfWarmupResult } from '../compare/stages/perf';
import type { AbTestsConfig } from '../config';

/**
 * NOT a mode of `compare`'s pipeline: independent tracks rather than one
 * serialized pool, and perf's browsers precisely when visreg failed rather than
 * gated on it passing. Its own `name` also gives it its own results root.
 */

/** Never rendered — the browsers are the output. */
const NO_REPORT: PipelineReport = {
  reportLabel: 'Troubleshoot',
  renderHeaderUrls: () => null,
  renderTestCardUrls: () => null,
  renderDialogMetaUrls: () => null,
};

export const troubleshootPipelineMetadata = {
  description: 'Run one test at one viewport and leave every browser open for inspection.',
  categories: ['visreg', 'perf'],
  stages: ['visreg', 'perf'],
} as const;

/** A pool serializes its stages, so each track needs its own. */
const TRACK_PARALLELISM = 1;

export function createTroubleshootPipeline(config: AbTestsConfig) {
  return createPipeline({
    name: 'troubleshoot',
    description: troubleshootPipelineMetadata.description,
    report: NO_REPORT,
  }, (pipeline) => {
    const visregPool = pipeline.registerWorkerPool(TRACK_PARALLELISM);
    const perfPool = pipeline.registerWorkerPool(TRACK_PARALLELISM);

    pipeline.runStage(visregPool, createVisregStage({
      mismatchThreshold: config.visreg.mismatchThreshold,
      maxNumDiffPixels: config.visreg.maxNumDiffPixels,
      comparePixelmatchThreshold: config.visreg.comparePixelmatchThreshold,
      resembleOutputOptions: config.visreg.resembleOutputOptions,
      // A retried attempt builds a second browser pair that also never closes.
      compareRetries: 0,
      compareRetryDelay: config.visreg.compareRetryDelay,
      testPathPattern: config.shared.testPathPattern,
    }));

    // Warmup-shaped, not measuring: the held gather means no LHR, so statistical
    // analysis would only add a misleading error about a missing report.json.
    pipeline.runStage(perfPool, new PerfEngineStage<PerfWarmupResult>({
      name: 'perf',
      description: 'Load the page under Lighthouse and leave its browser open.',
      label: 'Performance',
      artifactTitle: 'Performance',
      config: {
        regressionThreshold: config.perf.regressionThreshold,
        pValueThreshold: config.perf.pValueThreshold,
        regressionThresholdStat: config.perf.regressionThresholdStat,
        lighthouseConfig: config.perf.lighthouseConfig,
        plotTitle: config.perf.plotTitle,
        numberOfMeasurements: 1,
        samplingMode: 'simultaneous',
        saveArtifacts: false,
        statisticalAnalysis: false,
      },
      machineReadableSummary: emptyMachineReadableSummary,
    }));

    // After BOTH runStage calls: the runner awaits a dispose but not a run-stage,
    // so the tracks are already in flight and overlap.
    pipeline.waitForAllTasksFinishAndDispose(visregPool);
    pipeline.waitForAllTasksFinishAndDispose(perfPool);

    // Required by `createPipeline`; empty because there is no report.
    pipeline.buildChips({ chipsForAllTests: () => new Map() });
    pipeline.buildSorts({ sortsForAllTests: () => new Map() });
  });
}
