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
import type { ArrowSpec, FrameAnnotation } from '../../../bench/core';
import type { Viewport } from '../../../config';
import type { Outcome } from '../../../pipeline/outcome';
import type { WorkerPool } from '../../../pipeline/worker-pool';
import {
  emptyMachineReadableSummary,
  type Stage,
  type StageName,
  type StageRenderEntry,
  type TestContext,
} from '../../../stage/stage';
import { BuildAnnotatedTimelineArtifactView } from './report';

export interface AnnotatedFrame {
  timeMs: number;
  imgW: number;
  imgH: number;
  /**
   * Report-relative path to the persisted frame image. Self-contained report
   * generation replaces it with a data URI in the same field.
   */
  imageHref?: string;
  annotations?: FrameAnnotation[];
  arrows?: ArrowSpec[];
  /**
   * Diagnostics-only (`--debug-show-all-frames`): the visual delta of this frame
   * vs the previous KEPT (non-discarded) frame in the full, non-deduped stream —
   * the same accumulated signal the dedupe thresholds on (not the immediate
   * neighbour). `fraction` is the share of differing pixels (0..1) at a
   * downscaled comparison resolution; `pixels` is the raw differing-pixel count.
   * Undefined before the first kept frame, and on the normal deduped `frames`
   * (only set on `BuildAnnotatedTimelineResult.debugAllFrames`).
   */
  prevDiff?: { fraction: number; pixels: number };
  /**
   * Diagnostics-only (`--debug-show-all-frames`): true when this full-stream
   * frame also survived the dedupe into the rendered (deduped) timeline. Lets
   * the debug view highlight exactly which frames were kept vs collapsed.
   */
  keptByDedupe?: boolean;
}

/**
 * A consecutive run of frames sharing one timeline phase. Frames preceding the
 * first test annotation collapse into the synthetic `initial page load` group;
 * every subsequent test annotation opens a new group whose first frame is the
 * annotated one. This is the 2-level hierarchy (group → frames) the timeline
 * renders as iterating, colour-coded sections.
 */
export interface AnnotatedFrameGroup {
  /**
   * Header label: the test annotation(s) that opened the group, or
   * `INITIAL_GROUP_LABEL` for the frames before the first annotation.
   */
  label: string;
  /** True only for the synthetic pre-first-annotation group. */
  isInitial: boolean;
  frames: AnnotatedFrame[];
}

export const INITIAL_GROUP_LABEL = 'initial page load';

/**
 * Partition the flat frame list into consecutive `AnnotatedFrameGroup`s. A
 * frame carrying one or more `test-annotation`s opens a new group (that frame
 * is the group's first frame); frames before the first annotation collapse
 * into a single `initial page load` group. Multiple annotations landing on the
 * same frame are joined into one header label.
 */
export function groupFramesByAnnotation(frames: readonly AnnotatedFrame[]): AnnotatedFrameGroup[] {
  const groups: AnnotatedFrameGroup[] = [];
  let current: AnnotatedFrameGroup | undefined;
  for (const frame of frames) {
    const labels = (frame.annotations ?? [])
      .filter((a) => a.kind === 'test-annotation')
      .map((a) => a.label);
    if (labels.length > 0) {
      current = { label: labels.join(' · '), isInitial: false, frames: [frame] };
      groups.push(current);
    } else {
      if (!current) {
        current = { label: INITIAL_GROUP_LABEL, isInitial: true, frames: [] };
        groups.push(current);
      }
      current.frames.push(frame);
    }
  }
  return groups;
}

export interface BuildAnnotatedTimelineResult {
  /**
   * Per-frame screenshot + annotation entries. The React shell
   * (`BuildAnnotatedTimelineArtifactView`) lays these out as a grid of image
   * tiles and renders labels/rectangles/brush hints as DOM/SVG overlays.
   */
  frames?: AnnotatedFrame[];
  // Screencast lives in the same per-test artifacts dir as the per-frame
  // images. We surface it through this stage rather than the audit stage so
  // the report can present them together inside the expanded timeline
  // dialog instead of as separate UI elements.
  screencastHref?: string;
  /**
   * Diagnostics-only (`--debug-show-all-frames`): the full, non-deduped
   * timeline — every synced screencast frame, each carrying `prevDiff` (its
   * delta vs the previous frame) and `keptByDedupe`. Rendered alongside the
   * deduped `frames` so the dedupe's decisions are visible. Absent unless the
   * flag was set for the run.
   */
  debugAllFrames?: AnnotatedFrame[];
}

export class BuildAnnotatedTimelineStage implements Stage<BuildAnnotatedTimelineResult> {
  readonly category = 'audit';
  readonly name: StageName = 'build_annotated_timeline';
  readonly label = 'Annotated Timeline';
  readonly description = 'Prepare Lighthouse trace screenshots for the annotated timeline.';

  applies(_test: AbTestDefinition, _viewport: Viewport, priorOutcomes: ReadonlyMap<StageName, Outcome>): boolean {
    return priorOutcomes.get('audit')?.kind === 'ok';
  }

  async run(ctx: TestContext, pool: WorkerPool): Promise<BuildAnnotatedTimelineResult> {
    const runImpl = './engine';
    const { runBuildAnnotatedTimelineStage } = await import(/* @vite-ignore */ runImpl) as typeof import('./engine');
    // Per-test effective cap (config.audit.limitVideoFramesCount in an
    // abTest() applies to that test); the zod schema defaults it to 700.
    return runBuildAnnotatedTimelineStage(ctx, pool, ctx.config.audit.limitVideoFramesCount);
  }

  renderArtifacts(measurements: readonly StageRenderEntry<BuildAnnotatedTimelineResult>[]) {
    return createElement(BuildAnnotatedTimelineArtifactView, { measurements });
  }

  machineReadableSummary = emptyMachineReadableSummary;
}
