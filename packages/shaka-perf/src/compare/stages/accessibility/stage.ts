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
  accessibilityConfigForTest,
  type AccessibilityStageConfig,
} from '../../../audit/stages/accessibility/config';
import type {
  AccessibilityCompareResult,
  AccessibilityCompareScreenshot,
  AccessibilitySideScan,
} from './types';
import { AccessibilityCompareArtifactView } from './report';

export class AccessibilityCompareStage implements Stage<AccessibilityCompareResult> {
  readonly category = 'accessibility';
  readonly name = 'accessibility';
  readonly label = 'Accessibility';
  readonly description = 'Scan control and experiment with axe and classify accessibility changes.';
  private readonly config: AccessibilityStageConfig;

  constructor(config?: AccessibilityStageConfig) {
    this.config = {
      ...DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
      ...config,
      engineOptions: {
        ...DEFAULT_ACCESSIBILITY_STAGE_CONFIG.engineOptions,
        ...config?.engineOptions,
      },
    };
  }

  applies(test: AbTestDefinition, _viewport: Viewport): boolean {
    return !accessibilityConfigForTest(this.config, test).skip;
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

  stripMeasurementForLightweight(measurement: AccessibilityCompareResult): AccessibilityCompareResult {
    const {
      comparisonArtifactHref: _comparison,
      ...rest
    } = measurement;
    return {
      ...rest,
      control: stripSideForMode(rest.control, 'imageDataUri'),
      experiment: stripSideForMode(rest.experiment, 'imageDataUri'),
    };
  }

  stripMeasurementForFull(measurement: AccessibilityCompareResult): AccessibilityCompareResult {
    return {
      ...measurement,
      control: stripSideForMode(measurement.control, 'imageHref'),
      experiment: stripSideForMode(measurement.experiment, 'imageHref'),
    };
  }
}

function stripSideForMode(
  scan: AccessibilitySideScan,
  keep: keyof Pick<AccessibilityCompareScreenshot, 'imageDataUri' | 'imageHref'>,
): AccessibilitySideScan {
  const { rawArtifactHref, screenshot, ...rest } = scan;
  const base = keep === 'imageHref' ? { ...rest, rawArtifactHref } : rest;
  if (!screenshot) return base;
  const { imageDataUri, imageHref, ...size } = screenshot;
  const value = keep === 'imageHref' ? imageHref : imageDataUri;
  return {
    ...base,
    screenshot: {
      ...size,
      ...(value ? { [keep]: value } : {}),
    },
  };
}
