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

type VisualComparisonFields = {
  viewport: string;
  selector?: string;
  mismatch?: string;
  'visual comparisons'?: string;
  [label: `mismatch · ${string}`]: string;
  [label: `visual comparisons · ${string}`]: string;
};

function comparisonCount(artifact: VisregArtifact): string | undefined {
  const { visualComparisonCount, visualComparisonLimit, savedByRetries } = artifact;
  if (visualComparisonCount === undefined) return undefined;

  const count = visualComparisonLimit === undefined
    ? String(visualComparisonCount)
    : `${visualComparisonCount}/${visualComparisonLimit}`;
  return savedByRetries ? `${count} · matched on retry` : count;
}

export function visualComparisonFields(artifacts: VisregResult, viewport: Viewport): VisualComparisonFields {
  const fields: VisualComparisonFields = { viewport: `${viewport.label} ${viewport.width} × ${viewport.height}` };
  for (const artifact of artifacts) {
    const mismatch = `${artifact.misMatchPercentage.toFixed(2)}%`;
    const comparisons = comparisonCount(artifact);

    if (artifacts.length === 1) {
      fields.selector = artifact.selector;
      fields.mismatch = mismatch;
      if (comparisons !== undefined) fields['visual comparisons'] = comparisons;
    } else {
      fields[`mismatch · ${artifact.selector}`] = mismatch;
      if (comparisons !== undefined) fields[`visual comparisons · ${artifact.selector}`] = comparisons;
    }
  }
  return fields;
}
