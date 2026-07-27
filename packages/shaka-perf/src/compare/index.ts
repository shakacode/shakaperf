/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export {
  AbTestsConfigSchema,
  SharedConfigSchema,
  VisregConfigSchema,
  PerfConfigSchema,
  AccessibilityConfigSchema,
  buildAbTestsConfig,
} from '../config';
// `defineConfig` now lives in shaka-shared so user configs don't have to
// pull in shaka-perf just for the type-safe identity helper.
export { defineConfig } from 'shaka-shared';
export { createCompareCommand } from './cli/program';
export { comparePipelineMetadata, createComparePipeline } from './compare-pipeline';
export type { ComparePipelineConfig } from './compare-pipeline';
export { resolveStageSelection, stageCategories, stageNames } from '../pipeline/pipeline';
export type {
  Pipeline,
  StageSelection,
} from '../pipeline/pipeline';
export type { Stage, StageCategory, StageName } from '../stage/stage';
export type { ChipDescriptor } from '../pipeline/report';
export { ArtifactStore } from '../pipeline/artifact-store';
export type { Outcome, OutcomeKind, ErrorInfo } from '../pipeline/outcome';
export type {
  AbTestsConfig,
  SharedConfig,
  VisregConfig,
  PerfConfig,
  AccessibilityConfig,
} from '../config';
export type { AbTestsConfigInput } from 'shaka-shared';
