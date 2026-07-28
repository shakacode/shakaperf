/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import type { AbTestDefinition } from 'shaka-shared';
import type { Viewport } from '../../../config';
import {
  emptyMachineReadableSummary,
  type Stage,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import {
  DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  type AccessibilityStageConfig,
} from '../../../audit/stages/accessibility/config';
import type {
  AccessibilityCompareResult,
} from './types';
import { AccessibilityCompareArtifactView } from './report';

export class AccessibilityCompareStage implements Stage<AccessibilityCompareResult> {
  readonly category = 'accessibility';
  readonly name = 'accessibility';
  readonly label = 'Accessibility';
  readonly description = 'Scan control and experiment with axe and classify accessibility changes.';
  readonly selfContainedReportStrip = {
    comparisonArtifactHref: true,
    control: { rawArtifactHref: true },
    experiment: { rawArtifactHref: true },
  };
  private readonly config: AccessibilityStageConfig;

  constructor(config: AccessibilityStageConfig) {
    this.config = {
      ...DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
      ...config,
    };
  }

  applies(_test: AbTestDefinition, _viewport: Viewport): boolean {
    // Opting a test out of accessibility is testTypes-owned (omit
    // 'accessibility'); there is no per-test skip flag.
    return true;
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<AccessibilityCompareResult> {
    const runImpl = './engine';
    const { runAccessibilityCompareStage } =
      await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runAccessibilityCompareStage(ctx, pool, this.config);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AccessibilityCompareResult>[]) {
    return createElement(AccessibilityCompareArtifactView, { measurements });
  }

  machineReadableSummary = emptyMachineReadableSummary;
}
