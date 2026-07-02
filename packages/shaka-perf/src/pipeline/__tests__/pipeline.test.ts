/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  createPipeline,
  resolveStageSelection,
  type Pipeline,
} from '../pipeline';
import type { Stage, StageCategory, StageName, TestContext } from '../../stage/stage';
import type { WorkerPool } from '../worker-pool';

function stage(name: StageName, category: StageCategory = 'perf'): Stage<Record<string, never>> {
  return {
    name,
    label: name,
    category,
    description: `${name} stage`,
    applies: () => true,
    run: async (_ctx: TestContext, _pool: WorkerPool) => ({}),
    renderArtifacts: () => null,
    machineReadableSummary: () => ({}),
  };
}

function pipeline(): Pipeline {
  return createPipeline({
    name: 'test',
    description: 'test pipeline',
    report: {
      reportLabel: 'Test',
      renderHeaderUrls: () => null,
      renderTestCardUrls: () => null,
      renderDialogMetaUrls: () => null,
    },
  }, (builder) => {
    const pool = builder.registerWorkerPool(2);
    builder.runStage(pool, stage('visreg', 'visreg'));
    builder.runStage(pool, stage('perf-warmup'));
    builder.runStage(pool, stage('perf'));
    builder.waitForAllTasksFinishAndDispose(pool);

    const serial = builder.registerWorkerPool(1);
    builder.runStage(serial, stage('perf-low-noise'));
    builder.waitForAllTasksFinishAndDispose(serial);

    builder.buildChips({
      chipsForAllTests: () => new Map(),
    });
    builder.buildSorts({
      sortsForAllTests: () => new Map(),
    });
  });
}

describe('resolveStageSelection', () => {
  it('selects the restart stage and later stages', () => {
    const selected = resolveStageSelection(pipeline(), { restartFromStage: 'perf' });

    expect(selected.stageNames).toEqual(['perf', 'perf-low-noise']);
    expect(selected.restartFromStage).toBe('perf');
    expect(selected.skippedStages.map((entry) => ({
      stage: entry.stage.name,
      persistOutcome: entry.persistOutcome,
    }))).toEqual([
      { stage: 'visreg', persistOutcome: false },
      { stage: 'perf-warmup', persistOutcome: false },
    ]);
  });

  it('does not persist skipped outcomes for stages before the restart point', () => {
    const selected = resolveStageSelection(pipeline(), {
      restartFromStage: 'perf',
      skipStages: 'perf-low-noise',
    });

    expect(selected.stageNames).toEqual(['perf']);
    expect(selected.skippedStages.map((entry) => ({
      stage: entry.stage.name,
      persistOutcome: entry.persistOutcome,
    }))).toEqual([
      { stage: 'visreg', persistOutcome: false },
      { stage: 'perf-warmup', persistOutcome: false },
      { stage: 'perf-low-noise', persistOutcome: true },
    ]);
  });

  it('validates the restart stage name', () => {
    expect(() => resolveStageSelection(pipeline(), { restartFromStage: 'missing' }))
      .toThrow('Unknown stage "missing". Valid: visreg, perf-warmup, perf, perf-low-noise');
  });

  it('warns and ignores unknown --skip-stages entries instead of crashing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const selected = resolveStageSelection(pipeline(), {
        skipStages: 'perf-warmup,does-not-exist',
      });

      expect(selected.stageNames).toEqual(['visreg', 'perf', 'perf-low-noise']);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ignoring unknown stage "does-not-exist" in --skip-stages'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
