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
  type JsonValue,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type StageRenderContext,
  type TestContext,
} from '../../../stage/stage';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import { AccessibilityArtifactView } from './report';
import {
  DEFAULT_ACCESSIBILITY_STAGE_CONFIG,
  accessibilityConfigForTest,
  type AccessibilityStageConfig,
} from './config';
import type { AccessibilityResult } from './types';

export class AccessibilityStage implements Stage<AccessibilityResult> {
  readonly category = 'accessibility';
  readonly name: StageName = 'accessibility';
  readonly label = 'Accessibility';
  readonly description = 'Run accessibility checks on the target URL.';
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

  async run(ctx: TestContext, pool: WorkerPool): Promise<AccessibilityResult> {
    const runImpl = './engine';
    const { runAccessibilityStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    return runAccessibilityStage(ctx, pool, this.config);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<AccessibilityResult>[]) {
    return createElement(AccessibilityArtifactView, { measurements });
  }

  machineReadableSummary(measurement: AccessibilityResult, _ctx: StageRenderContext): JsonValue {
    return {
      totalViolations: measurement.totalViolations,
      failOnViolation: measurement.failOnViolation,
      scans: measurement.scans.map((scan) => ({
        viewportLabel: scan.viewportLabel,
        url: scan.url,
        violations: scan.violations.map((violation) => ({
          ruleId: violation.ruleId,
          impact: violation.impact,
          tags: violation.tags,
          nodeCount: violation.nodes.length,
        })),
      })),
    };
  }

  stripMeasurementForLightweight(measurement: AccessibilityResult): AccessibilityResult {
    const { rawArtifactHref: _raw, ...rest } = measurement;
    return stripScreenshotField(rest, 'imageDataUri');
  }

  stripMeasurementForFull(measurement: AccessibilityResult): AccessibilityResult {
    return stripScreenshotField(measurement, 'imageHref');
  }
}

function stripScreenshotField(
  measurement: AccessibilityResult,
  keep: 'imageDataUri' | 'imageHref',
): AccessibilityResult {
  return {
    ...measurement,
    scans: measurement.scans.map((scan) => {
      if (!scan.screenshot) return scan;
      const { imageDataUri, imageHref, ...rest } = scan.screenshot;
      const kept = keep === 'imageDataUri' ? imageDataUri : imageHref;
      return {
        ...scan,
        screenshot: {
          ...rest,
          ...(kept ? { [keep]: kept } : {}),
        },
      };
    }),
  };
}
