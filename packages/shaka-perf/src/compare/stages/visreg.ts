/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createElement } from 'react';
import type { Viewport, VisregConfig } from '../../config';
import {
  emptyMachineReadableSummary,
  type Stage,
} from '../../stage/stage';
import { VisregArtifactView } from './visreg/report';

export interface VisregArtifact {
  selector: string;
  controlImage: string;
  experimentImage: string;
  diffImage: string | null;
  misMatchPercentage: number;
  diffPixels: number;
  threshold: number;
  /**
   * Bounding box of the first visual difference in the pixelmatch diff PNG,
   * in source-image pixels. Used by the report to crop control/experiment/diff
   * thumbnails to the same segment so the regression is visible at a glance.
   *
   * `controlImgH` / `experimentImgH` / `diffImgH` capture each source image's
   * natural height — pixelmatch's diff PNG is padded to `max(control, experiment)`,
   * so they can differ, and the CSS cropper needs the real per-image height
   * to position each image over the correct region.
   */
  diffBbox: {
    x: number;
    y: number;
    w: number;
    h: number;
    imgW: number;
    controlImgH: number;
    experimentImgH: number;
    diffImgH: number;
  } | null;
  /**
   * True when this comparison initially mismatched but a retry matched — the
   * test was visually flaky yet recovered. Drives the "Flaky (saved by
   * retries)" chip.
   */
  savedByRetries: boolean;
  /** Capture-and-compare rounds for this selector, including the first. */
  visualComparisonCount?: number;
  visualComparisonLimit?: number;
}

export type VisregResult = VisregArtifact[];

export interface VisregStageConfig extends Omit<VisregConfig, 'viewports'> {
  readonly testPathPattern?: string | undefined;
}

export function createVisregStage(config: VisregStageConfig): Stage<VisregResult> {
  return {
    measuresApplication: true,
    name: 'visreg',
    label: 'Visual Diff',
    category: 'visreg',
    description: 'Capture and compare control vs experiment screenshots.',
    selfContainedReportStrip: {},
    applies() {
      return true;
    },
    async run(ctx, pool) {
      const runImpl = './visreg/run';
      const { runVisregUnit, resetVisregScreenshots } = await import(/* @vite-ignore */ runImpl) as typeof import('./visreg/run');
      // A new measurement must not cross-match against a previous run's pixels,
      // even when --keep-old-results or --restart-from-stage retains artifacts.
      // Reset ONCE, outside the retried task: its attempts share the fresh pools.
      resetVisregScreenshots(ctx.artifacts.dir);
      const artifacts = await pool.submit(
        () => runVisregUnit(ctx, config),
        { key: ctx.testAndViewportId },
      );
      return { measurement: artifacts, metadata: visualComparisonFields(artifacts, ctx.viewport) };
    },
    renderArtifacts(measurements) {
      return createElement(VisregArtifactView, { measurements });
    },
    machineReadableSummary: emptyMachineReadableSummary,
  };
}

export function visualComparisonFields(artifacts: VisregResult, viewport: Viewport): Record<string, string> {
  const fields: Record<string, string> = { viewport: `${viewport.label} ${viewport.width} × ${viewport.height}` };
  for (const artifact of artifacts) {
    const suffix = artifacts.length > 1 ? ` · ${artifact.selector}` : '';
    if (!suffix) fields.selector = artifact.selector;
    fields[`mismatch${suffix}`] = `${artifact.misMatchPercentage.toFixed(2)}%`;
    const { visualComparisonCount, visualComparisonLimit } = artifact;
    if (visualComparisonCount === undefined) continue;
    const limit = visualComparisonLimit === undefined ? '' : `/${visualComparisonLimit}`;
    const recovery = artifact.savedByRetries ? ' · matched on retry' : '';
    fields[`visual comparisons${suffix}`] = `${visualComparisonCount}${limit}${recovery}`;
  }
  return fields;
}
